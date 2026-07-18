# Reference — schema, house style, templates, TLE calibration

Source of truth: `apps/api/src/models/DSAQuestion.ts` (Mongoose model, collection
`dsa_questions`). A production-quality example lives at
`tmp/monster-battle.contest-question.json` — read it if you need a full concrete sample.

## 1. Schema — every field, what goes in it

| Field | Type | Rule |
|---|---|---|
| `title` | string | Searchable, Title Case, no company names in it |
| `problemId` | string | = slug (unique in DB) |
| `frontendId` | string | Leave OUT — insert script auto-assigns next numeric id |
| `difficulty` | enum | `"Easy" \| "Medium" \| "Hard"` |
| `problemSlug` | string | kebab-case of title, `^[a-z0-9-]+$` |
| `timeLimit` | number | seconds, default `2` (range 0.1–5) |
| `memoryLimit` | number | MB, default `256` |
| `topics` | string[] | 2–4, e.g. `"Dynamic Programming"`, `"Two Pointers"`, `"Binary Search"`, `"Greedy"`, `"Graphs"`, `"Sorting"`, `"Hash Map"`, `"Stack"`, `"Sliding Window"` |
| `companyTags` | string[] | Real companies with documented association, else `[]` |
| `description` | string | Markdown + LaTeX, house style below |
| `examples` | `{example_num, example_text}[]` | 2–3, format below |
| `constraints` | string[] | LaTeX bounds, e.g. `"$1 \\le N \\le 2 \\times 10^5$"` |
| `sampleTestCases` | `{id, description, input, output}[]` | 2–3; ids `sample_1..`; **must mirror the examples** |
| `hiddenTestCases` | same | 10–17; ids `hidden_*` + ≥2 `tle_*` guards |
| `codeSnippets` | map lang → `{starter_code, wrapper_code}` | all 4 langs: `python3`, `cpp`, `java`, `javascript` |
| `solution.bruteForce` | `{explanation, timeComplexity, spaceComplexity, code{lang→str}}` | all 4 langs |
| `solution.optimized` | same | all 4 langs |
| `followUp` | string[] | 1–2 extension questions |
| `hints` | string[] | 2–3, progressive (nudge → key insight), no spoiler in hint 1 |
| `judgeType` | string | always `"default"`; `checkerLanguage`/`checkerCode` = `null` |

Test case `input`/`output` are **plain strings** (stdin/stdout text, `\n`-separated
lines, no trailing whitespace). Output compared with exact match after trim.

## 2. Description house style

Structure (in this order):

```
<Problem narrative — your own story, 2–4 short paragraphs. Use $LaTeX$ for every
variable and formula: $N$, $A_i$, $1 \le i \le N$. Bold key mechanics with **...**.>

### Function Description

Complete the function `<methodName>` provided in the editor.

The function receives the following parameters:

| Parameter | Type | Description |
|---|---|---|
| $N$ | integer | ... |
| $A$ | array of integers | ... |

The function must return <exact return description>.

### Input Format

- The first line contains a single integer $N$.
- The second line contains $N$ space-separated integers $A_1, \ldots, A_N$.

### Output Format

Return a single integer: <what it means>.

### Notes

- <clarifying bullet>
- <clarifying bullet>
```

Examples (`example_text`) format:

```
Input:
```text
5
3 1 4 1 5
```

Output:
```text
7
```

Explanation:

<Step-by-step walk-through referencing the actual numbers, using $LaTeX$.>
```

`sampleTestCases[i].input/output` must contain exactly the same data as example i.

## 3. Wrapper templates — class approach (NO `<USER_CODE>`)

The judge concatenates the user's `class Solution` with `wrapper_code` into one file.
The wrapper is a complete `main` that parses stdin, calls the method, prints the result.
Adapt only: the parsing block, the method name/signature, and output printing.
Use `long long` (C++) / `long` (Java) whenever values or sums can exceed 2³¹.

### python3

```python
# starter_code
class Solution:
    def methodName(self, N: int, A: list[int]) -> int:
        # Write your code here
        return 0
```

```python
# wrapper_code
import sys

def main():
    data = sys.stdin.buffer.read().split()
    if not data:
        return
    N = int(data[0])
    A = [int(x) for x in data[1:1 + N]]
    print(Solution().methodName(N, A))

if __name__ == "__main__":
    main()
```

### cpp

```cpp
// starter_code
class Solution {
public:
    long long methodName(int N, vector<long long>& A) {
        // Write your code here
        return 0;
    }
};
```

```cpp
// wrapper_code
#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int N;
    if (!(cin >> N)) return 0;
    vector<long long> A(N);
    for (int i = 0; i < N; i++) cin >> A[i];
    Solution sol;
    cout << sol.methodName(N, A);
    return 0;
}
```

Note: the wrapper includes `<bits/stdc++.h>`; the starter uses `vector` etc. freely
because the judge hoists includes before the user class.

### java

```java
// starter_code
class Solution {
    public long methodName(int N, long[] A) {
        // Write your code here
        return 0;
    }
}
```

```java
// wrapper_code  (fast IO — keep the FastScanner)
import java.io.*;
import java.util.*;

public class Main {
    static class FastScanner {
        private final InputStream in = System.in;
        private final byte[] buffer = new byte[1 << 16];
        private int ptr = 0, len = 0;

        private int read() throws IOException {
            if (ptr >= len) {
                len = in.read(buffer);
                ptr = 0;
                if (len <= 0) return -1;
            }
            return buffer[ptr++];
        }

        long nextLong() throws IOException {
            int c;
            do { c = read(); } while (c <= ' ' && c != -1);
            long sign = 1;
            if (c == '-') { sign = -1; c = read(); }
            long value = 0;
            while (c > ' ') { value = value * 10 + (c - '0'); c = read(); }
            return value * sign;
        }

        int nextInt() throws IOException { return (int) nextLong(); }
    }

    public static void main(String[] args) throws Exception {
        FastScanner fs = new FastScanner();
        int N = fs.nextInt();
        long[] A = new long[N];
        for (int i = 0; i < N; i++) A[i] = fs.nextLong();
        Solution sol = new Solution();
        System.out.print(sol.methodName(N, A));
    }
}
```

### javascript

```javascript
// starter_code
class Solution {
    methodName(N, A) {
        // Write your code here
        return 0;
    }
}
```

```javascript
// wrapper_code
const fs = require('fs');
const data = fs.readFileSync(0, 'utf8').trim().split(/\s+/).map(Number);

if (data.length > 0) {
    const N = data[0];
    const A = data.slice(1, 1 + N);
    const sol = new Solution();
    console.log(String(sol.methodName(N, A)));
}
```

Method name: one short descriptive camelCase name (e.g. `maxProfit`, `minSwaps`) used
identically in all 4 languages AND in the description's Function Description section.
JS caution: values above 2⁵³ are unsafe in `Number` — design constraints so final and
intermediate sums stay below ~9×10¹⁵, or note `BigInt` in the JS solutions.

## 4. TLE calibration table — two-sided rule

The guard case must make **C++ brute** TLE (fastest language) while **Python optimized**
passes (slowest language). C++ does ~10⁹ simple ops/sec; interpreted Python ~10⁷.

| Brute | Optimized | Guard size | Guard input bytes | Notes |
|---|---|---|---|---|
| O(2^N) / O(N!) backtracking | any poly | N = 25–40 (or larger N where the branch factor explodes) | tiny | Safest pattern. Keep brute iterative-ish or shallow so it TLEs rather than stack-overflows. |
| O(N²) | O(N log N) / O(N) | N = 2×10⁵ | ~1.2 MB | N² = 4×10¹⁰ → TLE in every language. |
| O(N³) | O(N log N) / O(N) | N = 3000–5000 | ~20 KB | 2.7×10¹⁰+ ops. |
| O(N·X) pseudo-poly (X = value bound) | O(N log N) greedy / DP on N | N·X ≥ 5×10⁹ | small | e.g. N=10³, X=10⁷. |

Rules that make this work:

- **Stated constraints vs hidden max:** the constraint section may state a bound (e.g.
  $N \le 2\times10^5$), and the largest hidden case should sit at a size where BOTH sides
  of the rule hold. The hidden max may be below the stated bound if needed for
  Python-optimized headroom (monster-battle does exactly this) — but never above it.
- **Python optimized budget:** ≤ ~5×10⁶ interpreted-loop operations at the guard size
  (sort/dict/heap operations count as cheap). Measured locally ≤ 60% of `timeLimit`.
- **Total input budget:** keep the sum of all test-case strings under ~6 MB (Mongo doc
  limit is 16 MB). At most 2 cases above 1 MB.
- **Brute correctness cases:** brute must produce correct output on every non-guard
  case, so size non-guard cases within brute's reach (e.g. N ≤ 15 for exponential brute,
  N ≤ 2000 for O(N²) brute).

## 5. Test-suite composition (10–17 hidden cases)

1. Minimum size (N=1) and other boundary values from the constraints
2. All-equal elements; sorted; reverse-sorted; duplicates
3. Answer = 0 / empty-selection case, and answer = everything case
4. The counterexample that kills the natural wrong greedy (design one deliberately)
5. Max/min element values (10⁹ boundaries — overflow probes)
6. 3–5 random mid-size cases from `gen.py` (seeded, reproducible)
7. ≥2 `tle_*` guards at the calibrated size

## 6. meta.json shape (consumed by assemble-question.py)

```json
{
  "title": "...", "problemSlug": "...", "difficulty": "Medium",
  "timeLimit": 2, "memoryLimit": 256,
  "topics": ["..."], "companyTags": [],
  "description": "...",
  "examples": [{ "example_num": 1, "example_text": "..." }],
  "constraints": ["$...$"],
  "followUp": ["..."], "hints": ["..."],
  "solution": {
    "bruteForce": { "explanation": "...", "timeComplexity": "O(2^N)", "spaceComplexity": "O(N)" },
    "optimized":  { "explanation": "...", "timeComplexity": "O(N \\log N)", "spaceComplexity": "O(N)" }
  }
}
```

Directory layout the assembler expects:

```
<question-dir>/
  meta.json
  tests/
    sample_1.in  sample_1.out   ← ids: sample_* → sampleTestCases, everything else → hidden
    hidden_1.in  hidden_1.out
    tle_1.in     tle_1.out
    descriptions.json            ← { "sample_1": "...", "hidden_1": "...", ... }
  code/
    python3/    starter.py  wrapper.py  brute.py  optimized.py
    cpp/        starter.cpp wrapper.cpp brute.cpp optimized.cpp
    java/       starter.java wrapper.java brute.java optimized.java
    javascript/ starter.js  wrapper.js  brute.js  optimized.js
```

`brute.*`/`optimized.*` are the **class only** (what goes into `solution.*.code`);
the runnable files used for local verification are class+wrapper concatenated —
`verify-solutions.py --wrapper` handles the concatenation for you.

## 7. Company tags — allowed sources

Tag a company only when at least one holds: (a) the source image/page explicitly lists
it; (b) the underlying classic problem has a widely documented association (e.g. Two Sum
→ Google/Amazon-tier lists on major prep sites). When in doubt → `[]`. Banned values:
anything matching AI/GPT/Claude/LLM/generated/bot (insert script rejects these).

## 8. Rewording rules (image mode)

- New narrative frame (heroes→servers, coins→tasks, etc.), new variable names, new
  example numbers, all-new test data. No sentence survives from the source.
- Keep: the algorithmic task, constraint magnitudes, difficulty, and the searchable
  title with at most one word changed/added.
- The description must read as a native practers question (house style above), not as a
  paraphrase.
