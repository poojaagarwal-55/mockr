---
name: add-dsa-questions
description: >
  Generate and insert complete DSA questions into the practers question bank (MongoDB
  dsa_questions collection). Use when the user asks to add DSA questions, create the daily
  batch of practice questions, or convert a question screenshot/image into a platform
  question. Produces every schema field — fully reworded original statement, class-based
  starter + wrapper code for python3/cpp/java/javascript, distinct brute-force and optimized
  solutions, and hidden test cases locally VERIFIED so that brute force TLEs and only the
  optimized solution passes. No API required — inserts directly into MongoDB.
---

# Add DSA Questions — autonomous question factory

You are generating production questions for the practers platform. Every question you
produce is judged by an exact-match Judge0 runner and solved by real students. A single
wrong hidden output, an empty field, or a brute force that passes the TLE guard destroys
trust in the platform. Work like a problem setter, not a text generator.

**Read [reference.md](reference.md) BEFORE generating anything** — it has the exact schema,
house style, wrapper templates, and TLE calibration table.

## Inputs

- **No input** → generate a batch of **5–6 new questions** (mixed difficulty: ~2 Easy,
  2–3 Medium, 1 Hard; spread across different topics; check DB first to avoid repeating
  recently added topics).
- **Image(s) of an existing question** → recreate each pictured question (see
  "Image mode" below). Batch size = number of images unless the user asks for more.
- **Topic / difficulty / count hints** in the user's message → follow them.

## Non-negotiable rules

1. **NO EMPTY FIELDS.** Every field in the schema must be filled: title, problemId,
   frontendId, difficulty, slug, timeLimit, memoryLimit, topics, description, examples
   (≥2 with explanations), constraints (≥3), sampleTestCases (≥2), hiddenTestCases (≥10),
   codeSnippets for ALL FOUR languages, solution.bruteForce AND solution.optimized (each
   with explanation + both complexities + code in all four languages), followUp (≥1),
   hints (≥2–3). The insert script hard-fails on gaps — do not plan to "fill later".

2. **Brute force ≠ optimized — genuinely.** Different algorithm, different asymptotic
   complexity, different code. It is NOT acceptable to copy the optimized solution and
   call it brute force, or to make a trivial variation of the same algorithm. The insert
   script diffs the code and the complexity strings, and the verify harness proves the
   timing gap — both will reject lazy duplicates. The brute force must still be **correct**
   (it must produce right answers on small cases; it fails only by time).

3. **TLE separation is designed, then MEASURED — never assumed.** Hidden tests must
   include ≥2 "TLE guard" cases (id prefix `tle_`) sized from the calibration table in
   reference.md so that:
   - the brute force exceeds the time limit **in the fastest language (C++)** — i.e.
     brute basic-op count ≥ 5×10⁹ on the guard case, or brute is exponential/factorial;
   - the optimized solution passes **in the slowest language (Python)** — measured
     locally at ≤ 60% of `timeLimit`.
   You MUST run `scripts/verify-solutions.py` and show its output table before assembling
   the question. A question whose brute force survives the TLE guard is a failed question.

4. **Class-based wrapper only.** `starter_code` defines `class Solution` with one method;
   `wrapper_code` is a standalone stdin→stdout `main` that instantiates `Solution` and
   calls the method. **Never use the `<USER_CODE>` placeholder.** Use the templates in
   reference.md verbatim (adapt only parsing + the method call).

5. **companyTags: real companies only, only when genuinely known.** Tag companies only
   when the question is a well-documented interview question of that company (or the
   source image says so). Never invent tags, never tag "AI"/"Generated"/similar. An
   empty `companyTags: []` is always acceptable; a fabricated tag is not.

6. **Deterministic, exact-match output only.** Single well-defined answer per input.
   Integers and strings only — never floating point, never "any valid answer" problems.
   `judgeType` stays `"default"`, checker fields stay `null`.

7. **Never hand-type large test inputs.** Small edge cases may be written by hand; every
   large case is produced by a generator script, and expected outputs are computed by
   running the optimized solution — never by predicting them mentally.

8. **Reword, never copy** (image mode): the statement, story, variable names, examples,
   and all test data must be written fresh by you. Zero sentences carried over from the
   source. Only the algorithmic task and the searchable title (lightly adjusted) survive.

## Workflow

Work in the scratchpad directory. Create one folder per question:
`<scratchpad>/qfactory/<slug>/` with subfolders `code/{python3,cpp,java,javascript}/`
and `tests/`.

### Phase 0 — Recon (once per batch)

1. Read [reference.md](reference.md).
2. List what already exists so you don't duplicate:
   ```
   node .claude/skills/add-dsa-questions/scripts/insert-questions.cjs --list
   ```
   (add a regex arg to filter, e.g. `--list "sum|array"`). Pick topics/titles that don't
   collide with existing ones.

### Phase 1 — Design spec (per question)

Write a short spec before any code — title, slug, difficulty, topics, the algorithmic
core, the brute-force approach + complexity, the optimized approach + complexity, the
constraint bounds, and the TLE plan (which row of the calibration table, guard-case size,
estimated brute op-count on the guard). If brute and optimized land in the same complexity
class, redesign the problem until they don't.

**Image mode:** Read the image. Extract the algorithmic task, constraints, and the
canonical title. Then rewrite completely — new narrative/context, new variable names, new
examples with your own numbers, your own test data. Title: keep the searchable core words,
change at most one word or add a qualifier (e.g. "Merge K Sorted Lists" → "Merge K Sorted
Linked Lists"). Constraints may keep the same bounds. Carry over company tags only if the
source shows them.

### Phase 2 — Implement and verify in Python first

1. Write `code/python3/optimized.py` and `code/python3/brute.py` — each a **complete
   runnable file** (the `class Solution` + the wrapper `main` concatenated, exactly what
   the judge would execute).
2. Hand-write the small edge cases into `tests/` (`sample_1.in`, `hidden_1.in`, ...):
   minimum constraint values, duplicates, all-equal, sorted/reverse-sorted, boundary
   values, the classic counterexample that kills a wrong greedy, etc. **Write the `.in`
   files only** — outputs come from the next step.
3. Write `gen.py` to produce the large cases: 3–5 random mid-size cases
   (`hidden_rand_*.in`) and ≥2 max-size TLE guards (`tle_1.in`, `tle_2.in`).
4. Generate expected outputs from the optimized solution and verify everything:
   ```
   python .claude/skills/add-dsa-questions/scripts/verify-solutions.py \
     --optimized code/python3/optimized.py --brute code/python3/brute.py \
     --tests tests --time-limit 2 --gen-expected
   ```
   The harness checks: optimized OK + fast on every case; brute matches optimized on all
   non-guard cases; brute TLEs on every `tle_*` case. **All three must hold.** If brute
   finishes a guard case, enlarge the guard or redesign — do not shrink the time limit.
5. Sanity-check a couple of small expected outputs by hand-reasoning; if the problem
   allows, cross-check with a third dead-simple reference implementation.

### Phase 3 — Port to C++, Java, JavaScript

1. Write starter/wrapper/brute/optimized for `cpp`, `java`, `javascript` in `code/<lang>/`
   using the reference.md templates. Same algorithms, faithful ports — watch integer
   overflow (use `long long`/`long` where sums can exceed 2³¹) and fast IO (templates
   already have it).
2. Verify JavaScript locally the same way (`--cmd node` flags on the verify script).
3. If `g++`/`javac` are available, compile-check C++/Java (`g++ -x c++ -fsyntax-only`,
   `javac`); if not, re-read the ports line by line against the working Python version.

### Phase 4 — Assemble

1. Write `meta.json` (all textual fields: title, slug, difficulty, topics, companyTags,
   description, examples, constraints, followUp, hints, solution explanations +
   complexities — see reference.md for the exact shape) and `tests/descriptions.json`
   (test id → one-line description).
2. Build the final JSON — never by typing test data into it:
   ```
   python .claude/skills/add-dsa-questions/scripts/assemble-question.py <question-dir>
   ```
   This embeds tests + code files and writes `question.json`.

### Phase 5 — Validate and insert

```
node .claude/skills/add-dsa-questions/scripts/insert-questions.cjs question.json --dry-run
```
Fix every error (and read the warnings). Then insert for real:
```
node .claude/skills/add-dsa-questions/scripts/insert-questions.cjs question.json
```
Requires `MONGODB_URI` in `apps/api/.env` (already configured in this repo). Default
collection is `dsa_questions` (the practice bank); pass `--collection contest_questions`
only if the user explicitly wants contest questions.

### Phase 6 — Report

End with a table: title | slug | difficulty | topics | brute vs optimized complexity |
measured brute/optimized time on the TLE guard | hidden-case count | inserted ✅/❌.
If anything was skipped or failed verification, say so plainly.

## Final checklist (walk it for every question)

- [ ] All schema fields present and non-empty (insert script dry-run passes clean)
- [ ] 4 languages × (starter, wrapper, brute, optimized) = 16 code blocks, all present
- [ ] Wrapper is class-based, no `<USER_CODE>` anywhere
- [ ] Brute and optimized: different algorithm, different complexity, verified different code
- [ ] `verify-solutions.py` table shown: optimized fast+correct, brute correct on small, TLE on guards
- [ ] Brute op-count on guard ≥ 5×10⁹ (or exponential) → C++ brute also TLEs
- [ ] ≥10 hidden cases incl. edge cases and ≥2 `tle_` guards; outputs machine-generated
- [ ] Description follows house style (sections, LaTeX, parameter table, IO format)
- [ ] companyTags real-or-empty; no fabricated tags
- [ ] Slug/title unique in DB (`--list` checked, dry-run passed)
