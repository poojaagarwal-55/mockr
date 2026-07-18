#!/usr/bin/env python3
"""
Verify a question's solutions against its test suite.

Proves the three properties every practers DSA question must have:
  1. optimized: correct on every case and fast (<= --opt-frac * time-limit)
  2. brute:     correct on every non-guard case (matches optimized)
  3. brute:     TLEs on every tle_* guard case

Usage:
  python verify-solutions.py --optimized code/python3/optimized.py \
      --brute code/python3/brute.py --tests tests --time-limit 2 --gen-expected

  # If optimized/brute are class-only files, pass the wrapper to concatenate:
  python verify-solutions.py --optimized code/python3/optimized.py \
      --brute code/python3/brute.py --wrapper code/python3/wrapper.py \
      --tests tests --time-limit 2

  # JavaScript:
  python verify-solutions.py --cmd node --optimized code/javascript/optimized.js \
      --brute code/javascript/brute.js --wrapper code/javascript/wrapper.js \
      --tests tests --time-limit 2

Exit code 0 = all three properties hold. Anything else = the question is not ready.
"""

import argparse
import pathlib
import subprocess
import sys
import time


def build_runnable(solution_path: pathlib.Path, wrapper_path, tag: str) -> pathlib.Path:
    """Concatenate class-only solution + wrapper into a runnable file."""
    if wrapper_path is None:
        return solution_path
    combined = solution_path.parent / f"_run_{tag}{solution_path.suffix}"
    combined.write_text(
        solution_path.read_text(encoding="utf-8")
        + "\n\n"
        + pathlib.Path(wrapper_path).read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    return combined


def run(cmd: str, file: pathlib.Path, stdin_text: str, timeout: float):
    start = time.perf_counter()
    try:
        proc = subprocess.run(
            cmd.split() + [str(file)],
            input=stdin_text,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        elapsed = time.perf_counter() - start
        status = "OK" if proc.returncode == 0 else "RE"
        return status, proc.stdout, elapsed, proc.stderr
    except subprocess.TimeoutExpired:
        return "TLE", "", timeout, ""


def norm(text: str) -> str:
    return "\n".join(line.rstrip() for line in text.strip().splitlines())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--optimized", required=True)
    ap.add_argument("--brute", required=True)
    ap.add_argument("--wrapper", default=None,
                    help="wrapper file to concatenate after each solution (class-only files)")
    ap.add_argument("--tests", required=True, help="directory of <id>.in / <id>.out files")
    ap.add_argument("--time-limit", type=float, default=2.0)
    ap.add_argument("--cmd", default=sys.executable or "python",
                    help="interpreter command (default: current python; use 'node' for JS)")
    ap.add_argument("--gen-expected", action="store_true",
                    help="write <id>.out from the optimized solution's output")
    ap.add_argument("--opt-frac", type=float, default=0.6,
                    help="optimized must finish within this fraction of the time limit")
    ap.add_argument("--brute-timeout-mult", type=float, default=3.0,
                    help="brute is killed after time-limit * this multiplier")
    args = ap.parse_args()

    tests_dir = pathlib.Path(args.tests)
    cases = sorted(tests_dir.glob("*.in"), key=lambda p: p.name)
    if not cases:
        print(f"ERROR: no .in files found in {tests_dir}")
        sys.exit(2)

    opt = build_runnable(pathlib.Path(args.optimized), args.wrapper, "optimized")
    bru = build_runnable(pathlib.Path(args.brute), args.wrapper, "brute")

    # Guard against identical solutions (rule 2 of the skill).
    if norm(pathlib.Path(args.optimized).read_text(encoding="utf-8")).replace(" ", "") == \
       norm(pathlib.Path(args.brute).read_text(encoding="utf-8")).replace(" ", ""):
        print("FAIL: brute force and optimized are the same code. Redesign the brute force.")
        sys.exit(2)

    tl = args.time_limit
    opt_budget = tl * args.opt_frac
    brute_kill = tl * args.brute_timeout_mult

    failures = []
    rows = []

    for case in cases:
        cid = case.stem
        is_guard = cid.startswith("tle_")
        stdin_text = case.read_text(encoding="utf-8")
        out_path = case.with_suffix(".out")

        # --- optimized ---
        o_status, o_out, o_time, o_err = run(args.cmd, opt, stdin_text, timeout=brute_kill)
        if o_status != "OK":
            failures.append(f"{cid}: optimized {o_status} ({o_err.strip()[:200]})")
            rows.append((cid, o_status, f"{o_time:.2f}s", "-", "-", "FAIL"))
            continue
        if o_time > opt_budget:
            failures.append(
                f"{cid}: optimized too slow ({o_time:.2f}s > {opt_budget:.2f}s budget)"
            )

        if args.gen_expected:
            out_path.write_text(norm(o_out) + "\n", encoding="utf-8")
            expected = norm(o_out)
        elif out_path.exists():
            expected = norm(out_path.read_text(encoding="utf-8"))
            if norm(o_out) != expected:
                failures.append(f"{cid}: optimized output != expected .out file")
        else:
            failures.append(f"{cid}: missing {out_path.name} (run with --gen-expected)")
            expected = norm(o_out)

        # --- brute ---
        b_status, b_out, b_time, b_err = run(args.cmd, bru, stdin_text, timeout=brute_kill)
        if is_guard:
            # Guard case: brute MUST fail by time.
            if b_status == "TLE" or b_time > tl:
                verdict = "PASS"
            else:
                verdict = "FAIL"
                failures.append(
                    f"{cid}: brute force SURVIVED the TLE guard "
                    f"({b_time:.2f}s <= {tl:.2f}s limit) — enlarge the guard or redesign"
                )
        else:
            if b_status == "OK" and norm(b_out) == expected:
                verdict = "PASS"
            elif b_status == "TLE":
                verdict = "WARN"
                failures.append(
                    f"{cid}: brute TLE on a NON-guard case — shrink this case so brute "
                    f"can prove correctness on it"
                )
            else:
                verdict = "FAIL"
                failures.append(
                    f"{cid}: brute {'wrong output' if b_status == 'OK' else b_status} "
                    f"— brute must be CORRECT, only slow ({b_err.strip()[:200]})"
                )

        rows.append((cid, o_status, f"{o_time:.2f}s", b_status, f"{b_time:.2f}s", verdict))

    # --- report ---
    print(f"\n{'case':<18}{'opt':<6}{'opt time':<10}{'brute':<7}{'brute time':<12}verdict")
    print("-" * 62)
    for r in rows:
        print(f"{r[0]:<18}{r[1]:<6}{r[2]:<10}{r[3]:<7}{r[4]:<12}{r[5]}")

    guards = [r for r in rows if r[0].startswith("tle_")]
    print(f"\ntime limit {tl}s | optimized budget {opt_budget:.2f}s | "
          f"brute killed at {brute_kill:.2f}s | {len(cases)} cases ({len(guards)} guards)")

    if len(guards) < 2:
        failures.append(f"only {len(guards)} tle_* guard case(s) — need at least 2")

    if failures:
        print("\nFAILURES:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)

    print("\nALL CHECKS PASSED: optimized fast+correct, brute correct-but-TLEs-on-guards.")


if __name__ == "__main__":
    main()
