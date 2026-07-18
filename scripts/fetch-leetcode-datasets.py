#!/usr/bin/env python3
"""
Fetch and combine LeetCode datasets into the Practers DSA question JSON format.

Sources:
  1. greengerong/leetcode       (HuggingFace) — ~2400 problems, descriptions + solution code
  2. Elfsong/Mercury            (HuggingFace) — 1633 problems, topic tags
  3. ronantakizawa/leetcode-assembly (HuggingFace) — extra problems
  4. newfacade/LeetCodeDataset  (HuggingFace) — 2641 problems, REAL test cases + verified solutions

Output:
  Individual JSON files in  Questions/DSA_questions/
  Problems with real test cases have sample_test_cases and hidden_test_cases pre-filled
  (in JSON-lines stdin format), so process-dataset.ts skips test case generation.

Usage:
  python scripts/fetch-leetcode-datasets.py [--limit N]
"""

import ast
import json
import re
import sys
from pathlib import Path
from typing import Any

# ── Dependency check ──────────────────────────────────────────────────────────

def ensure_deps() -> None:
    missing = []
    try:
        from datasets import load_dataset  # noqa: F401
    except ImportError:
        missing.append("datasets")
    if missing:
        print(f"Missing packages: {', '.join(missing)}")
        print("Run:  pip install -r scripts/requirements-fetch.txt")
        sys.exit(1)

ensure_deps()

from datasets import load_dataset  # type: ignore[import]  # noqa: E402

# ── Helpers ───────────────────────────────────────────────────────────────────

def html_to_text(html: str) -> str:
    """Strip HTML tags and decode common entities."""
    if not html:
        return ""
    text = re.sub(r"<br\s*/?>", "\n", html, flags=re.IGNORECASE)
    text = re.sub(r"</?p[^>]*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</?li[^>]*>", "\n- ", text, flags=re.IGNORECASE)
    text = re.sub(r"</?ul[^>]*>|</?ol[^>]*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</?strong[^>]*>|</?b[^>]*>", "**", text, flags=re.IGNORECASE)
    text = re.sub(r"</?em[^>]*>|</?i[^>]*>", "_", text, flags=re.IGNORECASE)
    text = re.sub(r"<code[^>]*>(.*?)</code>", r"`\1`", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<pre[^>]*>(.*?)</pre>", r"\n```\n\1\n```\n", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<[^>]+>", "", text)
    entities = {
        "&lt;": "<", "&gt;": ">", "&amp;": "&", "&nbsp;": " ",
        "&quot;": '"', "&#39;": "'", "&le;": "≤", "&ge;": "≥",
        "&times;": "×", "&hellip;": "...", "&laquo;": "«", "&raquo;": "»",
    }
    for ent, char in entities.items():
        text = text.replace(ent, char)
    text = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))), text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def normalize_difficulty(raw: Any) -> str:
    d = str(raw).strip().lower()
    if d in ("easy", "1"):
        return "Easy"
    if d in ("hard", "3"):
        return "Hard"
    return "Medium"


def slugify(title: str) -> str:
    s = title.lower().strip()
    s = re.sub(r"[^a-z0-9\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"-+", "-", s)
    return s.strip("-")


def extract_follow_up(text: str) -> list[str]:
    """Pull out any 'Follow up:' sentences from the problem description."""
    results = []
    # Match lines starting with "Follow up:" (various capitalizations)
    pattern = re.compile(
        r"[Ff]ollow[\s-][Uu]p\s*:?\s*(.+?)(?=\n\n|\Z)", re.DOTALL
    )
    for m in pattern.finditer(text):
        snippet = m.group(1).strip().replace("\n", " ")
        snippet = re.sub(r"\s+", " ", snippet)
        if snippet:
            results.append(snippet)
    return results


def extract_examples(description: str) -> list[dict]:
    """Extract numbered examples from description text."""
    examples = []
    pattern = re.compile(
        r"(Example\s+\d+\s*:.*?)(?=Example\s+\d+\s*:|\Z)", re.DOTALL | re.IGNORECASE
    )
    for i, m in enumerate(pattern.finditer(description), 1):
        text = m.group(0).strip()
        if text:
            examples.append({"example_num": i, "example_text": text})
    return examples


def extract_constraints(description: str) -> list[str]:
    """Extract constraints bullet points from description."""
    constraints = []
    in_block = False
    for line in description.splitlines():
        stripped = line.strip()
        # Match plain "Constraints:" or markdown "**Constraints:**" or "* Constraints: *"
        bare = re.sub(r"\*+", "", stripped).strip()
        if re.match(r"^Constraints?\s*:?\s*$", bare, re.IGNORECASE):
            in_block = True
            continue
        if in_block:
            # Stop at next heading-like line
            bare_line = re.sub(r"\*+", "", stripped).strip()
            if re.match(r"^(Note|Follow|Example|Hint)\b", bare_line, re.IGNORECASE):
                break
            # Strip markdown list markers and bold/code formatting
            cleaned = re.sub(r"^[-*•`]+\s*", "", stripped)
            cleaned = re.sub(r"\*+", "", cleaned).strip()
            # Strip backtick code spans for display
            cleaned = re.sub(r"`([^`]+)`", r"\1", cleaned).strip()
            if cleaned:
                constraints.append(cleaned)
            elif not stripped and constraints:
                break
    return constraints


LANG_MAP: dict[str, str] = {
    "python3": "python3", "python": "python3",
    "cpp": "cpp", "c++": "cpp",
    "java": "java",
    "javascript": "javascript", "js": "javascript",
    "typescript": "typescript", "ts": "typescript",
    "c": "c",
    "csharp": "csharp", "c#": "csharp",
    "go": "golang", "golang": "golang",
    "rust": "rust",
    "kotlin": "kotlin",
    "swift": "swift",
    "ruby": "ruby",
    "scala": "scala",
    "php": "php",
    "dart": "dart",
}


def parse_code_snippets(raw: Any) -> dict:
    """Normalise codeSnippets from various raw formats to our dict."""
    snippets_list: list = []
    if isinstance(raw, str):
        try:
            snippets_list = json.loads(raw)
        except Exception:
            return {}
    elif isinstance(raw, list):
        snippets_list = raw
    else:
        return {}

    result = {}
    for s in snippets_list:
        if not isinstance(s, dict):
            continue
        lang = s.get("langSlug") or s.get("lang") or ""
        lang = LANG_MAP.get(lang.lower(), lang.lower())
        code = s.get("code") or ""
        if lang and code:
            result[lang] = {"starter_code": code, "wrapper_code": ""}
    return result


def parse_topics(raw: Any) -> list[str]:
    """Parse topic tags from various raw formats."""
    if not raw:
        return []
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except Exception:
            return [t.strip() for t in raw.split(",") if t.strip()]
        raw = parsed
    if isinstance(raw, list):
        out = []
        for t in raw:
            if isinstance(t, dict):
                out.append(t.get("name") or t.get("slug") or "")
            else:
                out.append(str(t))
        return [x for x in out if x]
    return []


def parse_hints(raw: Any) -> list[str]:
    """Parse hints from various raw formats."""
    if not raw:
        return []
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except Exception:
            return [raw.strip()] if raw.strip() else []
        raw = parsed
    if isinstance(raw, list):
        return [str(h).strip() for h in raw if str(h).strip()]
    return []


def make_question(
    *,
    problem_id: str,
    title: str,
    difficulty: str,
    slug: str,
    description: str,
    topics: list[str],
    code_snippets: dict,
    frontend_id: str = "",
    company_tags: list[str] | None = None,
    solution: str | None = None,
    hints: list[str] | None = None,
    extra_follow_ups: list[str] | None = None,
) -> dict:
    follow_up_from_desc = extract_follow_up(description)
    follow_up = sorted(set(follow_up_from_desc + (extra_follow_ups or [])))
    examples = extract_examples(description)
    constraints = extract_constraints(description)

    q: dict = {
        "title": title,
        "problem_id": problem_id,
        "frontend_id": frontend_id or problem_id,
        "difficulty": difficulty,
        "problem_slug": slug,
        "topics": topics,
        "company_tags": company_tags or [],
        "description": description,
        "examples": examples,
        "constraints": constraints,
        "sample_test_cases": [],
        "hidden_test_cases": [],
        "code_snippets": code_snippets,
        "follow_up": follow_up,
        "hints": hints or [],
        "solution": solution or {},
    }
    return q


# ── Dataset 1: greengerong/leetcode ───────────────────────────────────────────

def load_greengerong() -> dict[str, dict]:
    """
    HuggingFace dataset: greengerong/leetcode
    Actual columns: id, slug, title, difficulty, content, java, c++, python, javascript
    Note: no topicTags or codeSnippets — those come from neenza.
    The language columns contain reference solution code.
    """
    print("\n[1/3] greengerong/leetcode (HuggingFace)...")
    questions: dict[str, dict] = {}

    try:
        ds = load_dataset("greengerong/leetcode", split="train", trust_remote_code=True)
        print(f"  Rows: {len(ds)}")
    except Exception as e:
        print(f"  ERROR loading dataset: {e}")
        return questions

    for row in ds:
        try:
            pid = str(row.get("id") or "").strip()
            if not pid:
                continue
            title = str(row.get("title") or "").strip()
            if not title:
                continue

            content = row.get("content") or ""
            description = html_to_text(content)

            difficulty = normalize_difficulty(row.get("difficulty") or "Medium")
            slug = str(row.get("slug") or slugify(title))

            # Build code_snippets from the language columns that exist
            code_snippets: dict = {}
            for col, lang_key in [("python", "python3"), ("c++", "cpp"),
                                   ("java", "java"), ("javascript", "javascript")]:
                code = str(row.get(col) or "").strip()
                if code:
                    code_snippets[lang_key] = {"starter_code": code, "wrapper_code": ""}

            # No topics in this dataset — will be enriched by neenza
            # No hints in this dataset

            questions[pid] = make_question(
                problem_id=pid,
                title=title,
                difficulty=difficulty,
                slug=slug,
                description=description,
                topics=[],
                code_snippets=code_snippets,
                frontend_id=pid,
                solution=None,
                hints=[],
                extra_follow_ups=[],
            )
        except Exception as e:
            print(f"  WARN row skipped: {e}")

    print(f"  Parsed: {len(questions)} problems")
    return questions


# ── Dataset 2: Elfsong/Mercury (HuggingFace) ──────────────────────────────────

def load_mercury() -> dict[str, dict]:
    """
    HuggingFace dataset: Elfsong/Mercury
    1633 problems. Has topicTags in meta_info.data.question.
    id field = frontend question number (matches greengerong's id).
    Used purely for enriching topics on matched problems.
    """
    print("\n[2/3] Elfsong/Mercury (HuggingFace)...")
    # Returns a sparse dict: only {pid: {"topics": [...]}} for merging
    topics_map: dict[str, dict] = {}

    try:
        ds = load_dataset("Elfsong/Mercury", split="train", trust_remote_code=True)
        print(f"  Rows: {len(ds)}")
    except Exception as e:
        print(f"  ERROR loading dataset: {e}")
        return topics_map

    for row in ds:
        try:
            pid = str(row.get("id") or "").strip()
            if not pid:
                continue

            meta = (row.get("meta_info") or {})
            question = (meta.get("data") or {}).get("question") or {}
            raw_topics = question.get("topicTags") or []
            topics = [t["name"] for t in raw_topics if isinstance(t, dict) and t.get("name")]
            slug = str(question.get("questionTitleSlug") or row.get("slug_name") or "")

            if topics or slug:
                topics_map[pid] = {"topics": topics, "slug": slug}
        except Exception as e:
            print(f"  WARN row skipped: {e}")

    print(f"  Enrichment entries: {len(topics_map)}")
    return topics_map


# ── Dataset 3: ronantakizawa/leetcode-assembly ────────────────────────────────

def load_assembly() -> dict[str, dict]:
    """
    HuggingFace dataset: ronantakizawa/leetcode-assembly
    Columns vary — tries multiple field names for each piece of data.
    Assembly code is stored under codeSnippets as 'assembly'.
    """
    print("\n[3/3] ronantakizawa/leetcode-assembly (HuggingFace)...")
    questions: dict[str, dict] = {}

    try:
        ds = load_dataset(
            "ronantakizawa/leetcode-assembly", split="train", trust_remote_code=True
        )
        print(f"  Rows: {len(ds)}")
    except Exception as e:
        print(f"  ERROR loading dataset: {e}")
        return questions

    # Peek at first row to understand column names
    if len(ds) > 0:
        sample = dict(ds[0])
        print(f"  Columns: {list(sample.keys())}")

    for row in ds:
        try:
            pid = str(
                row.get("id")
                or row.get("problem_id")
                or row.get("question_id")
                or row.get("questionId")
                or ""
            ).strip()

            title = str(
                row.get("title")
                or row.get("question_title")
                or row.get("name")
                or row.get("problem_name")
                or ""
            ).strip()
            if not title:
                continue

            if not pid:
                pid = slugify(title)  # fall back to slug as ID

            content = str(
                row.get("content")
                or row.get("description")
                or row.get("question")
                or row.get("problem")
                or row.get("problem_description")
                or ""
            )
            description = html_to_text(content) if "<" in content else content

            topics = parse_topics(
                row.get("topicTags")
                or row.get("topics")
                or row.get("tags")
                or row.get("categories")
                or []
            )
            difficulty = normalize_difficulty(
                row.get("difficulty") or row.get("level") or "Medium"
            )
            slug = str(
                row.get("titleSlug") or row.get("slug") or slugify(title)
            )

            # Assembly code (if present) stored as its own snippet
            code_snippets: dict = {}
            asm_code = str(row.get("assembly") or row.get("asm_code") or "")
            if asm_code:
                code_snippets["assembly"] = {
                    "starter_code": asm_code,
                    "wrapper_code": "",
                }
            # Also pick up any other language snippets
            raw_snippets = row.get("codeSnippets") or row.get("code_snippets") or []
            code_snippets.update(parse_code_snippets(raw_snippets))

            hints = parse_hints(row.get("hints") or row.get("hint") or [])
            raw_fu = row.get("follow_ups") or row.get("followUps") or []
            extra_follow_ups = parse_hints(raw_fu)

            questions[pid] = make_question(
                problem_id=pid,
                title=title,
                difficulty=difficulty,
                slug=slug,
                description=description,
                topics=topics,
                code_snippets=code_snippets,
                hints=hints,
                extra_follow_ups=extra_follow_ups,
            )
        except Exception as e:
            print(f"  WARN row skipped: {e}")

    print(f"  Parsed: {len(questions)} problems")
    return questions


# ── Dataset 4: newfacade/LeetCodeDataset ──────────────────────────────────────

def _kwargs_to_stdin(input_str: str, param_names: list[str]) -> str | None:
    """
    Convert kwargs-style input ('nums = [3,3], target = 6') into JSON-lines stdin.
    Returns one JSON-encoded value per line matching the order of param_names.
    Returns None if parsing fails.
    """
    try:
        tree = ast.parse(f"f({input_str})", mode="eval")
        kwargs: dict[str, Any] = {}
        for kw in tree.body.keywords:  # type: ignore[attr-defined]
            kwargs[kw.arg] = ast.literal_eval(kw.value)
        values = [kwargs[p] for p in param_names if p in kwargs]
        if not values:
            return None
        return "\n".join(json.dumps(v, separators=(",", ":")) for v in values)
    except Exception:
        return None


def load_newfacade() -> dict[str, dict]:
    """
    HuggingFace dataset: newfacade/LeetCodeDataset
    2641 problems with real test cases (80-110 per problem), verified Python solutions,
    tags, and starter code. Keyed by task_id (slug).

    Returns dict keyed by problem slug (not numeric ID) so merge can match on slug.
    Each value contains: tags, sample_test_cases, hidden_test_cases, solution_code,
    entry_point, starter_code (python3).
    """
    print("\n[4/4] newfacade/LeetCodeDataset (HuggingFace)...")
    enrichment: dict[str, dict] = {}

    try:
        ds = load_dataset("newfacade/LeetCodeDataset", split="train", trust_remote_code=True)
        print(f"  Rows: {len(ds)}")
    except Exception as e:
        print(f"  ERROR loading dataset: {e}")
        return enrichment

    for row in ds:
        try:
            slug = str(row.get("task_id") or "").strip()
            qid  = str(row.get("question_id") or "").strip()
            if not slug:
                continue

            tags         = list(row.get("tags") or [])
            starter_code = str(row.get("starter_code") or "").strip()
            completion   = str(row.get("completion") or "").strip()
            entry_point  = str(row.get("entry_point") or "").strip()
            raw_io       = row.get("input_output") or []

            # Extract ordered param names from starter code signature.
            # entry_point is "Solution().methodName" or "methodName" — extract just the method name.
            # Then find "def methodName(self, a, b)" or "def methodName(a, b)" in the prompt.
            param_names: list[str] = []
            method_name = entry_point.split(".")[-1].split("(")[0].strip() if entry_point else ""
            if method_name:
                # Try to find the method definition: handles class methods and plain functions
                m = re.search(rf"def {re.escape(method_name)}\(self,\s*(.*?)\)", starter_code)
                if not m:
                    m = re.search(rf"def {re.escape(method_name)}\(\s*(.*?)\)\s*(?:->|:)", starter_code)
            else:
                m = re.search(r"def \w+\(self,\s*(.*?)\)", starter_code)
                if not m:
                    m = re.search(r"def \w+\(\s*(.*?)\)\s*(?:->|:)", starter_code)
            if m:
                raw_params = m.group(1).split(",")
                param_names = [
                    p.strip().split(":")[0].strip()
                    for p in raw_params
                    if p.strip() and p.strip() != "self"
                ]

            # Convert input_output list → sample + hidden test cases in stdin format
            # First 3 become sample (visible); rest become hidden
            sample_tcs: list[dict] = []
            hidden_tcs: list[dict] = []
            for i, tc in enumerate(raw_io):
                inp_str = str(tc.get("input") or "")
                out_val = tc.get("output")
                if out_val is None:
                    continue

                # Normalise output: None / "None" / empty list → -1 sentinel
                # This avoids null-handling crashes in C++/Java/Rust/C# wrappers
                if out_val in (None, "None", [], "null") or out_val == []:
                    expected = "-1"
                else:
                    expected = json.dumps(out_val, separators=(",", ":")) if not isinstance(out_val, str) else out_val
                    # Also replace inline "None" string outputs
                    if expected.strip() == "None":
                        expected = "-1"

                stdin = _kwargs_to_stdin(inp_str, param_names) if param_names else None
                if stdin is None:
                    # Fallback: store raw input string as-is
                    stdin = inp_str

                tc_dict = {
                    "id": f"{'sample' if i < 3 else 'hidden'}_{i + 1}",
                    "description": "Sample test case" if i < 3 else "Hidden test case",
                    "input": stdin,
                    "output": expected,
                }
                if i < 3:
                    sample_tcs.append(tc_dict)
                else:
                    hidden_tcs.append(tc_dict)

            enrichment[slug] = {
                "question_id":       qid,
                "tags":              tags,
                "starter_code_py3":  starter_code,
                "solution_py3":      completion,
                "entry_point":       entry_point,
                "sample_test_cases": sample_tcs,
                "hidden_test_cases": hidden_tcs,
            }
        except Exception as e:
            print(f"  WARN row skipped: {e}")

    print(f"  Enrichment entries: {len(enrichment)}")
    return enrichment


# ── Merge ─────────────────────────────────────────────────────────────────────

def merge(
    d1: dict[str, dict],   # highest priority full questions (greengerong)
    d2: dict[str, dict],   # topic/slug enrichment only (mercury), keyed by numeric id
    d3: dict[str, dict],   # lowest priority full questions (assembly)
    d4: dict[str, dict],   # real test cases + tags (newfacade), keyed by slug
) -> dict[str, dict]:
    """
    d1 and d3 are full question dicts keyed by numeric problem id string.
    d2 is sparse {pid: {topics, slug}} from Mercury.
    d4 is {slug: {tags, sample_test_cases, hidden_test_cases, solution_py3}} from newfacade.
    """
    merged: dict[str, dict] = {}

    # Layer 3 (lowest full source)
    for pid, q in d3.items():
        merged[pid] = q

    # Layer 1 (highest full source — overwrites d3)
    for pid, q in d1.items():
        if pid in merged:
            base = q.copy()
            extra = merged[pid]
            base["follow_up"] = sorted(set(base.get("follow_up", []) + extra.get("follow_up", [])))
            base["hints"] = list(dict.fromkeys(base.get("hints", []) + extra.get("hints", [])))
            for lang, snippet in extra.get("code_snippets", {}).items():
                if lang not in base.get("code_snippets", {}):
                    base.setdefault("code_snippets", {})[lang] = snippet
            if not base.get("solution") and extra.get("solution"):
                base["solution"] = extra["solution"]
            merged[pid] = base
        else:
            merged[pid] = q

    # Layer 2 (Mercury) — enrich topics and fix slug where missing
    for pid, enrichment in d2.items():
        if pid not in merged:
            continue
        q = merged[pid]
        if not q.get("topics") and enrichment.get("topics"):
            q["topics"] = enrichment["topics"]
        elif enrichment.get("topics"):
            q["topics"] = sorted(set(q["topics"] + enrichment["topics"]))
        if not q.get("problem_slug") and enrichment.get("slug"):
            q["problem_slug"] = enrichment["slug"]

    # Layer 4 (newfacade) — inject real test cases, tags, and python3 starter/solution
    # Match by problem_slug since newfacade is keyed by slug
    for pid, q in merged.items():
        slug = q.get("problem_slug", "")
        nf = d4.get(slug)
        if not nf:
            continue
        # Real test cases always win — replace empty arrays
        if nf.get("sample_test_cases"):
            q["sample_test_cases"] = nf["sample_test_cases"]
        if nf.get("hidden_test_cases"):
            q["hidden_test_cases"] = nf["hidden_test_cases"]
        # Enrich topics from newfacade tags
        if nf.get("tags"):
            existing = q.get("topics") or []
            q["topics"] = sorted(set(existing + nf["tags"]))
        # Add verified python3 starter + solution code if not already present
        if nf.get("starter_code_py3"):
            snippets = q.setdefault("code_snippets", {})
            if "python3" not in snippets:
                snippets["python3"] = {"starter_code": nf["starter_code_py3"], "wrapper_code": ""}
        if nf.get("solution_py3"):
            q.setdefault("solution", {})
            if not q["solution"]:
                q["solution"] = {"python3": nf["solution_py3"]}
            elif isinstance(q["solution"], dict) and not q["solution"].get("python3"):
                q["solution"]["python3"] = nf["solution_py3"]

    return merged


# ── Save ──────────────────────────────────────────────────────────────────────

def save(questions: dict[str, dict], output_dir: Path, limit: int = 0) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    saved = 0
    skipped = 0

    # Sort by numeric problem_id so we get problems 1..N in order
    def sort_key(item: tuple) -> tuple:
        pid, _ = item
        try:
            return (0, int(pid))
        except ValueError:
            return (1, pid)

    sorted_questions = sorted(questions.items(), key=sort_key)
    if limit > 0:
        sorted_questions = sorted_questions[:limit]
        print(f"  Limiting to first {limit} problems (by ID)")

    for pid, q in sorted_questions:
        if not q.get("title") or not q.get("description"):
            skipped += 1
            continue
        if not q.get("sample_test_cases"):
            skipped += 1
            continue

        try:
            num = int(pid)
            filename = f"{str(num).zfill(4)}-{q['problem_slug']}.json"
        except ValueError:
            filename = f"{q['problem_slug']}.json"

        try:
            filepath = output_dir / filename
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(q, f, indent=2, ensure_ascii=False)
            saved += 1
        except Exception as e:
            print(f"  WARN could not save {pid}: {e}")
            skipped += 1

    print(f"\n  Saved:   {saved} files  →  {output_dir}")
    print(f"  Skipped: {skipped} invalid entries")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="Fetch and combine LeetCode datasets")
    parser.add_argument("--limit", type=int, default=0,
                        help="Max number of questions to save (0 = all, sorted by problem ID)")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent
    output_dir = project_root / "Questions" / "DSA_questions"

    print("=" * 60)
    print("  Practers — LeetCode dataset combiner")
    print(f"  Output: {output_dir}")
    if args.limit:
        print(f"  Limit:  {args.limit} questions")
    print("=" * 60)

    d1 = load_greengerong()
    d2 = load_mercury()
    d3 = load_assembly()
    d4 = load_newfacade()

    print("\n[Merging...]")
    combined = merge(d1, d2, d3, d4)
    print(f"  Total unique problems: {len(combined)}")

    print("\n[Saving JSON files...]")
    save(combined, output_dir, limit=args.limit)

    print("\n Done!")
    print("  Next step — process with LLM pipeline:")
    print("    npx tsx apps/api/src/scripts/process-dataset.ts")


if __name__ == "__main__":
    main()
