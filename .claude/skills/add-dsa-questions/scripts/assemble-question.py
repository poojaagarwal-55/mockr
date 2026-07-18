#!/usr/bin/env python3
"""
Assemble a final question.json from a question working directory.

Expected layout (see reference.md §6):
  <question-dir>/
    meta.json
    tests/<id>.in, <id>.out, descriptions.json
    code/{python3,cpp,java,javascript}/{starter,wrapper,brute,optimized}.<ext>

Usage:
  python assemble-question.py <question-dir> [-o question.json]

Test ids starting with "sample" go to sampleTestCases; everything else (hidden_*, tle_*)
goes to hiddenTestCases. Expected outputs must already exist (run verify-solutions.py
with --gen-expected first).
"""

import argparse
import json
import pathlib
import sys

LANG_EXT = {"python3": "py", "cpp": "cpp", "java": "java", "javascript": "js"}
CODE_FILES = ["starter", "wrapper", "brute", "optimized"]


def fail(msg: str):
    print(f"ERROR: {msg}")
    sys.exit(1)


def read(path: pathlib.Path) -> str:
    if not path.exists():
        fail(f"missing file: {path}")
    text = path.read_text(encoding="utf-8").strip("\n")
    if not text.strip():
        fail(f"empty file: {path}")
    return text


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("question_dir")
    ap.add_argument("-o", "--output", default=None)
    args = ap.parse_args()

    qdir = pathlib.Path(args.question_dir)
    meta_path = qdir / "meta.json"
    if not meta_path.exists():
        fail(f"missing {meta_path}")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))

    # --- tests ---
    tests_dir = qdir / "tests"
    desc_path = tests_dir / "descriptions.json"
    if not desc_path.exists():
        fail(f"missing {desc_path} (test id -> one-line description)")
    descriptions = json.loads(desc_path.read_text(encoding="utf-8"))

    samples, hidden = [], []
    in_files = sorted(tests_dir.glob("*.in"), key=lambda p: p.name)
    if not in_files:
        fail(f"no .in files in {tests_dir}")

    for in_file in in_files:
        cid = in_file.stem
        out_file = in_file.with_suffix(".out")
        if not out_file.exists():
            fail(f"missing expected output {out_file.name} "
                 f"(run verify-solutions.py --gen-expected)")
        if cid not in descriptions or not str(descriptions[cid]).strip():
            fail(f"no description for test case '{cid}' in descriptions.json")
        case = {
            "id": cid,
            "description": str(descriptions[cid]).strip(),
            "input": read(in_file),
            "output": read(out_file),
        }
        (samples if cid.startswith("sample") else hidden).append(case)

    # Guards last so graders hit cheap cases first.
    hidden.sort(key=lambda c: (c["id"].startswith("tle_"), c["id"]))

    # --- code ---
    code_dir = qdir / "code"
    snippets, brute_code, optimized_code = {}, {}, {}
    for lang, ext in LANG_EXT.items():
        ldir = code_dir / lang
        files = {name: read(ldir / f"{name}.{ext}") for name in CODE_FILES}
        for name in ("starter", "brute", "optimized"):
            if "class Solution" not in files[name]:
                fail(f"{lang}/{name}.{ext}: must define 'class Solution'")
        if "<USER_CODE>" in files["wrapper"]:
            fail(f"{lang}/wrapper.{ext}: contains <USER_CODE> — class approach only")
        snippets[lang] = {
            "starter_code": files["starter"],
            "wrapper_code": files["wrapper"],
        }
        brute_code[lang] = files["brute"]
        optimized_code[lang] = files["optimized"]

    # --- meta ---
    for key in ("title", "problemSlug", "difficulty", "description", "examples",
                "constraints", "topics", "followUp", "hints", "solution"):
        if key not in meta or not meta[key]:
            fail(f"meta.json missing '{key}'")
    for approach in ("bruteForce", "optimized"):
        sol = meta["solution"].get(approach) or {}
        for key in ("explanation", "timeComplexity", "spaceComplexity"):
            if not sol.get(key, "").strip():
                fail(f"meta.json solution.{approach}.{key} missing/empty")

    question = {
        "title": meta["title"],
        "problemId": meta.get("problemId", meta["problemSlug"]),
        "difficulty": meta["difficulty"],
        "problemSlug": meta["problemSlug"],
        "timeLimit": meta.get("timeLimit", 2),
        "memoryLimit": meta.get("memoryLimit", 256),
        "topics": meta["topics"],
        "companyTags": meta.get("companyTags", []),
        "description": meta["description"],
        "examples": meta["examples"],
        "constraints": meta["constraints"],
        "sampleTestCases": samples,
        "hiddenTestCases": hidden,
        "codeSnippets": snippets,
        "solution": {
            "bruteForce": {**meta["solution"]["bruteForce"], "code": brute_code},
            "optimized": {**meta["solution"]["optimized"], "code": optimized_code},
        },
        "followUp": meta["followUp"],
        "hints": meta["hints"],
        "judgeType": "default",
        "checkerLanguage": None,
        "checkerCode": None,
    }
    if "frontendId" in meta:
        question["frontendId"] = meta["frontendId"]

    out_path = pathlib.Path(args.output) if args.output else qdir / "question.json"
    out_path.write_text(json.dumps(question, indent=2, ensure_ascii=False),
                        encoding="utf-8")

    total_bytes = sum(len(c["input"]) + len(c["output"]) for c in samples + hidden)
    guards = [c["id"] for c in hidden if c["id"].startswith("tle_")]
    print(f"Wrote {out_path}")
    print(f"  samples: {len(samples)} | hidden: {len(hidden)} "
          f"(guards: {', '.join(guards) or 'NONE'})")
    print(f"  test payload: {total_bytes / 1024:.0f} KB "
          f"{'(WARNING: near Mongo 16MB doc limit)' if total_bytes > 6_000_000 else ''}")
    if len(guards) < 2:
        print("  WARNING: fewer than 2 tle_* guard cases")


if __name__ == "__main__":
    main()
