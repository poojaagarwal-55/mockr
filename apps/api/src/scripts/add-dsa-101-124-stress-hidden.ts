/**
 * Adds one generated stress hidden test to DSA questions 101-124.
 *
 * Usage:
 *   npx tsx apps/api/src/scripts/add-dsa-101-124-stress-hidden.ts
 *
 * The script is idempotent. It replaces only the generated stress guard,
 * preserves normal samples/hidden tests, and patches genuinely slow brute
 * snippets for questions where a natural brute-force version is possible.
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
try {
    dns.setServers(["8.8.8.8", "8.8.4.4"]);
} catch {}

import * as dotenv from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";

import { DSAQuestion } from "../models/DSAQuestion.js";

const currentDir =
    typeof __dirname !== "undefined"
        ? __dirname
        : fileURLToPath(new URL(".", (import.meta as any).url));

const envCandidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "apps/api/.env"),
    path.resolve(currentDir, "../../../../.env"),
];
const envPath = envCandidates.find((candidate) => existsSync(candidate));
dotenv.config(envPath ? { path: envPath, quiet: true } : { quiet: true });

type StressCase = {
    id: string;
    description: string;
    input: string;
    output: string;
    timeLimitSeconds: number;
};

type Language = "cpp" | "python3" | "java" | "javascript";

const STRESS_ID = "hidden_stress_101_124_guard";

function lines(parts: Array<string | number | bigint>): string {
    return parts.map(String).join("\n");
}

function spaced(values: Array<string | number | bigint>): string {
    return values.map(String).join(" ");
}

function repeatValue(value: string | number | bigint, count: number): string {
    return Array.from({ length: count }, () => String(value)).join(" ");
}

function repeatLines(value: string | number | bigint, count: number): string {
    return Array.from({ length: count }, () => String(value)).join("\n");
}

function withRuntimeConstraints(constraints: string[] | undefined, seconds: number): string[] {
    const kept = (constraints || []).filter(
        (line) => !/^time\s*limit\s*[:=]/i.test(line) && !/^memory\s*limit\s*[:=]/i.test(line)
    );
    return [...kept, `Time Limit: ${Math.min(5, Math.max(1, seconds))}s`, "Memory Limit: 256MB"];
}

function alphabetSymbols(n: number): string {
    const alphabet = "abcdefghijklmnopqrstuvwxyz";
    return Array.from({ length: n }, (_, i) => alphabet[i % alphabet.length]).join(" ");
}

function alternatingBR(n: number): string {
    return Array.from({ length: n }, (_, i) => (i % 2 === 0 ? "B" : "R")).join("");
}

function increasingNumbers(n: number): string {
    return Array.from({ length: n }, (_, i) => String(i + 1)).join(" ");
}

function decodeCenterOut(stored: string): string {
    let left = 0;
    let right = stored.length - 1;
    const answer = Array(stored.length).fill("");
    for (let i = stored.length - 1; i >= 0; i--) {
        answer[i] = i % 2 === 0 ? stored[right--] : stored[left++];
    }
    return answer.join("");
}

function simulateQueue(line: string, seconds: number): string {
    const chars = line.split("");
    for (let step = 0; step < seconds; step++) {
        for (let i = 0; i + 1 < chars.length; i++) {
            if (chars[i] === "B" && chars[i + 1] === "G") {
                chars[i] = "G";
                chars[i + 1] = "B";
                i++;
            }
        }
    }
    return chars.join("");
}

function apartmentPlan(n: bigint): string {
    for (let b = 0n; b < 3n; b++) {
        for (let c = 0n; c < 3n; c++) {
            const rem = n - 5n * b - 7n * c;
            if (rem >= 0n && rem % 3n === 0n) return `${rem / 3n} ${b} ${c}`;
        }
    }
    return "-1";
}

function shiftedKeyboardOutput(direction: "L" | "R", typed: string): string {
    const keys = "qwertyuiopasdfghjkl;zxcvbnm,./";
    let answer = "";
    for (const ch of typed) {
        const pos = keys.indexOf(ch);
        answer += keys[pos + (direction === "R" ? -1 : 1)]!;
    }
    return answer;
}

const BRUTE_CODE_PATCHES: Record<string, Partial<Record<Language, string>>> = {
    "104": {
        cpp: `class Solution {
public:
    long long sprintSchedulePlanner(long long n, long long k) {
        long long remaining = 240 - k;
        long long done = 0;
        for (long long task = 1; task <= n; ++task) {
            long long cost = 5 * task;
            if (remaining >= cost) {
                remaining -= cost;
                done++;
            }
        }
        return done;
    }
};`,
        python3: `class Solution:
    def sprintSchedulePlanner(self, n, k):
        remaining = 240 - k
        done = 0
        for task in range(1, n + 1):
            cost = 5 * task
            if remaining >= cost:
                remaining -= cost
                done += 1
        return done`,
        java: `class Solution {
    public long sprintSchedulePlanner(long n, long k) {
        long remaining = 240 - k;
        long done = 0;
        for (long task = 1; task <= n; task++) {
            long cost = 5 * task;
            if (remaining >= cost) {
                remaining -= cost;
                done++;
            }
        }
        return done;
    }
}`,
        javascript: `class Solution {
    sprintSchedulePlanner(n, k) {
        let remaining = 240 - k;
        let done = 0;
        for (let task = 1; task <= n; task++) {
            const cost = 5 * task;
            if (remaining >= cost) {
                remaining -= cost;
                done++;
            }
        }
        return done;
    }
}`,
    },
    "108": {
        cpp: `class Solution {
public:
    vector<long long> apartmentBundlePlanner(long long n) {
        vector<long long> answer;
        for (long long b = 0; b * 5 <= n; ++b) {
            for (long long c = 0; c * 7 <= n; ++c) {
                long long rem = n - 5 * b - 7 * c;
                if (rem >= 0 && rem % 3 == 0 && answer.empty()) {
                    answer = {rem / 3, b, c};
                }
            }
        }
        return answer.empty() ? vector<long long>{-1} : answer;
    }
};`,
        python3: `class Solution:
    def apartmentBundlePlanner(self, n):
        answer = None
        b = 0
        while 5 * b <= n:
            c = 0
            while 7 * c <= n:
                rem = n - 5 * b - 7 * c
                if rem >= 0 and rem % 3 == 0 and answer is None:
                    answer = [rem // 3, b, c]
                c += 1
            b += 1
        return answer if answer is not None else [-1]`,
        java: `class Solution {
    public long[] apartmentBundlePlanner(long n) {
        long[] answer = null;
        for (long b = 0; b * 5 <= n; b++) {
            for (long c = 0; c * 7 <= n; c++) {
                long rem = n - 5 * b - 7 * c;
                if (rem >= 0 && rem % 3 == 0 && answer == null) {
                    answer = new long[]{rem / 3, b, c};
                }
            }
        }
        return answer == null ? new long[]{-1} : answer;
    }
}`,
        javascript: `class Solution {
    apartmentBundlePlanner(n) {
        let answer = null;
        for (let b = 0n; b * 5n <= n; b++) {
            for (let c = 0n; c * 7n <= n; c++) {
                const rem = n - 5n * b - 7n * c;
                if (rem >= 0n && rem % 3n === 0n && answer === null) {
                    answer = [rem / 3n, b, c];
                }
            }
        }
        return answer === null ? [-1n] : answer;
    }
}`,
    },
    "109": {
        cpp: `class Solution {
public:
    string guestListReconstruction(string a, string b, string pile) {
        string need = a + b;
        vector<int> used(pile.size(), 0);
        for (char ch : need) {
            int chosen = -1;
            for (int i = 0; i < (int)pile.size(); ++i) {
                if (!used[i] && pile[i] == ch && chosen == -1) chosen = i;
            }
            if (chosen == -1) return "NO";
            used[chosen] = 1;
        }
        for (int value : used) if (!value) return "NO";
        return "YES";
    }
};`,
        python3: `class Solution:
    def guestListReconstruction(self, a, b, pile):
        need = a + b
        used = [False] * len(pile)
        for ch in need:
            chosen = -1
            for i, value in enumerate(pile):
                if not used[i] and value == ch and chosen == -1:
                    chosen = i
            if chosen == -1:
                return "NO"
            used[chosen] = True
        return "NO" if any(not flag for flag in used) else "YES"`,
        java: `class Solution {
    public String guestListReconstruction(String a, String b, String pile) {
        String need = a + b;
        boolean[] used = new boolean[pile.length()];
        for (int i = 0; i < need.length(); i++) {
            int chosen = -1;
            for (int j = 0; j < pile.length(); j++) {
                if (!used[j] && pile.charAt(j) == need.charAt(i) && chosen == -1) chosen = j;
            }
            if (chosen == -1) return "NO";
            used[chosen] = true;
        }
        for (boolean value : used) if (!value) return "NO";
        return "YES";
    }
}`,
        javascript: `class Solution {
    guestListReconstruction(a, b, pile) {
        const need = a + b;
        const used = Array(pile.length).fill(false);
        for (const ch of need) {
            let chosen = -1;
            for (let i = 0; i < pile.length; i++) {
                if (!used[i] && pile[i] === ch && chosen === -1) chosen = i;
            }
            if (chosen === -1) return "NO";
            used[chosen] = true;
        }
        return used.some((value) => !value) ? "NO" : "YES";
    }
}`,
    },
    "117": {
        cpp: `class Solution {
public:
    string centerOutDispatchDecoder(string s) {
        vector<char> pool(s.begin(), s.end());
        string ans(s.size(), ' ');
        for (int i = (int)s.size() - 1; i >= 0; --i) {
            if (i % 2 == 0) {
                ans[i] = pool.back();
                pool.pop_back();
            } else {
                ans[i] = pool.front();
                for (int j = 1; j < (int)pool.size(); ++j) pool[j - 1] = pool[j];
                pool.pop_back();
            }
        }
        return ans;
    }
};`,
        python3: `class Solution:
    def centerOutDispatchDecoder(self, s):
        pool = list(s)
        ans = [""] * len(s)
        for i in range(len(s) - 1, -1, -1):
            if i % 2 == 0:
                ans[i] = pool[-1]
                pool.pop()
            else:
                ans[i] = pool[0]
                for j in range(1, len(pool)):
                    pool[j - 1] = pool[j]
                pool.pop()
        return "".join(ans)`,
        java: `class Solution {
    public String centerOutDispatchDecoder(String s) {
        ArrayList<Character> pool = new ArrayList<>();
        for (int i = 0; i < s.length(); i++) pool.add(s.charAt(i));
        char[] ans = new char[s.length()];
        for (int i = s.length() - 1; i >= 0; i--) {
            if (i % 2 == 0) {
                ans[i] = pool.remove(pool.size() - 1);
            } else {
                ans[i] = pool.get(0);
                for (int j = 1; j < pool.size(); j++) pool.set(j - 1, pool.get(j));
                pool.remove(pool.size() - 1);
            }
        }
        return new String(ans);
    }
}`,
        javascript: `class Solution {
    centerOutDispatchDecoder(s) {
        const pool = s.split("");
        const ans = Array(s.length).fill("");
        for (let i = s.length - 1; i >= 0; i--) {
            if (i % 2 === 0) {
                ans[i] = pool.pop();
            } else {
                ans[i] = pool[0];
                for (let j = 1; j < pool.length; j++) pool[j - 1] = pool[j];
                pool.pop();
            }
        }
        return ans.join("");
    }
}`,
    },
    "118": {
        cpp: `class Solution {
public:
    int reactorCompressionSteps(long long n) {
        for (long long extra = 0; extra <= n; ++extra) {
            __int128 value = n;
            bool saturated = false;
            for (long long i = 0; i < extra; ++i) {
                value *= 2;
                if (value > (__int128)4000000000000000000LL) {
                    saturated = true;
                    break;
                }
            }
            long long steps = extra;
            while (!saturated && value % 6 == 0) {
                value /= 6;
                steps++;
            }
            if (!saturated && value == 1) return (int)steps;
        }
        return -1;
    }
};`,
        python3: `class Solution:
    def reactorCompressionSteps(self, n):
        for extra in range(n + 1):
            saturated = extra > 62
            value = n
            if not saturated:
                for _ in range(extra):
                    value *= 2
            steps = extra
            while not saturated and value % 6 == 0:
                value //= 6
                steps += 1
            if not saturated and value == 1:
                return steps
        return -1`,
        java: `class Solution {
    public int reactorCompressionSteps(long n) {
        for (long extra = 0; extra <= n; extra++) {
            java.math.BigInteger value = java.math.BigInteger.valueOf(n).shiftLeft((int)Math.min(extra, 62));
            boolean saturated = extra > 62;
            long steps = extra;
            java.math.BigInteger six = java.math.BigInteger.valueOf(6);
            while (!saturated && value.mod(six).equals(java.math.BigInteger.ZERO)) {
                value = value.divide(six);
                steps++;
            }
            if (!saturated && value.equals(java.math.BigInteger.ONE)) return (int)steps;
        }
        return -1;
    }
}`,
        javascript: `class Solution {
    reactorCompressionSteps(n) {
        for (let extra = 0n; extra <= n; extra++) {
            const saturated = extra > 62n;
            let value = n;
            if (!saturated) {
                for (let i = 0n; i < extra; i++) value *= 2n;
            }
            let steps = Number(extra);
            while (!saturated && value % 6n === 0n) {
                value /= 6n;
                steps++;
            }
            if (!saturated && value === 1n) return steps;
        }
        return -1;
    }
}`,
    },
    "119": {
        cpp: `class Solution {
public:
    int teamEligibilityCounter(int k, vector<int>& counts) {
        int n = counts.size(), teams = 0;
        vector<int> used(n, 0);
        while (true) {
            vector<int> picked;
            for (int i = 0; i < n && (int)picked.size() < 3; ++i) {
                if (!used[i] && counts[i] + k <= 5) picked.push_back(i);
            }
            if ((int)picked.size() < 3) break;
            for (int idx : picked) used[idx] = 1;
            teams++;
        }
        return teams;
    }
};`,
        python3: `class Solution:
    def teamEligibilityCounter(self, k, counts):
        used = [False] * len(counts)
        teams = 0
        while True:
            picked = []
            for i, value in enumerate(counts):
                if not used[i] and value + k <= 5:
                    picked.append(i)
                    if len(picked) == 3:
                        break
            if len(picked) < 3:
                break
            for idx in picked:
                used[idx] = True
            teams += 1
        return teams`,
        java: `class Solution {
    public int teamEligibilityCounter(int k, int[] counts) {
        boolean[] used = new boolean[counts.length];
        int teams = 0;
        while (true) {
            int[] picked = new int[3];
            int size = 0;
            for (int i = 0; i < counts.length && size < 3; i++) {
                if (!used[i] && counts[i] + k <= 5) picked[size++] = i;
            }
            if (size < 3) break;
            for (int idx : picked) used[idx] = true;
            teams++;
        }
        return teams;
    }
}`,
        javascript: `class Solution {
    teamEligibilityCounter(k, counts) {
        const used = Array(counts.length).fill(false);
        let teams = 0;
        while (true) {
            const picked = [];
            for (let i = 0; i < counts.length && picked.length < 3; i++) {
                if (!used[i] && counts[i] + k <= 5) picked.push(i);
            }
            if (picked.length < 3) break;
            for (const idx of picked) used[idx] = true;
            teams++;
        }
        return teams;
    }
}`,
    },
};

const BRUTE_META_PATCHES: Record<string, { explanation: string; timeComplexity: string; spaceComplexity: string }> = {
    "104": {
        explanation: "Try every possible task number up to n and count it only when the remaining contest time can still pay its cost.",
        timeComplexity: "O(n)",
        spaceComplexity: "O(1)",
    },
    "109": {
        explanation: "For every required character, scan the entire received pile and mark one unused matching character.",
        timeComplexity: "O(L^2), where L is the total string length",
        spaceComplexity: "O(L)",
    },
    "117": {
        explanation: "Keep a mutable pool of stored characters; removing from the front shifts the remaining pool one position at a time.",
        timeComplexity: "O(n^2)",
        spaceComplexity: "O(n)",
    },
    "118": {
        explanation: "Try possible counts of extra multiply-by-2 operations, then test whether repeated division by 6 reaches 1.",
        timeComplexity: "O(n log n)",
        spaceComplexity: "O(1)",
    },
    "119": {
        explanation: "Repeatedly build one team by rescanning all unused students until three eligible members are found.",
        timeComplexity: "O(n^2)",
        spaceComplexity: "O(n)",
    },
};

const LARGE_TOTAL_CASE_N = 299_961;
const SMALL_CASES = 39;

function build101(): StressCase {
    const parts: Array<string | number> = [40, LARGE_TOTAL_CASE_N, alphabetSymbols(LARGE_TOTAL_CASE_N)];
    for (let i = 0; i < SMALL_CASES; i++) parts.push(1, "a");
    return {
        id: STRESS_ID,
        description: "One maximum packet plus many tiny packets catches quadratic previous-symbol scans.",
        input: lines(parts),
        output: ["26", ...Array.from({ length: SMALL_CASES }, () => "1")].join("\n"),
        timeLimitSeconds: 3,
    };
}

function build102(): StressCase {
    const parts: Array<string | number> = [40, `${LARGE_TOTAL_CASE_N} 100`, repeatValue(101, LARGE_TOTAL_CASE_N)];
    for (let i = 0; i < SMALL_CASES; i++) parts.push("1 100", "50");
    return {
        id: STRESS_ID,
        description: "Maximum participant volume verifies width accumulation and T-case parsing.",
        input: lines(parts),
        output: [String(LARGE_TOTAL_CASE_N * 2), ...Array.from({ length: SMALL_CASES }, () => "1")].join("\n"),
        timeLimitSeconds: 2,
    };
}

function build103(): StressCase {
    const parts: Array<string | number> = [40, LARGE_TOTAL_CASE_N, increasingNumbers(LARGE_TOTAL_CASE_N)];
    for (let i = 0; i < SMALL_CASES; i++) parts.push(1, i + 1);
    return {
        id: STRESS_ID,
        description: "A maximum all-unique archive forces pairwise duplicate checks to scan every previous value.",
        input: lines(parts),
        output: [String(LARGE_TOTAL_CASE_N), ...Array.from({ length: SMALL_CASES }, () => "1")].join("\n"),
        timeLimitSeconds: 3,
    };
}

function build104(): StressCase {
    const t = 100_000;
    return {
        id: STRESS_ID,
        description: "Maximum sprint batch verifies constant-time planning across many cases.",
        input: lines([t, ...Array.from({ length: t }, () => "1000000000 0")]),
        output: repeatLines(9, t),
        timeLimitSeconds: 2,
    };
}

function build105(): StressCase {
    const stripe = "?".repeat(LARGE_TOTAL_CASE_N);
    const parts: Array<string | number> = [40, LARGE_TOTAL_CASE_N, stripe];
    for (let i = 0; i < SMALL_CASES; i++) parts.push(1, "?");
    return {
        id: STRESS_ID,
        description: "A maximum unknown stripe verifies deterministic recovery and output volume.",
        input: lines(parts),
        output: [alternatingBR(LARGE_TOTAL_CASE_N), ...Array.from({ length: SMALL_CASES }, () => "B")].join("\n"),
        timeLimitSeconds: 3,
    };
}

function build106(): StressCase {
    const parts: Array<string | number> = [40, LARGE_TOTAL_CASE_N, repeatValue(1, LARGE_TOTAL_CASE_N)];
    for (let i = 0; i < SMALL_CASES; i++) parts.push(1, 0);
    return {
        id: STRESS_ID,
        description: "Maximum parity-mismatch batch verifies impossible repair detection.",
        input: lines(parts),
        output: ["-1", ...Array.from({ length: SMALL_CASES }, () => "0")].join("\n"),
        timeLimitSeconds: 2,
    };
}

function build107(): StressCase {
    const parts: Array<string | number> = [40, LARGE_TOTAL_CASE_N, increasingNumbers(LARGE_TOTAL_CASE_N)];
    for (let i = 0; i < SMALL_CASES; i++) parts.push(1, 1);
    return {
        id: STRESS_ID,
        description: "A maximum nondecreasing run catches quadratic streak starts.",
        input: lines(parts),
        output: [String(LARGE_TOTAL_CASE_N), ...Array.from({ length: SMALL_CASES }, () => "1")].join("\n"),
        timeLimitSeconds: 3,
    };
}

function build108(): StressCase {
    const hard = 999_999_999_999_999_999n;
    return {
        id: STRESS_ID,
        description: "A huge bundle request forces exhaustive bundle-count brute force to keep scanning after finding the first valid plan.",
        input: lines([40, hard, ...Array.from({ length: SMALL_CASES }, () => "1")]),
        output: [apartmentPlan(hard), ...Array.from({ length: SMALL_CASES }, () => "-1")].join("\n"),
        timeLimitSeconds: 2,
    };
}

function build109(): StressCase {
    const a = "a".repeat(74_900);
    const b = "b".repeat(74_900);
    const pile = a + b;
    const parts: Array<string | number> = [40, `${a} ${b} ${pile}`];
    for (let i = 0; i < SMALL_CASES; i++) parts.push("a b ab");
    return {
        id: STRESS_ID,
        description: "Large badge piles punish repeated erase-based multiset reconstruction.",
        input: lines(parts),
        output: repeatLines("YES", 40),
        timeLimitSeconds: 3,
    };
}

function build110(): StressCase {
    const t = 100_000;
    return {
        id: STRESS_ID,
        description: "Maximum timer batch checks repeated near-full-day countdown cases.",
        input: lines([t, ...Array.from({ length: t }, () => "0 1")]),
        output: repeatLines(1439, t),
        timeLimitSeconds: 2,
    };
}

function build111(): StressCase {
    const t = 40_000;
    const answer = 500_000_500_000n;
    return {
        id: STRESS_ID,
        description: "Many maximum loan plans force day-by-day brute summation to run far too long.",
        input: lines([t, ...Array.from({ length: t }, () => "1 0 1000000")]),
        output: repeatLines(answer, t),
        timeLimitSeconds: 2,
    };
}

function build112(): StressCase {
    const t = 40;
    return {
        id: STRESS_ID,
        description: "Huge odd loads force split-search brute force to scan an impossible range.",
        input: lines([t, ...Array.from({ length: t }, () => "999999999999999999")]),
        output: repeatLines("NO", t),
        timeLimitSeconds: 2,
    };
}

function build113(): StressCase {
    const original = "a".repeat(149_900);
    const received = original;
    const parts: Array<string | number> = [40, `${original} ${received}`];
    for (let i = 0; i < SMALL_CASES; i++) parts.push("a a");
    return {
        id: STRESS_ID,
        description: "Maximum mirrored words verify reverse comparison across total string limits.",
        input: lines(parts),
        output: repeatLines("YES", 40),
        timeLimitSeconds: 2,
    };
}

function build114(): StressCase {
    const t = 40;
    const n = 1_000_000_000_000_000_000n;
    return {
        id: STRESS_ID,
        description: "Huge n values make pairwise gcd search impossible while the shortcut is immediate.",
        input: lines([t, ...Array.from({ length: t }, () => n)]),
        output: repeatLines(n / 2n, t),
        timeLimitSeconds: 2,
    };
}

function build115(): StressCase {
    const parts: Array<string | number> = [40, LARGE_TOTAL_CASE_N, increasingNumbers(LARGE_TOTAL_CASE_N)];
    for (let i = 0; i < SMALL_CASES; i++) parts.push(1, 1);
    return {
        id: STRESS_ID,
        description: "A maximum strictly increasing run catches quadratic streak starts.",
        input: lines(parts),
        output: [String(LARGE_TOTAL_CASE_N), ...Array.from({ length: SMALL_CASES }, () => "1")].join("\n"),
        timeLimitSeconds: 3,
    };
}

function build116(): StressCase {
    const hardA = repeatValue(1, 12);
    const hardB = repeatValue(100, 12);
    const parts: Array<string | number> = [40, "12 6", hardA, hardB];
    for (let i = 0; i < SMALL_CASES; i++) parts.push("1 0", "1", "2");
    return {
        id: STRESS_ID,
        description: "A small but high-branching swap plan makes recursive brute search explode.",
        input: lines(parts),
        output: ["606", ...Array.from({ length: SMALL_CASES }, () => "1")].join("\n"),
        timeLimitSeconds: 5,
    };
}

function build117(): StressCase {
    const stored = "abcdefghijklmnopqrstuvwxyz".repeat(Math.ceil(LARGE_TOTAL_CASE_N / 26)).slice(0, LARGE_TOTAL_CASE_N);
    const parts: Array<string | number> = [40, LARGE_TOTAL_CASE_N, stored];
    for (let i = 0; i < SMALL_CASES; i++) parts.push(1, "z");
    return {
        id: STRESS_ID,
        description: "A maximum stored message punishes deque-front erase decoders.",
        input: lines(parts),
        output: [decodeCenterOut(stored), ...Array.from({ length: SMALL_CASES }, () => "z")].join("\n"),
        timeLimitSeconds: 3,
    };
}

function build118(): StressCase {
    const t = 40;
    return {
        id: STRESS_ID,
        description: "Huge non-compressible reactor values verify arithmetic rejection without overflow-sensitive guessing.",
        input: lines([t, ...Array.from({ length: t }, () => "1000000000000000000")]),
        output: repeatLines("-1", t),
        timeLimitSeconds: 2,
    };
}

function build119(): StressCase {
    const parts: Array<string | number> = [40, `${LARGE_TOTAL_CASE_N} 0`, repeatValue(0, LARGE_TOTAL_CASE_N)];
    for (let i = 0; i < SMALL_CASES; i++) parts.push("3 0", "0 0 0");
    return {
        id: STRESS_ID,
        description: "A maximum all-eligible class forces repeated team-picking brute force to rescan used students.",
        input: lines(parts),
        output: [String(Math.floor(LARGE_TOTAL_CASE_N / 3)), ...Array.from({ length: SMALL_CASES }, () => "1")].join("\n"),
        timeLimitSeconds: 3,
    };
}

function build120(): StressCase {
    const typed = "s".repeat(LARGE_TOTAL_CASE_N);
    const parts: Array<string | number> = [40, `R ${typed}`];
    for (let i = 0; i < SMALL_CASES; i++) parts.push("R s");
    return {
        id: STRESS_ID,
        description: "Maximum keyboard text verifies layout lookup and output volume.",
        input: lines(parts),
        output: [shiftedKeyboardOutput("R", typed), ...Array.from({ length: SMALL_CASES }, () => "a")].join("\n"),
        timeLimitSeconds: 2,
    };
}

function build121(): StressCase {
    const s = "A".repeat(LARGE_TOTAL_CASE_N);
    const parts: Array<string | number> = [40, LARGE_TOTAL_CASE_N, s];
    for (let i = 0; i < SMALL_CASES; i++) parts.push(2, "AA");
    return {
        id: STRESS_ID,
        description: "A maximum repeated signal makes pair-by-pair frequency recounting quadratic.",
        input: lines(parts),
        output: repeatLines("AA", 40),
        timeLimitSeconds: 3,
    };
}

function build122(): StressCase {
    const t = 100_000;
    return {
        id: STRESS_ID,
        description: "Maximum directional adjustment batch verifies all parity branches.",
        input: lines([t, ...Array.from({ length: t }, () => "1 2")]),
        output: repeatLines(1, t),
        timeLimitSeconds: 2,
    };
}

function build123(): StressCase {
    const parts: Array<string | number> = [40, LARGE_TOTAL_CASE_N, repeatValue(1, LARGE_TOTAL_CASE_N)];
    for (let i = 0; i < SMALL_CASES; i++) parts.push(1, 1);
    return {
        id: STRESS_ID,
        description: "A maximum all-rest circular schedule forces start-by-start brute scans to wrap for every slot.",
        input: lines(parts),
        output: [String(LARGE_TOTAL_CASE_N), ...Array.from({ length: SMALL_CASES }, () => "1")].join("\n"),
        timeLimitSeconds: 3,
    };
}

function build124(): StressCase {
    const line = "BG".repeat(Math.floor(LARGE_TOTAL_CASE_N / 2)) + (LARGE_TOTAL_CASE_N % 2 ? "B" : "");
    const parts: Array<string | number> = [40, `${LARGE_TOTAL_CASE_N} 1`, line];
    for (let i = 0; i < SMALL_CASES; i++) parts.push("1 1", "B");
    return {
        id: STRESS_ID,
        description: "Maximum one-second queue verifies simultaneous swap semantics inside total work limits.",
        input: lines(parts),
        output: [simulateQueue(line, 1), ...Array.from({ length: SMALL_CASES }, () => "B")].join("\n"),
        timeLimitSeconds: 3,
    };
}

const builders: Record<string, () => StressCase> = {
    "101": build101,
    "102": build102,
    "103": build103,
    "104": build104,
    "105": build105,
    "106": build106,
    "107": build107,
    "108": build108,
    "109": build109,
    "110": build110,
    "111": build111,
    "112": build112,
    "113": build113,
    "114": build114,
    "115": build115,
    "116": build116,
    "117": build117,
    "118": build118,
    "119": build119,
    "120": build120,
    "121": build121,
    "122": build122,
    "123": build123,
    "124": build124,
};

function patchKnownSolutionCode(question: any): void {
    const frontendId = String(question.frontendId || question.problemId);
    const patches = BRUTE_CODE_PATCHES[frontendId];
    const meta = BRUTE_META_PATCHES[frontendId];

    if (patches) {
        for (const [language, code] of Object.entries(patches) as Array<[Language, string]>) {
            const codeMap = question.solution?.bruteForce?.code;
            if (codeMap && typeof codeMap.set === "function") {
                codeMap.set(language, code);
            } else {
                question.set(`solution.bruteForce.code.${language}`, code);
            }
        }
    }
    if (meta && question.solution?.bruteForce) {
        question.solution.bruteForce.explanation = meta.explanation;
        question.solution.bruteForce.timeComplexity = meta.timeComplexity;
        question.solution.bruteForce.spaceComplexity = meta.spaceComplexity;
    }
    if (patches || meta) question.markModified("solution");
}

async function main(): Promise<void> {
    if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not configured.");

    await mongoose.connect(process.env.MONGODB_URI);

    for (const [frontendId, build] of Object.entries(builders)) {
        const question = await DSAQuestion.findOne({ $or: [{ frontendId }, { problemId: frontendId }] });
        if (!question) {
            console.warn(`[stress101-124] ${frontendId}: question not found`);
            continue;
        }

        const stress = build();
        const previousHidden = question.hiddenTestCases || [];
        question.hiddenTestCases = previousHidden.filter((testCase: any) => testCase.id !== STRESS_ID) as any;
        question.hiddenTestCases.unshift({
            id: stress.id,
            description: stress.description,
            input: stress.input,
            output: stress.output,
        } as any);
        question.constraints = withRuntimeConstraints(question.constraints as any, stress.timeLimitSeconds) as any;
        patchKnownSolutionCode(question);

        await question.save();

        console.log(
            `[stress101-124] ${frontendId} ${question.title}: hidden ${previousHidden.length} -> ${question.hiddenTestCases.length}, ` +
            `time=${stress.timeLimitSeconds}s, inputChars=${stress.input.length}, outputChars=${stress.output.length}`
        );
    }

    await mongoose.disconnect();
}

main().catch(async (error) => {
    console.error("[stress101-124] failed:", error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
