/**
 * Adds one generated stress hidden test to DSA questions 1-40.
 *
 * Usage:
 *   npx tsx apps/api/src/scripts/add-dsa-1-40-stress-hidden.ts
 *
 * The script is idempotent. It keeps the generated stress case first,
 * caps each question at 20 total Judge0 tests, adds runtime constraints,
 * and patches genuinely different brute-force snippets where they were
 * missing or effectively identical to the optimized solution.
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

const STRESS_ID = "hidden_stress_1_40_guard";
const GENERATED_STRESS_IDS = new Set([STRESS_ID, "hidden_stress_40_70_guard"]);
const MOD = 1_000_000_007;

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

function rangeValues(n: number, start = 1, step = 1): number[] {
    return Array.from({ length: n }, (_, i) => start + i * step);
}

function withRuntimeConstraints(constraints: string[] | undefined, seconds: number): string[] {
    const kept = (constraints || []).filter(
        (line) => !/^time\s*limit\s*[:=]/i.test(line) && !/^memory\s*limit\s*[:=]/i.test(line)
    );
    return [...kept, `Time Limit: ${Math.min(5, Math.max(1, seconds))}s`, "Memory Limit: 256MB"];
}

function kthRemoved(n: number, k: number): number {
    if (n === 1) return 1;
    const removed = Math.floor(n / 2);
    if (k <= removed) return 2 * k;
    const ans = kthRemoved(Math.floor((n + 1) / 2), k - removed);
    if (n % 2 === 0) return 2 * ans - 1;
    return ans === 1 ? n : 2 * ans - 3;
}

function countSignalPlans(n: number): number {
    let red = 1;
    let blue = 1;
    let green = 1;
    let yellow = 1;
    let violet = 1;
    for (let len = 2; len <= n; len++) {
        const nextRed = (blue + green + violet) % MOD;
        const nextBlue = (red + green) % MOD;
        const nextGreen = (blue + yellow) % MOD;
        const nextYellow = green % MOD;
        const nextViolet = (green + yellow) % MOD;
        red = nextRed;
        blue = nextBlue;
        green = nextGreen;
        yellow = nextYellow;
        violet = nextViolet;
    }
    return (red + blue + green + yellow + violet) % MOD;
}

function countBadgePlans(n: number): number {
    if (n <= 1) return 1;
    let prev2 = 1;
    let prev1 = 2;
    for (let people = 3; people <= n; people++) {
        const current = (prev1 + ((people - 1) * prev2) % MOD) % MOD;
        prev2 = prev1;
        prev1 = current;
    }
    return prev1;
}

function countReturnPlans(moves: number, cells: number): number {
    const width = Math.min(cells, moves + 1);
    let dp = Array(width).fill(0);
    dp[0] = 1;
    for (let step = 0; step < moves; step++) {
        const next = Array(width).fill(0);
        for (let pos = 0; pos < width; pos++) {
            next[pos] = (next[pos] + dp[pos]) % MOD;
            if (pos > 0) next[pos - 1] = (next[pos - 1] + dp[pos]) % MOD;
            if (pos + 1 < width) next[pos + 1] = (next[pos + 1] + dp[pos]) % MOD;
        }
        dp = next;
    }
    return dp[0];
}

function countActiveMemoReaders(days: number, wait: number, expire: number): number {
    const born = Array(days + 2).fill(0);
    born[1] = 1;
    let sharing = 0;
    for (let day = 2; day <= days; day++) {
        if (day - wait >= 1) sharing = (sharing + born[day - wait]) % MOD;
        if (day - expire >= 1) sharing = (sharing - born[day - expire] + MOD) % MOD;
        born[day] = sharing;
    }
    let answer = 0;
    for (let day = Math.max(1, days - expire + 1); day <= days; day++) {
        answer = (answer + born[day]) % MOD;
    }
    return answer;
}

function countStageTilings(n: number): number {
    if (n <= 2) return n;
    let threeBack = 1;
    let twoBack = 1;
    let oneBack = 2;
    for (let width = 3; width <= n; width++) {
        const current = (2 * oneBack + threeBack) % MOD;
        threeBack = twoBack;
        twoBack = oneBack;
        oneBack = current;
    }
    return oneBack;
}

function maximumAchievableScore(currentScore: number): number {
    const digits = String(currentScore).split("");
    const last = Array(10).fill(-1);
    for (let i = 0; i < digits.length; i++) last[Number(digits[i])] = i;
    for (let i = 0; i < digits.length; i++) {
        for (let d = 9; d > Number(digits[i]); d--) {
            if (last[d] > i) {
                const j = last[d];
                [digits[i], digits[j]] = [digits[j]!, digits[i]!];
                return Number(digits.join(""));
            }
        }
    }
    return currentScore;
}

function base26Word(index: number, suffixLength: number): string {
    let x = index;
    const chars = Array(suffixLength).fill("a");
    for (let i = suffixLength - 1; i >= 0; i--) {
        chars[i] = String.fromCharCode(97 + (x % 26));
        x = Math.floor(x / 26);
    }
    return chars.join("");
}

function shiftedWithoutMiddle(n: number): string {
    const middle = Math.floor(n / 2) + 1;
    const out: number[] = [];
    for (let value = 1; value <= n; value++) {
        if (value !== middle) out.push(value);
    }
    return spaced(out);
}

function simulateQueuePrefix(words: number, queries: number): string {
    return repeatValue(words, queries);
}

const BRUTE_CODE_PATCHES: Record<string, Partial<Record<Language, string>>> = {
    "8": {
        cpp: `#include <bits/stdc++.h>
using namespace std;

long long maximizeMinimumSatisfaction(int n, int m, vector<vector<long long>>& ratings) {
    int k = n - 2;
    long long answer = 0;
    vector<int> picked;
    vector<int> used(m, 0);

    function<void()> dfs = [&]() {
        if ((int)picked.size() == k) {
            long long currentMin = LLONG_MAX;
            for (int i = 0; i < n; ++i) {
                long long best = 0;
                for (int product : picked) best = max(best, ratings[i][product]);
                currentMin = min(currentMin, best);
            }
            answer = max(answer, currentMin);
            return;
        }
        for (int product = 0; product < m; ++product) {
            if (used[product]) continue;
            used[product] = 1;
            picked.push_back(product);
            dfs();
            picked.pop_back();
            used[product] = 0;
        }
    };

    dfs();
    return answer;
}`,
        python3: `def maximizeMinimumSatisfaction(n, m, ratings):
    k = n - 2
    answer = 0
    picked = []
    used = [False] * m

    def dfs():
        nonlocal answer
        if len(picked) == k:
            current_min = float("inf")
            for i in range(n):
                best = 0
                for product in picked:
                    best = max(best, ratings[i][product])
                current_min = min(current_min, best)
            answer = max(answer, current_min)
            return
        for product in range(m):
            if used[product]:
                continue
            used[product] = True
            picked.append(product)
            dfs()
            picked.pop()
            used[product] = False

    dfs()
    return answer`,
        java: `class Solution {
    private static int n, m, k;
    private static long[][] ratings;
    private static boolean[] used;
    private static ArrayList<Integer> picked;
    private static long answer;

    public static long maximizeMinimumSatisfaction(int nArg, int mArg, long[][] ratingsArg) {
        n = nArg;
        m = mArg;
        k = n - 2;
        ratings = ratingsArg;
        used = new boolean[m];
        picked = new ArrayList<>();
        answer = 0;
        dfs();
        return answer;
    }

    private static void dfs() {
        if (picked.size() == k) {
            long currentMin = Long.MAX_VALUE;
            for (int i = 0; i < n; i++) {
                long best = 0;
                for (int product : picked) best = Math.max(best, ratings[i][product]);
                currentMin = Math.min(currentMin, best);
            }
            answer = Math.max(answer, currentMin);
            return;
        }
        for (int product = 0; product < m; product++) {
            if (used[product]) continue;
            used[product] = true;
            picked.add(product);
            dfs();
            picked.remove(picked.size() - 1);
            used[product] = false;
        }
    }
}`,
        javascript: `function maximizeMinimumSatisfaction(n, m, ratings) {
    const k = n - 2;
    let answer = 0;
    const picked = [];
    const used = Array(m).fill(false);

    function dfs() {
        if (picked.length === k) {
            let currentMin = Number.MAX_SAFE_INTEGER;
            for (let i = 0; i < n; i++) {
                let best = 0;
                for (const product of picked) best = Math.max(best, ratings[i][product]);
                currentMin = Math.min(currentMin, best);
            }
            answer = Math.max(answer, currentMin);
            return;
        }
        for (let product = 0; product < m; product++) {
            if (used[product]) continue;
            used[product] = true;
            picked.push(product);
            dfs();
            picked.pop();
            used[product] = false;
        }
    }

    dfs();
    return answer;
}`,
    },
    "9": {
        cpp: `class Solution {
public:
    int countSignalPlans(int n) {
        const long long MOD = 1000000007LL;
        vector<vector<int>> next = {{1}, {0, 2}, {0, 1, 3, 4}, {2, 4}, {0}};
        function<long long(int, int)> dfs = [&](int length, int state) {
            if (length == n) return 1LL;
            long long ways = 0;
            for (int nxt : next[state]) ways = (ways + dfs(length + 1, nxt)) % MOD;
            return ways;
        };
        long long answer = 0;
        for (int state = 0; state < 5; ++state) answer = (answer + dfs(1, state)) % MOD;
        return (int)answer;
    }
};`,
        python3: `class Solution:
    def countSignalPlans(self, n: int) -> int:
        mod = 10**9 + 7
        transitions = [[1], [0, 2], [0, 1, 3, 4], [2, 4], [0]]
        def dfs(length, state):
            if length == n:
                return 1
            total = 0
            for nxt in transitions[state]:
                total = (total + dfs(length + 1, nxt)) % mod
            return total
        return sum(dfs(1, state) for state in range(5)) % mod`,
        java: `class Solution {
    private int n;
    private static final long MOD = 1_000_000_007L;
    private final int[][] transitions = {{1}, {0, 2}, {0, 1, 3, 4}, {2, 4}, {0}};

    public int countSignalPlans(int n) {
        this.n = n;
        long answer = 0;
        for (int state = 0; state < 5; state++) answer = (answer + dfs(1, state)) % MOD;
        return (int) answer;
    }

    private long dfs(int length, int state) {
        if (length == n) return 1;
        long ways = 0;
        for (int next : transitions[state]) ways = (ways + dfs(length + 1, next)) % MOD;
        return ways;
    }
}`,
        javascript: `class Solution {
    countSignalPlans(n) {
        const MOD = 1000000007;
        const transitions = [[1], [0, 2], [0, 1, 3, 4], [2, 4], [0]];
        const dfs = (length, state) => {
            if (length === n) return 1;
            let ways = 0;
            for (const next of transitions[state]) ways = (ways + dfs(length + 1, next)) % MOD;
            return ways;
        };
        let answer = 0;
        for (let state = 0; state < 5; state++) answer = (answer + dfs(1, state)) % MOD;
        return answer;
    }
}`,
    },
    "10": {
        cpp: `class Solution {
public:
    int maxTwinHarvest(vector<vector<int>>& field) {
        int rows = field.size(), cols = field[0].size();
        function<int(int, int, int)> dfs = [&](int row, int c1, int c2) {
            int gain = field[row][c1] + (c1 == c2 ? 0 : field[row][c2]);
            if (row == rows - 1) return gain;
            int best = 0;
            for (int d1 = -1; d1 <= 1; ++d1) {
                for (int d2 = -1; d2 <= 1; ++d2) {
                    int n1 = c1 + d1, n2 = c2 + d2;
                    if (n1 < 0 || n1 >= cols || n2 < 0 || n2 >= cols) continue;
                    best = max(best, dfs(row + 1, n1, n2));
                }
            }
            return gain + best;
        };
        return dfs(0, 0, cols - 1);
    }
};`,
        python3: `class Solution:
    def maxTwinHarvest(self, field):
        rows, cols = len(field), len(field[0])
        def dfs(row, c1, c2):
            gain = field[row][c1] + (0 if c1 == c2 else field[row][c2])
            if row == rows - 1:
                return gain
            best = 0
            for d1 in (-1, 0, 1):
                for d2 in (-1, 0, 1):
                    n1, n2 = c1 + d1, c2 + d2
                    if 0 <= n1 < cols and 0 <= n2 < cols:
                        best = max(best, dfs(row + 1, n1, n2))
            return gain + best
        return dfs(0, 0, cols - 1)`,
        java: `class Solution {
    private int[][] field;
    private int rows;
    private int cols;

    public int maxTwinHarvest(int[][] field) {
        this.field = field;
        rows = field.length;
        cols = field[0].length;
        return dfs(0, 0, cols - 1);
    }

    private int dfs(int row, int c1, int c2) {
        int gain = field[row][c1] + (c1 == c2 ? 0 : field[row][c2]);
        if (row == rows - 1) return gain;
        int best = 0;
        for (int d1 = -1; d1 <= 1; d1++) {
            for (int d2 = -1; d2 <= 1; d2++) {
                int n1 = c1 + d1, n2 = c2 + d2;
                if (n1 < 0 || n1 >= cols || n2 < 0 || n2 >= cols) continue;
                best = Math.max(best, dfs(row + 1, n1, n2));
            }
        }
        return gain + best;
    }
}`,
        javascript: `class Solution {
    maxTwinHarvest(field) {
        const rows = field.length;
        const cols = field[0].length;
        const dfs = (row, c1, c2) => {
            const gain = field[row][c1] + (c1 === c2 ? 0 : field[row][c2]);
            if (row === rows - 1) return gain;
            let best = 0;
            for (let d1 = -1; d1 <= 1; d1++) {
                for (let d2 = -1; d2 <= 1; d2++) {
                    const n1 = c1 + d1, n2 = c2 + d2;
                    if (n1 < 0 || n1 >= cols || n2 < 0 || n2 >= cols) continue;
                    best = Math.max(best, dfs(row + 1, n1, n2));
                }
            }
            return gain + best;
        };
        return dfs(0, 0, cols - 1);
    }
}`,
    },
    "12": {
        cpp: `class Solution {
public:
    int countBadgePlans(int n) {
        const long long MOD = 1000000007LL;
        function<long long(int)> dfs = [&](int people) {
            if (people <= 1) return 1LL;
            long long alone = dfs(people - 1);
            long long paired = (people - 1LL) * dfs(people - 2);
            return (alone + paired) % MOD;
        };
        return (int)dfs(n);
    }
};`,
        python3: `class Solution:
    def countBadgePlans(self, n: int) -> int:
        mod = 10**9 + 7
        def dfs(people):
            if people <= 1:
                return 1
            return (dfs(people - 1) + (people - 1) * dfs(people - 2)) % mod
        return dfs(n)`,
        java: `class Solution {
    private static final long MOD = 1_000_000_007L;

    public int countBadgePlans(int n) {
        return (int) dfs(n);
    }

    private long dfs(int people) {
        if (people <= 1) return 1;
        return (dfs(people - 1) + (people - 1L) * dfs(people - 2)) % MOD;
    }
}`,
        javascript: `class Solution {
    countBadgePlans(n) {
        const MOD = 1000000007n;
        const dfs = (people) => {
            if (people <= 1) return 1n;
            return (dfs(people - 1) + BigInt(people - 1) * dfs(people - 2)) % MOD;
        };
        return Number(dfs(n));
    }
}`,
    },
    "3": {
        cpp: `class Solution {
public:
    long long kthRemoved(long long n, long long k) {
        vector<long long> children;
        for (long long i = 1; i <= n; ++i) children.push_back(i);
        long long index = 0;
        for (long long removed = 1; !children.empty(); ++removed) {
            index = (index + 1) % children.size();
            long long child = children[index];
            children.erase(children.begin() + index);
            if (removed == k) return child;
            if (!children.empty()) index %= children.size();
        }
        return -1;
    }
};`,
        python3: `class Solution:
    def kthRemoved(self, n, k):
        children = list(range(1, n + 1))
        index = 0
        removed = 0
        while children:
            index = (index + 1) % len(children)
            child = children.pop(index)
            removed += 1
            if removed == k:
                return child
            if children:
                index %= len(children)
        return -1`,
        java: `class Solution {
    public long kthRemoved(long n, long k) {
        ArrayList<Long> children = new ArrayList<>();
        for (long i = 1; i <= n; i++) children.add(i);
        int index = 0;
        for (long removed = 1; !children.isEmpty(); removed++) {
            index = (index + 1) % children.size();
            long child = children.remove(index);
            if (removed == k) return child;
            if (!children.isEmpty()) index %= children.size();
        }
        return -1;
    }
}`,
        javascript: `class Solution {
    kthRemoved(n, k) {
        const children = [];
        for (let i = 1; i <= n; i++) children.push(i);
        let index = 0;
        for (let removed = 1; children.length > 0; removed++) {
            index = (index + 1) % children.length;
            const child = children[index];
            children.splice(index, 1);
            if (removed === k) return child;
            if (children.length > 0) index %= children.length;
        }
        return -1;
    }
}`,
    },
    "4": {
        cpp: `class Solution {
public:
    long long minimumMoves(int a, int b, int c, int d) {
        if (b > d) return -1;
        long long answer = -1;
        for (long long diagonal = 0; diagonal <= (long long)d - b; ++diagonal) {
            if ((long long)b + diagonal == d) {
                long long x = (long long)a + diagonal;
                if (x >= c) answer = diagonal + (x - c);
            }
        }
        return answer;
    }
};`,
        python3: `class Solution:
    def minimum_moves(self, a, b, c, d):
        if b > d:
            return -1
        answer = -1
        for diagonal in range(d - b + 1):
            if b + diagonal == d:
                x = a + diagonal
                if x >= c:
                    answer = diagonal + (x - c)
        return answer`,
        java: `class Solution {
    public long minimumMoves(int a, int b, int c, int d) {
        if (b > d) return -1;
        long answer = -1;
        for (long diagonal = 0; diagonal <= (long)d - b; diagonal++) {
            if ((long)b + diagonal == d) {
                long x = (long)a + diagonal;
                if (x >= c) answer = diagonal + (x - c);
            }
        }
        return answer;
    }
}`,
        javascript: `class Solution {
    minimumMoves(a, b, c, d) {
        if (b > d) return -1;
        let answer = -1;
        for (let diagonal = 0; diagonal <= d - b; diagonal++) {
            if (b + diagonal === d) {
                const x = a + diagonal;
                if (x >= c) answer = diagonal + (x - c);
            }
        }
        return answer;
    }
}`,
    },
    "14": {
        cpp: `class Solution {
public:
    int minTrackSwaps(vector<int>& upper, vector<int>& lower) {
        const int INF = 1000000000;
        int n = upper.size();
        function<int(int, int)> dfs = [&](int index, int prevSwapped) {
            if (index == n) return 0;
            int prevUpper = prevSwapped ? lower[index - 1] : upper[index - 1];
            int prevLower = prevSwapped ? upper[index - 1] : lower[index - 1];
            int best = INF;
            if (prevUpper < upper[index] && prevLower < lower[index]) {
                best = min(best, dfs(index + 1, 0));
            }
            if (prevUpper < lower[index] && prevLower < upper[index]) {
                best = min(best, 1 + dfs(index + 1, 1));
            }
            return best;
        };
        return min(dfs(1, 0), 1 + dfs(1, 1));
    }
};`,
        python3: `class Solution:
    def minTrackSwaps(self, upper, lower):
        inf = 10**9
        n = len(upper)
        def dfs(index, prev_swapped):
            if index == n:
                return 0
            prev_upper = lower[index - 1] if prev_swapped else upper[index - 1]
            prev_lower = upper[index - 1] if prev_swapped else lower[index - 1]
            best = inf
            if prev_upper < upper[index] and prev_lower < lower[index]:
                best = min(best, dfs(index + 1, False))
            if prev_upper < lower[index] and prev_lower < upper[index]:
                best = min(best, 1 + dfs(index + 1, True))
            return best
        return min(dfs(1, False), 1 + dfs(1, True))`,
        java: `class Solution {
    private int[] upper;
    private int[] lower;
    private static final int INF = 1_000_000_000;

    public int minTrackSwaps(int[] upper, int[] lower) {
        this.upper = upper;
        this.lower = lower;
        return Math.min(dfs(1, false), 1 + dfs(1, true));
    }

    private int dfs(int index, boolean prevSwapped) {
        if (index == upper.length) return 0;
        int prevUpper = prevSwapped ? lower[index - 1] : upper[index - 1];
        int prevLower = prevSwapped ? upper[index - 1] : lower[index - 1];
        int best = INF;
        if (prevUpper < upper[index] && prevLower < lower[index]) {
            best = Math.min(best, dfs(index + 1, false));
        }
        if (prevUpper < lower[index] && prevLower < upper[index]) {
            best = Math.min(best, 1 + dfs(index + 1, true));
        }
        return best;
    }
}`,
        javascript: `class Solution {
    minTrackSwaps(upper, lower) {
        const INF = 1e9;
        const dfs = (index, prevSwapped) => {
            if (index === upper.length) return 0;
            const prevUpper = prevSwapped ? lower[index - 1] : upper[index - 1];
            const prevLower = prevSwapped ? upper[index - 1] : lower[index - 1];
            let best = INF;
            if (prevUpper < upper[index] && prevLower < lower[index]) {
                best = Math.min(best, dfs(index + 1, false));
            }
            if (prevUpper < lower[index] && prevLower < upper[index]) {
                best = Math.min(best, 1 + dfs(index + 1, true));
            }
            return best;
        };
        return Math.min(dfs(1, false), 1 + dfs(1, true));
    }
}`,
    },
    "13": {
        cpp: `class Solution {
public:
    int minimumMenuGap(vector<vector<int>>& menus, int budget) {
        int best = INT_MAX;
        function<void(int, int)> dfs = [&](int row, int sum) {
            if (row == (int)menus.size()) {
                best = min(best, abs(sum - budget));
                return;
            }
            for (int price : menus[row]) dfs(row + 1, sum + price);
        };
        dfs(0, 0);
        return best;
    }
};`,
        python3: `class Solution:
    def minimumMenuGap(self, menus, budget):
        best = 10**18
        def dfs(row, total):
            nonlocal best
            if row == len(menus):
                best = min(best, abs(total - budget))
                return
            for price in menus[row]:
                dfs(row + 1, total + price)
        dfs(0, 0)
        return best`,
        java: `class Solution {
    private int best;
    private int budget;
    private int[][] menus;

    public int minimumMenuGap(int[][] menus, int budget) {
        this.menus = menus;
        this.budget = budget;
        this.best = Integer.MAX_VALUE;
        dfs(0, 0);
        return best;
    }

    private void dfs(int row, int sum) {
        if (row == menus.length) {
            best = Math.min(best, Math.abs(sum - budget));
            return;
        }
        for (int price : menus[row]) dfs(row + 1, sum + price);
    }
}`,
        javascript: `class Solution {
    minimumMenuGap(menus, budget) {
        let best = Number.MAX_SAFE_INTEGER;
        const dfs = (row, total) => {
            if (row === menus.length) {
                best = Math.min(best, Math.abs(total - budget));
                return;
            }
            for (const price of menus[row]) dfs(row + 1, total + price);
        };
        dfs(0, 0);
        return best;
    }
}`,
    },
    "15": {
        cpp: `class Solution {
public:
    int countReturnPlans(int moves, int cells) {
        const int MOD = 1000000007;
        function<int(int,int)> dfs = [&](int step, int pos) {
            if (pos < 0 || pos >= cells) return 0;
            if (step == moves) return pos == 0 ? 1 : 0;
            long long ways = dfs(step + 1, pos);
            ways += dfs(step + 1, pos - 1);
            ways += dfs(step + 1, pos + 1);
            return (int)(ways % MOD);
        };
        return dfs(0, 0);
    }
};`,
    },
    "21": {
        cpp: `class Solution {
public:
    bool canAcquireAll(long long capital, vector<int>& startups) {
        vector<int> used(startups.size(), 0);
        function<bool(long long, int)> search = [&](long long current, int taken) {
            if (taken == (int)startups.size()) return true;
            bool possible = false;
            for (int i = 0; i < (int)startups.size(); ++i) {
                if (!used[i] && current >= startups[i]) {
                    used[i] = 1;
                    if (search(current + startups[i], taken + 1)) possible = true;
                    used[i] = 0;
                }
            }
            return possible;
        };
        return search(capital, 0);
    }
};`,
        python3: `def canAcquireAll(capital, startups):
    used = [False] * len(startups)
    def search(current, taken):
        if taken == len(startups):
            return True
        possible = False
        for i, value in enumerate(startups):
            if not used[i] and current >= value:
                used[i] = True
                if search(current + value, taken + 1):
                    possible = True
                used[i] = False
        return possible
    return search(capital, 0)`,
        java: `class Solution {
    private int[] startups;
    private boolean[] used;

    public boolean canAcquireAll(long capital, int[] startups) {
        this.startups = startups;
        this.used = new boolean[startups.length];
        return search(capital, 0);
    }

    private boolean search(long capital, int taken) {
        if (taken == startups.length) return true;
        boolean possible = false;
        for (int i = 0; i < startups.length; i++) {
            if (!used[i] && capital >= startups[i]) {
                used[i] = true;
                if (search(capital + startups[i], taken + 1)) possible = true;
                used[i] = false;
            }
        }
        return possible;
    }
}`,
        javascript: `class Solution {
    canAcquireAll(capital, startups) {
        const used = Array(startups.length).fill(false);
        const search = (current, taken) => {
            if (taken === startups.length) return true;
            let possible = false;
            for (let i = 0; i < startups.length; i++) {
                if (!used[i] && current >= startups[i]) {
                    used[i] = true;
                    if (search(current + startups[i], taken + 1)) possible = true;
                    used[i] = false;
                }
            }
            return possible;
        };
        return search(capital, 0);
    }
}`,
    },
    "19": {
        cpp: `class Solution {
public:
    int countStageTilings(int n) {
        const long long MOD = 1000000007LL;
        function<long long(int)> full = [&](int width) -> long long {
            if (width == 0) return 1LL;
            if (width <= 2) return (long long)width;
            return (2 * full(width - 1) + full(width - 3)) % MOD;
        };
        return (int)full(n);
    }
};`,
        python3: `class Solution:
    def countStageTilings(self, n: int) -> int:
        mod = 10**9 + 7
        def full(width):
            if width == 0:
                return 1
            if width <= 2:
                return width
            return (2 * full(width - 1) + full(width - 3)) % mod
        return full(n)`,
        java: `class Solution {
    private static final long MOD = 1_000_000_007L;

    public int countStageTilings(int n) {
        return (int) full(n);
    }

    private long full(int width) {
        if (width == 0) return 1;
        if (width <= 2) return width;
        return (2 * full(width - 1) + full(width - 3)) % MOD;
    }
}`,
        javascript: `class Solution {
    countStageTilings(n) {
        const MOD = 1000000007n;
        const full = (width) => {
            if (width === 0) return 1n;
            if (width <= 2) return BigInt(width);
            return (2n * full(width - 1) + full(width - 3)) % MOD;
        };
        return Number(full(n));
    }
}`,
    },
    "23": {
        cpp: `class Solution {
public:
    vector<int> shortestSignalHops(int n, vector<vector<int>>& copperLinks, vector<vector<int>>& fiberLinks) {
        vector<vector<pair<int, int>>> graph(n);
        for (auto& edge : copperLinks) graph[edge[0]].push_back({edge[1], 0});
        for (auto& edge : fiberLinks) graph[edge[0]].push_back({edge[1], 1});
        vector<int> best(n, INT_MAX);
        function<void(int, int, int)> dfs = [&](int node, int lastColor, int depth) {
            if (depth > 2 * n) return;
            best[node] = min(best[node], depth);
            for (auto [next, color] : graph[node]) {
                if (color != lastColor) dfs(next, color, depth + 1);
            }
        };
        dfs(0, -1, 0);
        vector<int> answer(n, -1);
        for (int i = 0; i < n; ++i) if (best[i] != INT_MAX) answer[i] = best[i];
        return answer;
    }
};`,
        python3: `class Solution:
    def shortestSignalHops(self, n, copperLinks, fiberLinks):
        graph = [[] for _ in range(n)]
        for u, v in copperLinks:
            graph[u].append((v, 0))
        for u, v in fiberLinks:
            graph[u].append((v, 1))
        best = [10**18] * n
        def dfs(node, last_color, depth):
            if depth > 2 * n:
                return
            best[node] = min(best[node], depth)
            for nxt, color in graph[node]:
                if color != last_color:
                    dfs(nxt, color, depth + 1)
        dfs(0, -1, 0)
        return [-1 if value == 10**18 else value for value in best]`,
        java: `class Solution {
    private List<int[]>[] graph;
    private int[] best;
    private int limit;

    public int[] shortestSignalHops(int n, int[][] copperLinks, int[][] fiberLinks) {
        graph = new ArrayList[n];
        for (int i = 0; i < n; i++) graph[i] = new ArrayList<>();
        for (int[] edge : copperLinks) graph[edge[0]].add(new int[]{edge[1], 0});
        for (int[] edge : fiberLinks) graph[edge[0]].add(new int[]{edge[1], 1});
        best = new int[n];
        Arrays.fill(best, Integer.MAX_VALUE);
        limit = 2 * n;
        dfs(0, -1, 0);
        int[] answer = new int[n];
        for (int i = 0; i < n; i++) answer[i] = best[i] == Integer.MAX_VALUE ? -1 : best[i];
        return answer;
    }

    private void dfs(int node, int lastColor, int depth) {
        if (depth > limit) return;
        best[node] = Math.min(best[node], depth);
        for (int[] edge : graph[node]) {
            if (edge[1] != lastColor) dfs(edge[0], edge[1], depth + 1);
        }
    }
}`,
        javascript: `class Solution {
    shortestSignalHops(n, copperLinks, fiberLinks) {
        const graph = Array.from({ length: n }, () => []);
        for (const [u, v] of copperLinks) graph[u].push([v, 0]);
        for (const [u, v] of fiberLinks) graph[u].push([v, 1]);
        const best = Array(n).fill(Infinity);
        const dfs = (node, lastColor, depth) => {
            if (depth > 2 * n) return;
            best[node] = Math.min(best[node], depth);
            for (const [next, color] of graph[node]) {
                if (color !== lastColor) dfs(next, color, depth + 1);
            }
        };
        dfs(0, -1, 0);
        return best.map((value) => value === Infinity ? -1 : value);
    }
}`,
    },
    "26": {
        cpp: `class Solution {
public:
    int findSoloReading(vector<int>& readings) {
        for (int i = 0; i < (int)readings.size(); ++i) {
            int count = 0;
            for (int value : readings) if (value == readings[i]) count++;
            if (count == 1) return readings[i];
        }
        return -1;
    }
};`,
        python3: `class Solution:
    def findSoloReading(self, readings):
        for value in readings:
            count = 0
            for other in readings:
                if other == value:
                    count += 1
            if count == 1:
                return value
        return -1`,
        java: `class Solution {
    public int findSoloReading(int[] readings) {
        for (int value : readings) {
            int count = 0;
            for (int other : readings) if (other == value) count++;
            if (count == 1) return value;
        }
        return -1;
    }
}`,
        javascript: `class Solution {
    findSoloReading(readings) {
        for (const value of readings) {
            let count = 0;
            for (const other of readings) if (other === value) count++;
            if (count === 1) return value;
        }
        return -1;
    }
}`,
    },
    "34": {
        cpp: `class Solution {
public:
    int minimumRoadReversals(int n, vector<vector<int>>& roads) {
        vector<vector<int>> graph(n);
        for (auto& road : roads) {
            graph[road[0]].push_back(road[1]);
            graph[road[1]].push_back(road[0]);
        }
        int answer = 0;
        function<void(int, int)> dfs = [&](int node, int parent) {
            for (int next : graph[node]) {
                if (next == parent) continue;
                bool pointsAway = false;
                for (auto& road : roads) {
                    if (road[0] == node && road[1] == next) pointsAway = true;
                }
                if (pointsAway) answer++;
                dfs(next, node);
            }
        };
        dfs(0, -1);
        return answer;
    }
};`,
        python3: `class Solution:
    def minimumRoadReversals(self, n, roads):
        graph = [[] for _ in range(n)]
        for u, v in roads:
            graph[u].append(v)
            graph[v].append(u)
        answer = 0
        def dfs(node, parent):
            nonlocal answer
            for nxt in graph[node]:
                if nxt == parent:
                    continue
                points_away = False
                for u, v in roads:
                    if u == node and v == nxt:
                        points_away = True
                if points_away:
                    answer += 1
                dfs(nxt, node)
        dfs(0, -1)
        return answer`,
        java: `class Solution {
    private int[][] roads;
    private List<Integer>[] graph;
    private int answer;

    public int minimumRoadReversals(int n, int[][] roads) {
        this.roads = roads;
        graph = new ArrayList[n];
        for (int i = 0; i < n; i++) graph[i] = new ArrayList<>();
        for (int[] road : roads) {
            graph[road[0]].add(road[1]);
            graph[road[1]].add(road[0]);
        }
        answer = 0;
        dfs(0, -1);
        return answer;
    }

    private void dfs(int node, int parent) {
        for (int next : graph[node]) {
            if (next == parent) continue;
            boolean pointsAway = false;
            for (int[] road : roads) {
                if (road[0] == node && road[1] == next) pointsAway = true;
            }
            if (pointsAway) answer++;
            dfs(next, node);
        }
    }
}`,
        javascript: `class Solution {
    minimumRoadReversals(n, roads) {
        const graph = Array.from({ length: n }, () => []);
        for (const [u, v] of roads) {
            graph[u].push(v);
            graph[v].push(u);
        }
        let answer = 0;
        const dfs = (node, parent) => {
            for (const next of graph[node]) {
                if (next === parent) continue;
                let pointsAway = false;
                for (const [u, v] of roads) {
                    if (u === node && v === next) pointsAway = true;
                }
                if (pointsAway) answer++;
                dfs(next, node);
            }
        };
        dfs(0, -1);
        return answer;
    }
}`,
    },
    "39": {
        cpp: `class Solution {
public:
    ListNode* removeAuditMiddle(ListNode* head) {
        int n = 0;
        for (ListNode* node = head; node; node = node->next) n++;
        if (n <= 1) return nullptr;
        int skip = n / 2;
        ListNode dummy(0);
        ListNode* tail = &dummy;
        for (int i = 0; i < n; ++i) {
            if (i == skip) continue;
            ListNode* node = head;
            for (int step = 0; step < i; ++step) node = node->next;
            tail->next = new ListNode(node->val);
            tail = tail->next;
        }
        return dummy.next;
    }
};`,
        python3: `class Solution:
    def removeAuditMiddle(self, head):
        n = 0
        node = head
        while node:
            n += 1
            node = node.next
        if n <= 1:
            return None
        skip = n // 2
        dummy = ListNode(0)
        tail = dummy
        for i in range(n):
            if i == skip:
                continue
            node = head
            for _ in range(i):
                node = node.next
            tail.next = ListNode(node.val)
            tail = tail.next
        return dummy.next`,
        java: `class Solution {
    public ListNode removeAuditMiddle(ListNode head) {
        int n = 0;
        for (ListNode node = head; node != null; node = node.next) n++;
        if (n <= 1) return null;
        int skip = n / 2;
        ListNode dummy = new ListNode(0);
        ListNode tail = dummy;
        for (int i = 0; i < n; i++) {
            if (i == skip) continue;
            ListNode node = head;
            for (int step = 0; step < i; step++) node = node.next;
            tail.next = new ListNode(node.val);
            tail = tail.next;
        }
        return dummy.next;
    }
}`,
        javascript: `class Solution {
    removeAuditMiddle(head) {
        let n = 0;
        for (let node = head; node; node = node.next) n++;
        if (n <= 1) return null;
        const skip = Math.floor(n / 2);
        const dummy = new ListNode(0);
        let tail = dummy;
        for (let i = 0; i < n; i++) {
            if (i === skip) continue;
            let node = head;
            for (let step = 0; step < i; step++) node = node.next;
            tail.next = new ListNode(node.val);
            tail = tail.next;
        }
        return dummy.next;
    }
}`,
    },
    "28": {
        cpp: `class Solution {
public:
    int minimumVaultRotations(vector<string>& blockedCodes, string targetCode) {
        unordered_set<string> blocked(blockedCodes.begin(), blockedCodes.end());
        if (blocked.count("0000") || blocked.count(targetCode)) return -1;
        bool sealed = targetCode != "0000";
        for (int i = 0; i < 4; ++i) {
            for (int delta : {-1, 1}) {
                string near = targetCode;
                near[i] = char('0' + (near[i] - '0' + delta + 10) % 10);
                if (!blocked.count(near)) sealed = false;
            }
        }
        if (sealed) return -1;
        unordered_set<string> path;
        function<bool(string, int, int)> dfs = [&](string code, int depth, int limit) {
            if (code == targetCode) return true;
            if (depth == limit) return false;
            for (int i = 0; i < 4; ++i) {
                for (int delta : {-1, 1}) {
                    string next = code;
                    next[i] = char('0' + (next[i] - '0' + delta + 10) % 10);
                    if (blocked.count(next) || path.count(next)) continue;
                    path.insert(next);
                    if (dfs(next, depth + 1, limit)) return true;
                    path.erase(next);
                }
            }
            return false;
        };
        for (int limit = 0; limit <= 20; ++limit) {
            path.clear();
            path.insert("0000");
            if (dfs("0000", 0, limit)) return limit;
        }
        return -1;
    }
};`,
        python3: `class Solution:
    def minimumVaultRotations(self, blockedCodes, targetCode):
        blocked = set(blockedCodes)
        if "0000" in blocked or targetCode in blocked:
            return -1
        def neighbors(code):
            for i, ch in enumerate(code):
                digit = int(ch)
                for delta in (-1, 1):
                    yield code[:i] + str((digit + delta) % 10) + code[i + 1:]
        if targetCode != "0000" and all(nxt in blocked for nxt in neighbors(targetCode)):
            return -1
        def dfs(code, depth, limit, path):
            if code == targetCode:
                return True
            if depth == limit:
                return False
            for nxt in neighbors(code):
                if nxt in blocked or nxt in path:
                    continue
                path.add(nxt)
                if dfs(nxt, depth + 1, limit, path):
                    return True
                path.remove(nxt)
            return False
        for limit in range(21):
            if dfs("0000", 0, limit, {"0000"}):
                return limit
        return -1`,
        java: `class Solution {
    private Set<String> blocked;
    private String target;

    public int minimumVaultRotations(String[] blockedCodes, String targetCode) {
        blocked = new HashSet<>(Arrays.asList(blockedCodes));
        target = targetCode;
        if (blocked.contains("0000") || blocked.contains(targetCode)) return -1;
        boolean sealed = !targetCode.equals("0000");
        for (int i = 0; i < 4; i++) {
            int digit = targetCode.charAt(i) - '0';
            for (int delta : new int[]{-1, 1}) {
                String near = targetCode.substring(0, i) + ((digit + delta + 10) % 10) + targetCode.substring(i + 1);
                if (!blocked.contains(near)) sealed = false;
            }
        }
        if (sealed) return -1;
        for (int limit = 0; limit <= 20; limit++) {
            HashSet<String> path = new HashSet<>();
            path.add("0000");
            if (dfs("0000", 0, limit, path)) return limit;
        }
        return -1;
    }

    private boolean dfs(String code, int depth, int limit, Set<String> path) {
        if (code.equals(target)) return true;
        if (depth == limit) return false;
        for (int i = 0; i < 4; i++) {
            int digit = code.charAt(i) - '0';
            for (int delta : new int[]{-1, 1}) {
                String next = code.substring(0, i) + ((digit + delta + 10) % 10) + code.substring(i + 1);
                if (blocked.contains(next) || path.contains(next)) continue;
                path.add(next);
                if (dfs(next, depth + 1, limit, path)) return true;
                path.remove(next);
            }
        }
        return false;
    }
}`,
        javascript: `class Solution {
    minimumVaultRotations(blockedCodes, targetCode) {
        const blocked = new Set(blockedCodes);
        if (blocked.has("0000") || blocked.has(targetCode)) return -1;
        const neighbors = (code) => {
            const out = [];
            for (let i = 0; i < 4; i++) {
                const digit = Number(code[i]);
                for (const delta of [-1, 1]) {
                    out.push(code.slice(0, i) + ((digit + delta + 10) % 10) + code.slice(i + 1));
                }
            }
            return out;
        };
        if (targetCode !== "0000" && neighbors(targetCode).every((code) => blocked.has(code))) return -1;
        const dfs = (code, depth, limit, path) => {
            if (code === targetCode) return true;
            if (depth === limit) return false;
            for (const next of neighbors(code)) {
                if (blocked.has(next) || path.has(next)) continue;
                path.add(next);
                if (dfs(next, depth + 1, limit, path)) return true;
                path.delete(next);
            }
            return false;
        };
        for (let limit = 0; limit <= 20; limit++) {
            if (dfs("0000", 0, limit, new Set(["0000"]))) return limit;
        }
        return -1;
    }
}`,
    },
};

const BRUTE_META_PATCHES: Record<string, { explanation: string; timeComplexity: string; spaceComplexity: string }> = {
    "8": {
        explanation: "Try ordered drafts of selected products and evaluate the customer minimum for every completed draft.",
        timeComplexity: "O(P(m, n - 2) * n * (n - 2))",
        spaceComplexity: "O(m)",
    },
    "9": {
        explanation: "Enumerate every stable signal sequence recursively by following allowed transitions.",
        timeComplexity: "Exponential",
        spaceComplexity: "O(n)",
    },
    "10": {
        explanation: "Recursively try every pair of drone moves on every row without memoizing repeated column states.",
        timeComplexity: "O(9^rows)",
        spaceComplexity: "O(rows)",
    },
    "12": {
        explanation: "Recursively decide whether the last attendee stands alone or pairs with any other remaining attendee.",
        timeComplexity: "Exponential",
        spaceComplexity: "O(n)",
    },
    "3": {
        explanation: "Simulate the circular elimination order directly and remove one child at a time from a mutable list.",
        timeComplexity: "O(n^2)",
        spaceComplexity: "O(n)",
    },
    "4": {
        explanation: "Try possible diagonal-move counts one by one, then check whether the remaining x-distance can be covered by left moves.",
        timeComplexity: "O(d - b)",
        spaceComplexity: "O(1)",
    },
    "14": {
        explanation: "Recursively try keeping or swapping each timestamp without memoizing repeated states.",
        timeComplexity: "O(2^n)",
        spaceComplexity: "O(n)",
    },
    "19": {
        explanation: "Use the tiling recurrence recursively without memoizing repeated widths.",
        timeComplexity: "Exponential",
        spaceComplexity: "O(n)",
    },
    "21": {
        explanation: "Try every affordable acquisition order with backtracking.",
        timeComplexity: "O(n!)",
        spaceComplexity: "O(n)",
    },
    "23": {
        explanation: "Enumerate alternating walks up to a depth bound and update the best depth seen for each station.",
        timeComplexity: "Exponential in the walk depth",
        spaceComplexity: "O(n + c + f + depth)",
    },
    "26": {
        explanation: "For each reading, scan the whole array to count how many times it appears.",
        timeComplexity: "O(n^2)",
        spaceComplexity: "O(1)",
    },
    "28": {
        explanation: "Use iterative deepening DFS over dial rotations instead of BFS, revisiting many partial routes.",
        timeComplexity: "O(8^d)",
        spaceComplexity: "O(d)",
    },
    "34": {
        explanation: "Traverse the tree, but rescan the original road list for every traversed edge to check its direction.",
        timeComplexity: "O(n^2)",
        spaceComplexity: "O(n)",
    },
    "39": {
        explanation: "For every rebuilt output node, walk again from the head to find that index.",
        timeComplexity: "O(n^2)",
        spaceComplexity: "O(n)",
    },
};

function build1(): StressCase {
    const n = 100_000;
    return {
        id: STRESS_ID,
        description: "Maximum baker count with slow speeds forces time-by-time brute simulation to scan too many minutes.",
        input: lines([`${n} 1000000`, repeatValue(100, n)]),
        output: "10000",
        timeLimitSeconds: 5,
    };
}

function build2(): StressCase {
    const n = 100_000;
    return {
        id: STRESS_ID,
        description: "All equal tides force each quadratic leader check to scan the full suffix.",
        input: lines([n, repeatValue(5, n)]),
        output: repeatValue(5, n),
        timeLimitSeconds: 3,
    };
}

function build3(): StressCase {
    const hardN = 2_000_000;
    const parts: Array<string | number> = [40, `${hardN} ${hardN}`];
    const out = [kthRemoved(hardN, hardN)];
    for (let i = 0; i < 39; i++) {
        parts.push("7 3");
        out.push(6);
    }
    return {
        id: STRESS_ID,
        description: "A huge circle makes mutable-list elimination far too slow while the recursive pattern stays logarithmic.",
        input: lines(parts),
        output: out.join("\n"),
        timeLimitSeconds: 3,
    };
}

function build4(): StressCase {
    const parts: Array<string | number> = [40];
    for (let i = 0; i < 40; i++) parts.push("0 -100000000 0 100000000");
    return {
        id: STRESS_ID,
        description: "Huge vertical distance catches diagonal-count brute loops.",
        input: lines(parts),
        output: repeatLines("400000000", 40),
        timeLimitSeconds: 2,
    };
}

function build5(): StressCase {
    const n = 100_000;
    return {
        id: STRESS_ID,
        description: "All values pair with each other, forcing pairwise target counters through every pair.",
        input: lines([n, repeatValue(1, n), 2]),
        output: String((BigInt(n) * BigInt(n - 1)) / 2n),
        timeLimitSeconds: 3,
    };
}

function build6(): StressCase {
    const n = 100_000;
    return {
        id: STRESS_ID,
        description: "Reverse-sorted coins create the maximum number of inversions.",
        input: lines([n, spaced(rangeValues(n, n, -1))]),
        output: String((BigInt(n) * BigInt(n - 1)) / 2n),
        timeLimitSeconds: 3,
    };
}

function build7(): StressCase {
    const n = 99_999;
    const values = [
        ...Array(33_333).fill(3),
        ...Array(33_333).fill(2),
        ...Array(33_333).fill(1),
    ];
    return {
        id: STRESS_ID,
        description: "Two distant drops make every rotation attempt scan a long prefix before failing.",
        input: lines([n, spaced(values)]),
        output: "false",
        timeLimitSeconds: 3,
    };
}

function build8(): StressCase {
    const n = 8;
    const m = 20;
    const rows = Array.from({ length: n }, () => repeatValue(7, m));
    return {
        id: STRESS_ID,
        description: "Wide product matrix makes ordered-draft brute force revisit the same selected sets many times.",
        input: lines([`${n} ${m}`, ...rows]),
        output: "7",
        timeLimitSeconds: 2,
    };
}

function build9(): StressCase {
    const n = 40;
    return {
        id: STRESS_ID,
        description: "Moderate signal length is enough to make sequence-enumeration brute force explode.",
        input: String(n),
        output: String(countSignalPlans(n)),
        timeLimitSeconds: 2,
    };
}

function build10(): StressCase {
    const rows = 14;
    const cols = 14;
    return {
        id: STRESS_ID,
        description: "A mid-sized full grid makes unmemoized two-drone recursion branch by every move pair.",
        input: lines([`${rows} ${cols}`, ...Array.from({ length: rows }, () => repeatValue(100, cols))]),
        output: String(rows * 200),
        timeLimitSeconds: 3,
    };
}

function build11(): StressCase {
    const n = 36;
    const k = 18;
    const workshops = Array.from({ length: n }, (_, i) => `${i + 1} ${i + 1} 1`);
    return {
        id: STRESS_ID,
        description: "Many non-overlapping workshops make choose/skip recursion explode.",
        input: lines([`${n} ${k}`, ...workshops]),
        output: String(k),
        timeLimitSeconds: 3,
    };
}

function build12(): StressCase {
    const n = 50;
    return {
        id: STRESS_ID,
        description: "Moderate attendee count makes recursive solo/pair branching too large.",
        input: String(n),
        output: String(countBadgePlans(n)),
        timeLimitSeconds: 2,
    };
}

function build13(): StressCase {
    const rows = 18;
    const cols = 3;
    return {
        id: STRESS_ID,
        description: "Many shelves with repeated choices make total-enumeration brute force grow exponentially.",
        input: lines([`${rows} ${cols} ${rows}`, ...Array.from({ length: rows }, () => repeatValue(1, cols))]),
        output: "0",
        timeLimitSeconds: 3,
    };
}

function build14(): StressCase {
    const n = 35;
    const upper = Array.from({ length: n }, (_, i) => 1 + 2 * i);
    const lower = Array.from({ length: n }, (_, i) => 2 + 2 * i);
    return {
        id: STRESS_ID,
        description: "Every timestamp allows both keep and swap, making non-memoized recursion branch exponentially.",
        input: lines([n, spaced(upper), spaced(lower)]),
        output: "0",
        timeLimitSeconds: 3,
    };
}

function build15(): StressCase {
    const moves = 35;
    const cells = 36;
    return {
        id: STRESS_ID,
        description: "Large move count makes direct three-way path recursion explode.",
        input: `${moves} ${cells}`,
        output: String(countReturnPlans(moves, cells)),
        timeLimitSeconds: 3,
    };
}

function build16(): StressCase {
    const days = 100_000;
    const wait = 1;
    const expire = 50_000;
    return {
        id: STRESS_ID,
        description: "Long active-sharing windows make day-by-day fanout brute force too slow.",
        input: `${days} ${wait} ${expire}`,
        output: String(countActiveMemoReaders(days, wait, expire)),
        timeLimitSeconds: 3,
    };
}

function build17(): StressCase {
    const n = 100_000;
    const parcels = Array.from({ length: n }, (_, i) => `${i + 1} ${i + 1}`);
    return {
        id: STRESS_ID,
        description: "A maximum strictly nestable chain catches quadratic parcel DP.",
        input: lines([n, ...parcels]),
        output: String(n),
        timeLimitSeconds: 3,
    };
}

function build18(): StressCase {
    const rows = 20;
    const cols = 20;
    return {
        id: STRESS_ID,
        description: "A neutral maze has an enormous number of right/down routes for path enumeration.",
        input: lines([`${rows} ${cols}`, ...Array.from({ length: rows }, () => repeatValue(0, cols))]),
        output: "1",
        timeLimitSeconds: 3,
    };
}

function build19(): StressCase {
    const n = 60;
    return {
        id: STRESS_ID,
        description: "Moderate stage width makes unmemoized tiling recurrence repeat subproblems exponentially.",
        input: String(n),
        output: String(countStageTilings(n)),
        timeLimitSeconds: 2,
    };
}

function build20(): StressCase {
    const n = 14;
    return {
        id: STRESS_ID,
        description: "A modest token count is already enough to make burst-order recursion factorial.",
        input: lines([n, repeatValue(1, n)]),
        output: String(n),
        timeLimitSeconds: 3,
    };
}

function build21(): StressCase {
    const startups = [...Array(19).fill(1), 1_000_000_000];
    return {
        id: STRESS_ID,
        description: "Many identical affordable startups plus one impossible startup force acquisition-order backtracking to exhaust permutations.",
        input: lines([1, startups.length, spaced(startups)]),
        output: "false",
        timeLimitSeconds: 3,
    };
}

function build22(): StressCase {
    const score = 98_345_670;
    return {
        id: STRESS_ID,
        description: "Nine-digit score verifies best single-swap handling near the score limit.",
        input: String(score),
        output: String(maximumAchievableScore(score)),
        timeLimitSeconds: 1,
    };
}

function build23(): StressCase {
    const n = 30;
    const copper = ["0 1", "0 2", "0 3", "0 4"];
    const fiber = ["1 0", "2 0", "3 0", "4 0"];
    const answer = [0, 1, 1, 1, 1, ...Array.from({ length: n - 5 }, () => -1)];
    return {
        id: STRESS_ID,
        description: "A tiny alternating cycle makes walk-enumeration brute force revisit exponentially many routes.",
        input: lines([n, copper.length, ...copper, fiber.length, ...fiber]),
        output: spaced(answer),
        timeLimitSeconds: 3,
    };
}

function build24(): StressCase {
    const n = 20;
    const picks = 12;
    return {
        id: STRESS_ID,
        description: "Many equally profitable affordable projects make recursive order search explode.",
        input: lines([`${picks} 0`, n, repeatValue(1, n), repeatValue(0, n)]),
        output: String(picks),
        timeLimitSeconds: 3,
    };
}

function build25(): StressCase {
    const n = 50_000;
    const names = Array.from({ length: n }, (_, i) => `a${base26Word(i, 5)}`);
    return {
        id: STRESS_ID,
        description: "One huge initial-letter group makes ordered-pair name swapping quadratic.",
        input: lines([n, ...names]),
        output: "0",
        timeLimitSeconds: 3,
    };
}

function build26(): StressCase {
    const pairs = 99_999;
    const values: number[] = [];
    for (let i = 1; i <= pairs; i++) values.push(i, i);
    values.push(1_000_000_000);
    return {
        id: STRESS_ID,
        description: "Solo value at the end checks full pair-scan behavior and binary-search parity.",
        input: lines([values.length, spaced(values)]),
        output: "1000000000",
        timeLimitSeconds: 2,
    };
}

function build27(): StressCase {
    const n = 100_000;
    return {
        id: STRESS_ID,
        description: "All-unique signals force every brute window to extend to the end.",
        input: lines([n, spaced(rangeValues(n))]),
        output: String((BigInt(n) * BigInt(n + 1)) / 2n),
        timeLimitSeconds: 3,
    };
}

function build28(): StressCase {
    return {
        id: STRESS_ID,
        description: "A far vault target makes iterative-deepening route search expand a huge tree while BFS stays bounded.",
        input: lines([0, "5555"]),
        output: "20",
        timeLimitSeconds: 3,
    };
}

function build29(): StressCase {
    const n = 2_000;
    return {
        id: STRESS_ID,
        description: "Increasing readings contain no decoy, forcing cubic triple checks to exhaust the search.",
        input: lines([n, spaced(rangeValues(n))]),
        output: "false",
        timeLimitSeconds: 3,
    };
}

function build30(): StressCase {
    const n = 3_000;
    return {
        id: STRESS_ID,
        description: "All rods form valid triangles, but cubic brute still examines every triple.",
        input: lines([n, repeatValue(1, n)]),
        output: "3",
        timeLimitSeconds: 3,
    };
}

function build31(): StressCase {
    const n = 100_000;
    return {
        id: STRESS_ID,
        description: "A long repeated message still has quadratically many substrings for appeal brute force.",
        input: "a".repeat(n),
        output: String((BigInt(n) * BigInt(n + 1)) / 2n),
        timeLimitSeconds: 3,
    };
}

function build32(): StressCase {
    const n = 2_000;
    return {
        id: STRESS_ID,
        description: "Every character is a vowel, making cubic substring rescans hit the worst case.",
        input: "a".repeat(n),
        output: String((BigInt(n) * BigInt(n + 1) * BigInt(n + 2)) / 6n),
        timeLimitSeconds: 3,
    };
}

function build33(): StressCase {
    const n = 100_000;
    return {
        id: STRESS_ID,
        description: "One maximum rising run catches start-by-start extension brute force.",
        input: lines([n, spaced(rangeValues(n))]),
        output: String((BigInt(n) * BigInt(n + 1)) / 2n),
        timeLimitSeconds: 3,
    };
}

function build34(): StressCase {
    const n = 100_000;
    const roads = Array.from({ length: n - 1 }, (_, i) => `0 ${i + 1}`);
    return {
        id: STRESS_ID,
        description: "A maximum star of outward roads verifies reversal counting on large trees.",
        input: lines([n, ...roads]),
        output: String(n - 1),
        timeLimitSeconds: 3,
    };
}

function build35(): StressCase {
    const n = 2_000;
    const answer = BigInt(n) * ((BigInt(n) * BigInt(n - 1)) / 2n) * 2n;
    return {
        id: STRESS_ID,
        description: "All-one arrays maximize square-product pair matches and brute pair enumeration.",
        input: lines([`${n} ${n}`, repeatValue(1, n), repeatValue(1, n)]),
        output: String(answer),
        timeLimitSeconds: 3,
    };
}

function build36(): StressCase {
    const updates = 50_000;
    const queries = 50_000;
    const events = [
        ...Array.from({ length: updates }, (_, i) => `1 ${i + 1} 1`),
        ...Array.from({ length: queries }, () => "3 0 0"),
    ];
    return {
        id: STRESS_ID,
        description: "Many max queries after many corrected updates force brute scans over the whole feed.",
        input: lines([events.length, ...events]),
        output: repeatValue(1, queries),
        timeLimitSeconds: 3,
    };
}

function build37(): StressCase {
    const rows = 20;
    const cols = 20;
    const grid = Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => (r === rows - 1 && c === cols - 1 ? ")" : "(")).join("")
    );
    return {
        id: STRESS_ID,
        description: "Odd-length bracket grid lets DP reject immediately, while path DFS explores many routes.",
        input: lines([`${rows} ${cols}`, ...grid]),
        output: "false",
        timeLimitSeconds: 3,
    };
}

function build38(): StressCase {
    const n = 100_000;
    const codes = rangeValues(n, 2, 2);
    return {
        id: STRESS_ID,
        description: "Every code is quiet, so brute neighbor checks scan the whole list for every item.",
        input: lines([n, spaced(codes)]),
        output: spaced(codes),
        timeLimitSeconds: 3,
    };
}

function build39(): StressCase {
    const n = 100_000;
    return {
        id: STRESS_ID,
        description: "Maximum chain length verifies middle removal and linked-list output formatting.",
        input: lines([n, spaced(rangeValues(n))]),
        output: shiftedWithoutMiddle(n),
        timeLimitSeconds: 2,
    };
}

function build40(): StressCase {
    const n = 50_000;
    const q = 50_000;
    return {
        id: STRESS_ID,
        description: "Maximum repeated prefix lookup: brute prefix scans must compare every word against every query.",
        input: lines([`${n} ${q}`, repeatValue("a".repeat(30), n), repeatValue("a".repeat(30), q)]),
        output: simulateQueuePrefix(n, q),
        timeLimitSeconds: 3,
    };
}

const builders: Record<string, () => StressCase> = {
    "1": build1,
    "2": build2,
    "3": build3,
    "4": build4,
    "5": build5,
    "6": build6,
    "7": build7,
    "8": build8,
    "9": build9,
    "10": build10,
    "11": build11,
    "12": build12,
    "13": build13,
    "14": build14,
    "15": build15,
    "16": build16,
    "17": build17,
    "18": build18,
    "19": build19,
    "20": build20,
    "21": build21,
    "22": build22,
    "23": build23,
    "24": build24,
    "25": build25,
    "26": build26,
    "27": build27,
    "28": build28,
    "29": build29,
    "30": build30,
    "31": build31,
    "32": build32,
    "33": build33,
    "34": build34,
    "35": build35,
    "36": build36,
    "37": build37,
    "38": build38,
    "39": build39,
    "40": build40,
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
            console.warn(`[stress1-40] ${frontendId}: question not found`);
            continue;
        }

        const stress = build();
        const sampleCount = (question.sampleTestCases || []).length;
        const maxHidden = Math.max(0, 20 - sampleCount);
        const previousHidden = question.hiddenTestCases || [];
        const keptHidden = previousHidden.filter((testCase: any) => !GENERATED_STRESS_IDS.has(testCase.id));

        question.hiddenTestCases = [
            {
                id: stress.id,
                description: stress.description,
                input: stress.input,
                output: stress.output,
            },
            ...keptHidden,
        ].slice(0, maxHidden) as any;

        question.constraints = withRuntimeConstraints(question.constraints as any, stress.timeLimitSeconds) as any;
        patchKnownSolutionCode(question);

        await question.save();

        console.log(
            `[stress1-40] ${frontendId} ${question.title}: hidden ${previousHidden.length} -> ${question.hiddenTestCases.length}, ` +
            `total=${sampleCount + question.hiddenTestCases.length}, time=${stress.timeLimitSeconds}s, ` +
            `inputChars=${stress.input.length}, outputChars=${stress.output.length}`
        );
    }

    await mongoose.disconnect();
}

main().catch(async (error) => {
    console.error("[stress1-40] failed:", error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
