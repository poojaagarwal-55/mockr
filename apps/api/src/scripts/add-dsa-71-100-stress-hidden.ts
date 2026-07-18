/**
 * Adds one generated stress hidden test to each DSA question 71-100.
 *
 * Usage:
 *   npx tsx apps/api/src/scripts/add-dsa-71-100-stress-hidden.ts
 *
 * The script is idempotent. It replaces only the generated stress guard,
 * keeps the existing examples/hidden tests, and patches C++ brute-force
 * snippets for 71-89 where the stored brute code was identical to optimized.
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

const STRESS_ID = "hidden_stress_71_100_guard";
const MOD = 1_000_000_007n;

function lines(parts: Array<string | number | bigint>): string {
    return parts.map(String).join("\n");
}

function spaced(values: Array<string | number | bigint>): string {
    return values.map(String).join(" ");
}

function repeatValue(value: string | number | bigint, count: number): string {
    return Array.from({ length: count }, () => String(value)).join(" ");
}

function withRuntimeConstraints(constraints: string[] | undefined, seconds: number): string[] {
    const kept = (constraints || []).filter(
        (line) => !/^time\s*limit\s*[:=]/i.test(line) && !/^memory\s*limit\s*[:=]/i.test(line)
    );
    return [...kept, `Time Limit: ${Math.min(5, Math.max(1, seconds))}s`, "Memory Limit: 256MB"];
}

function randomLowercase(length: number, seed = 982_451_653): string {
    let state = seed;
    let result = "";
    for (let i = 0; i < length; i++) {
        state = (state * 48_271) % 2_147_483_647;
        result += String.fromCharCode(97 + ((state + i * 17) % 26));
    }
    return result;
}

function bestPipelineBrackets(dims: number[]): string {
    const n = dims.length - 1;
    const dp = Array.from({ length: n }, () => Array(n).fill(0));
    const split = Array.from({ length: n }, () => Array(n).fill(0));
    for (let len = 2; len <= n; len++) {
        for (let i = 0; i + len <= n; i++) {
            const j = i + len - 1;
            dp[i]![j] = Number.MAX_SAFE_INTEGER;
            for (let k = i; k < j; k++) {
                const cost = dp[i]![k]! + dp[k + 1]![j]! + dims[i]! * dims[k + 1]! * dims[j + 1]!;
                if (cost < dp[i]![j]!) {
                    dp[i]![j] = cost;
                    split[i]![j] = k;
                }
            }
        }
    }
    const build = (i: number, j: number): string => {
        if (i === j) return `A${i + 1}`;
        const k = split[i]![j]!;
        return `(${build(i, k)}${build(k + 1, j)})`;
    };
    return build(0, n - 1);
}

function quietBonus(levelOrder: number[]): bigint {
    const take = Array<bigint>(levelOrder.length).fill(0n);
    const skip = Array<bigint>(levelOrder.length).fill(0n);
    for (let i = levelOrder.length - 1; i >= 0; i--) {
        if (levelOrder[i] === -1) continue;
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        const leftTake = left < levelOrder.length ? take[left]! : 0n;
        const leftSkip = left < levelOrder.length ? skip[left]! : 0n;
        const rightTake = right < levelOrder.length ? take[right]! : 0n;
        const rightSkip = right < levelOrder.length ? skip[right]! : 0n;
        take[i] = BigInt(levelOrder[i]!) + leftSkip + rightSkip;
        skip[i] = (leftTake > leftSkip ? leftTake : leftSkip) + (rightTake > rightSkip ? rightTake : rightSkip);
    }
    return take[0]! > skip[0]! ? take[0]! : skip[0]!;
}

function countPalSubstrings(s: string): bigint {
    const n = s.length;
    const d1 = Array(n).fill(0);
    const d2 = Array(n).fill(0);
    let l = 0;
    let r = -1;
    let answer = 0n;
    for (let i = 0; i < n; i++) {
        let k = i > r ? 1 : Math.min(d1[l + r - i]!, r - i + 1);
        while (i - k >= 0 && i + k < n && s[i - k] === s[i + k]) k++;
        d1[i] = k;
        answer += BigInt(k);
        if (i + k - 1 > r) {
            l = i - k + 1;
            r = i + k - 1;
        }
    }

    l = 0;
    r = -1;
    for (let i = 0; i < n; i++) {
        let k = i > r ? 0 : Math.min(d2[l + r - i + 1]!, r - i + 1);
        while (i - k - 1 >= 0 && i + k < n && s[i - k - 1] === s[i + k]) k++;
        d2[i] = k;
        answer += BigInt(k);
        if (i + k - 1 > r) {
            l = i - k;
            r = i + k - 1;
        }
    }
    return answer;
}

function countDistinctPalSubstrings(s: string): number {
    const seen = new Set<string>();
    const expand = (left: number, right: number): void => {
        while (left >= 0 && right < s.length && s[left] === s[right]) {
            seen.add(s.slice(left, right + 1));
            left--;
            right++;
        }
    };
    for (let i = 0; i < s.length; i++) {
        expand(i, i);
        expand(i, i + 1);
    }
    return seen.size;
}

function nCkMod(n: number, k: number): string {
    let result = 1n;
    for (let i = 1; i <= k; i++) {
        result = (result * BigInt(n - k + i)) / BigInt(i);
    }
    return (result % MOD).toString();
}

function totalAppealScore(s: string): bigint {
    const last = Array(256).fill(0);
    let current = 0n;
    let answer = 0n;
    for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        current += BigInt(i + 1 - last[code]!);
        last[code] = i + 1;
        answer += current;
    }
    return answer;
}

function powMod(base: bigint, exp: number): string {
    let result = 1n;
    let current = base % MOD;
    let power = BigInt(exp);
    while (power > 0n) {
        if (power & 1n) result = (result * current) % MOD;
        current = (current * current) % MOD;
        power >>= 1n;
    }
    return result.toString();
}

function repeatedAlphabet(length: number): string {
    const alphabet = "abcdefghijklmnopqrstuvwxyz";
    let s = "";
    while (s.length < length) s += alphabet;
    return s.slice(0, length);
}

const BRUTE_CPP_BY_ID: Record<string, string> = {
    "71": `class Solution {
public:
    int minimumCourierTour(vector<vector<int>>& cost) {
        int n = cost.size();
        vector<int> order;
        for (int i = 1; i < n; ++i) order.push_back(i);
        int best = INT_MAX;
        do {
            int total = 0, prev = 0;
            for (int city : order) {
                total += cost[prev][city];
                prev = city;
            }
            total += cost[prev][0];
            best = min(best, total);
        } while (next_permutation(order.begin(), order.end()));
        return best;
    }
};`,
    "72": `class Solution {
public:
    string bestPipelineBrackets(vector<int>& dims) {
        int n = dims.size() - 1;
        function<pair<long long,string>(int,int)> solve = [&](int i, int j) -> pair<long long,string> {
            if (i == j) return {0, "A" + to_string(i + 1)};
            pair<long long,string> best = {LLONG_MAX / 4, ""};
            for (int k = i; k < j; ++k) {
                auto left = solve(i, k);
                auto right = solve(k + 1, j);
                long long cost = left.first + right.first + 1LL * dims[i] * dims[k + 1] * dims[j + 1];
                string shape = "(" + left.second + right.second + ")";
                if (cost < best.first) best = {cost, shape};
            }
            return best;
        };
        return solve(0, n - 1).second;
    }
};`,
    "73": `class Solution {
public:
    long long maximumQuietBonus(vector<int>& levelOrder) {
        function<long long(int,bool)> dfs = [&](int i, bool parentTaken) -> long long {
            if (i >= (int)levelOrder.size() || levelOrder[i] == -1) return 0;
            long long skip = dfs(2 * i + 1, false) + dfs(2 * i + 2, false);
            if (parentTaken) return skip;
            long long take = levelOrder[i] + dfs(2 * i + 1, true) + dfs(2 * i + 2, true);
            return max(take, skip);
        };
        return dfs(0, false);
    }
};`,
    "74": `class Solution {
public:
    int countBalancedFeedSplits(string s) {
        int answer = 0;
        for (int i = 0; i < (int)s.size(); ++i) {
            int balance = 0;
            for (int j = i; j < (int)s.size(); ++j) {
                balance += s[j] == '1' ? 1 : -1;
                if (balance == 0 && i == 0) answer++;
            }
        }
        return answer;
    }
};`,
    "75": `class Solution {
    bool isPalindrome(const string& s, int l, int r) {
        while (l < r) if (s[l++] != s[r--]) return false;
        return true;
    }
public:
    long long countMirrorSubstrings(string s) {
        long long answer = 0;
        for (int i = 0; i < (int)s.size(); ++i) {
            for (int j = i; j < (int)s.size(); ++j) {
                if (isPalindrome(s, i, j)) answer++;
            }
        }
        return answer;
    }
};`,
    "76": `class Solution {
public:
    int countExactGrantPlans(vector<int>& nums, long long target) {
        const int MOD = 1000000007;
        function<int(int,long long)> dfs = [&](int idx, long long sum) -> int {
            if (idx == (int)nums.size()) return sum == target;
            long long ways = dfs(idx + 1, sum);
            ways += dfs(idx + 1, sum + nums[idx]);
            return (int)(ways % MOD);
        };
        return dfs(0, 0);
    }
};`,
    "77": `class Solution {
public:
    int countDistinctLongestReviews(string a, string b) {
        int m = a.size(), n = b.size();
        int best = 0;
        set<string> seen;
        for (int maskA = 0; maskA < (1 << m); ++maskA) {
            string left;
            for (int i = 0; i < m; ++i) if (maskA & (1 << i)) left.push_back(a[i]);
            for (int maskB = 0; maskB < (1 << n); ++maskB) {
                if (__builtin_popcount((unsigned)maskB) != (int)left.size()) continue;
                string right;
                for (int j = 0; j < n; ++j) if (maskB & (1 << j)) right.push_back(b[j]);
                if (left == right) {
                    if ((int)left.size() > best) {
                        best = left.size();
                        seen.clear();
                    }
                    if ((int)left.size() == best) seen.insert(left);
                }
            }
        }
        return seen.size();
    }
};`,
    "78": `class Solution {
public:
    long long kthSmallestFromRanges(vector<vector<int>>& ranges, long long k) {
        long long low = ranges[0][0], high = ranges[0][1];
        for (auto& r : ranges) {
            low = min(low, (long long)r[0]);
            high = max(high, (long long)r[1]);
        }
        for (long long value = low; value <= high; ++value) {
            for (auto& r : ranges) {
                if (r[0] <= value && value <= r[1]) {
                    --k;
                    if (k == 0) return value;
                }
            }
        }
        return -1;
    }
};`,
    "79": `class Solution {
public:
    long long minimumPaintingDeadline(vector<int>& boards, long long painters) {
        int n = boards.size();
        long long best = LLONG_MAX;
        function<void(int,int,long long,long long)> dfs = [&](int idx, int used, long long current, long long worst) {
            if (used > painters || max(worst, current) >= best) return;
            if (idx == n) {
                best = min(best, max(worst, current));
                return;
            }
            dfs(idx + 1, used, current + boards[idx], worst);
            if (idx > 0) dfs(idx + 1, used + 1, boards[idx], max(worst, current));
        };
        dfs(0, 1, 0, 0);
        return best;
    }
};`,
    "80": `class Solution {
public:
    int countDistinctMirrorSubstrings(string s) {
        unordered_set<string> seen;
        for (int i = 0; i < (int)s.size(); ++i) {
            for (int j = i; j < (int)s.size(); ++j) {
                string sub = s.substr(i, j - i + 1);
                string rev = sub;
                reverse(rev.begin(), rev.end());
                if (sub == rev) seen.insert(sub);
            }
        }
        return seen.size();
    }
};`,
    "81": `class Solution {
public:
    long long maximumUniquePacketEnergy(vector<int>& nums) {
        long long best = 0;
        for (int i = 0; i < (int)nums.size(); ++i) {
            unordered_set<int> seen;
            long long sum = 0;
            for (int j = i; j < (int)nums.size(); ++j) {
                if (seen.count(nums[j])) break;
                seen.insert(nums[j]);
                sum += nums[j];
                best = max(best, sum);
            }
        }
        return best;
    }
};`,
    "82": `class Solution {
public:
    int minimumLockTurns(vector<string>& blocked, string target) {
        unordered_set<string> closed(blocked.begin(), blocked.end());
        if (closed.count("0000")) return -1;
        auto nextCodes = [](const string& code) {
            vector<string> out;
            for (int i = 0; i < 4; ++i) {
                int d = code[i] - '0';
                for (int delta : {-1, 1}) {
                    string next = code;
                    next[i] = char('0' + (d + delta + 10) % 10);
                    out.push_back(next);
                }
            }
            return out;
        };
        function<bool(string,int)> dfs = [&](string code, int depth) -> bool {
            if (closed.count(code)) return false;
            if (code == target) return true;
            if (depth == 0) return false;
            for (string next : nextCodes(code)) {
                if (dfs(next, depth - 1)) return true;
            }
            return false;
        };
        for (int depth = 0; depth <= 40; ++depth) if (dfs("0000", depth)) return depth;
        return -1;
    }
};`,
    "83": `class Solution {
public:
    bool hasThreeLevelSignal(vector<int>& nums) {
        int n = nums.size();
        for (int i = 0; i < n; ++i) {
            for (int j = i + 1; j < n; ++j) {
                for (int k = j + 1; k < n; ++k) {
                    if (nums[i] < nums[k] && nums[k] < nums[j]) return true;
                }
            }
        }
        return false;
    }
};`,
    "84": `class Solution {
public:
    int largestStableTriangle(vector<int>& edges) {
        int n = edges.size(), best = 0;
        for (int i = 0; i < n; ++i) {
            for (int j = i + 1; j < n; ++j) {
                for (int k = j + 1; k < n; ++k) {
                    int a = edges[i], b = edges[j], c = edges[k];
                    if (a + b > c && a + c > b && b + c > a) best = max(best, a + b + c);
                }
            }
        }
        return best;
    }
};`,
    "85": `class Solution {
public:
    long long totalAppealScore(string s) {
        long long answer = 0;
        for (int i = 0; i < (int)s.size(); ++i) {
            vector<int> seen(256);
            int distinct = 0;
            for (int j = i; j < (int)s.size(); ++j) {
                unsigned char ch = s[j];
                if (!seen[ch]) {
                    seen[ch] = 1;
                    distinct++;
                }
                answer += distinct;
            }
        }
        return answer;
    }
};`,
    "86": `class Solution {
    bool isVowel(char ch) {
        return ch == 'a' || ch == 'e' || ch == 'i' || ch == 'o' || ch == 'u';
    }
public:
    long long totalVowelWindowLoad(string s) {
        long long answer = 0;
        for (int i = 0; i < (int)s.size(); ++i) {
            for (int j = i; j < (int)s.size(); ++j) {
                for (int k = i; k <= j; ++k) if (isVowel(s[k])) answer++;
            }
        }
        return answer;
    }
};`,
    "87": `class Solution {
public:
    int countSignedBudgetWays(vector<int>& nums, long long target) {
        int answer = 0;
        function<void(int,long long)> dfs = [&](int idx, long long sum) {
            if (idx == (int)nums.size()) {
                if (sum == target) answer++;
                return;
            }
            dfs(idx + 1, sum + nums[idx]);
            dfs(idx + 1, sum - nums[idx]);
        };
        dfs(0, 0);
        return answer;
    }
};`,
    "88": `class Solution {
public:
    vector<int> partitionAuditLengths(string s) {
        vector<int> answer;
        int start = 0;
        while (start < (int)s.size()) {
            int end = start;
            for (int i = start; i <= end; ++i) {
                int last = i;
                for (int j = i; j < (int)s.size(); ++j) if (s[j] == s[i]) last = j;
                end = max(end, last);
            }
            answer.push_back(end - start + 1);
            start = end + 1;
        }
        return answer;
    }
};`,
    "89": `class Solution {
public:
    int countShortestSafeRoutes(int n, vector<vector<int>>& roads) {
        const int MOD = 1000000007;
        vector<vector<pair<int,int>>> graph(n);
        for (auto& e : roads) {
            graph[e[0]].push_back({e[1], e[2]});
            graph[e[1]].push_back({e[0], e[2]});
        }
        long long best = LLONG_MAX;
        int ways = 0;
        vector<int> seen(n);
        function<void(int,long long)> dfs = [&](int u, long long dist) {
            if (dist > best) return;
            if (u == n - 1) {
                if (dist < best) {
                    best = dist;
                    ways = 1;
                } else if (dist == best) {
                    ways = (ways + 1) % MOD;
                }
                return;
            }
            seen[u] = 1;
            for (auto [v, w] : graph[u]) if (!seen[v]) dfs(v, dist + w);
            seen[u] = 0;
        };
        dfs(0, 0);
        return ways;
    }
};`,
};

function build71(): StressCase {
    const n = 12;
    const matrix = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => (i === j ? 0 : 1)).join(" ")
    );
    return {
        id: STRESS_ID,
        description: "Maximum courier stop count with equal costs makes permutation tours explode while bitmask DP stays small.",
        input: lines([n, ...matrix]),
        output: String(n),
        timeLimitSeconds: 5,
    };
}

function build72(): StressCase {
    const dims = Array.from({ length: 20 }, () => 10);
    return {
        id: STRESS_ID,
        description: "Nineteen pipeline matrices force Catalan recursion to enumerate many bracketings.",
        input: lines([dims.length, spaced(dims)]),
        output: bestPipelineBrackets(dims),
        timeLimitSeconds: 5,
    };
}

function build73(): StressCase {
    const n = 100_000;
    const values = Array.from({ length: n }, () => 1);
    return {
        id: STRESS_ID,
        description: "A large complete level-order chart exposes repeated subtree choices in recursive brute force.",
        input: lines([n, spaced(values)]),
        output: quietBonus(values).toString(),
        timeLimitSeconds: 3,
    };
}

function build74(): StressCase {
    const n = 100_000;
    const s = "01".repeat(n / 2);
    return {
        id: STRESS_ID,
        description: "Maximum alternating feed creates many balanced split points and punishes quadratic rescans.",
        input: s,
        output: String(n / 2),
        timeLimitSeconds: 2,
    };
}

function build75(): StressCase {
    const s = randomLowercase(100_000, 75);
    return {
        id: STRESS_ID,
        description: "A maximum high-diversity alert string catches substring-by-substring palindrome checking.",
        input: s,
        output: countPalSubstrings(s).toString(),
        timeLimitSeconds: 3,
    };
}

function build76(): StressCase {
    const n = 1000;
    const target = 500;
    return {
        id: STRESS_ID,
        description: "A thousand identical grants makes subset recursion impossible while one-dimensional DP is direct.",
        input: lines([`${n} ${target}`, repeatValue(1, n)]),
        output: nCkMod(n, target),
        timeLimitSeconds: 4,
    };
}

function build77(): StressCase {
    const s = "abcdefghijklmnopqrst";
    return {
        id: STRESS_ID,
        description: "Two length-twenty matching reviews force brute subsequence generation to enumerate both power sets.",
        input: `${s} ${s}`,
        output: "1",
        timeLimitSeconds: 5,
    };
}

function build78(): StressCase {
    const m = 100_000;
    const k = 50_000_000_000n;
    const ranges = Array.from({ length: m }, () => "0 1000000000");
    return {
        id: STRESS_ID,
        description: "A huge repeated range stream makes value-by-value emission too slow while binary search counts ranges.",
        input: lines([`${m} ${k}`, ...ranges]),
        output: String((k - 1n) / BigInt(m)),
        timeLimitSeconds: 3,
    };
}

function build79(): StressCase {
    const n = 100_000;
    const painters = 50_000;
    return {
        id: STRESS_ID,
        description: "Maximum board count exposes recursive split enumeration while binary search checks painter load.",
        input: lines([`${n} ${painters}`, repeatValue(1, n)]),
        output: "2",
        timeLimitSeconds: 3,
    };
}

function build80(): StressCase {
    const s = randomLowercase(3_000, 80);
    return {
        id: STRESS_ID,
        description: "A high-diversity token string forces all-substring palindrome tests to scan millions of ranges.",
        input: s,
        output: String(countDistinctPalSubstrings(s)),
        timeLimitSeconds: 5,
    };
}

function build81(): StressCase {
    const n = 100_000;
    const values = Array.from({ length: n }, (_, i) => i + 1);
    return {
        id: STRESS_ID,
        description: "A maximum all-unique stream makes quadratic subarray enumeration too slow.",
        input: lines([n, spaced(values)]),
        output: String((BigInt(n) * BigInt(n + 1)) / 2n),
        timeLimitSeconds: 3,
    };
}

function build82(): StressCase {
    return {
        id: STRESS_ID,
        description: "A distant open lock target makes depth-first move enumeration branch heavily before BFS finishes.",
        input: lines([0, "5555"]),
        output: "20",
        timeLimitSeconds: 3,
    };
}

function build83(): StressCase {
    const n = 100_000;
    const values = Array.from({ length: n }, (_, i) => i + 1);
    return {
        id: STRESS_ID,
        description: "A maximum increasing stream has no three-level pattern, forcing triple-loop scans to exhaust all triples.",
        input: lines([n, spaced(values)]),
        output: "NO",
        timeLimitSeconds: 3,
    };
}

function build84(): StressCase {
    const n = 100_000;
    return {
        id: STRESS_ID,
        description: "Many identical stable edges make cubic triangle enumeration impossible.",
        input: lines([n, repeatValue(100_000_000, n)]),
        output: "300000000",
        timeLimitSeconds: 3,
    };
}

function build85(): StressCase {
    const s = randomLowercase(100_000, 85);
    return {
        id: STRESS_ID,
        description: "A maximum log forces quadratic distinct-character substring scoring to time out.",
        input: s,
        output: totalAppealScore(s).toString(),
        timeLimitSeconds: 3,
    };
}

function build86(): StressCase {
    const n = 100_000n;
    const output = (n * (n + 1n) * (n + 2n)) / 6n;
    return {
        id: STRESS_ID,
        description: "Every character is a vowel, so substring-by-substring vowel counting becomes cubic.",
        input: "a".repeat(Number(n)),
        output: output.toString(),
        timeLimitSeconds: 3,
    };
}

function build87(): StressCase {
    const n = 30;
    return {
        id: STRESS_ID,
        description: "Thirty equal budgets create the largest practical sign-search tree for this constraint.",
        input: lines([`${n} 0`, repeatValue(1, n)]),
        output: "155117520",
        timeLimitSeconds: 5,
    };
}

function build88(): StressCase {
    const n = 100_000;
    const s = repeatedAlphabet(n);
    return {
        id: STRESS_ID,
        description: "A repeated alphabet keeps one giant shard and punishes repeated suffix scans for last occurrence.",
        input: s,
        output: String(n),
        timeLimitSeconds: 3,
    };
}

function build89(): StressCase {
    const layers = 36;
    const n = 2 * layers + 2;
    const end = n - 1;
    const edges: string[] = [];
    const node = (layer: number, side: number) => 1 + 2 * layer + side;
    edges.push(`0 ${node(0, 0)} 1`, `0 ${node(0, 1)} 1`);
    for (let layer = 0; layer + 1 < layers; layer++) {
        for (let a = 0; a < 2; a++) {
            for (let b = 0; b < 2; b++) {
                edges.push(`${node(layer, a)} ${node(layer + 1, b)} 1`);
            }
        }
    }
    edges.push(`${node(layers - 1, 0)} ${end} 1`, `${node(layers - 1, 1)} ${end} 1`);
    return {
        id: STRESS_ID,
        description: "A layered route map has exponentially many shortest routes but only a tiny Dijkstra state space.",
        input: lines([`${n} ${edges.length}`, ...edges]),
        output: powMod(2n, layers),
        timeLimitSeconds: 3,
    };
}

function build90(): StressCase {
    const t = 40;
    const cases = Array.from({ length: t }, () => "1000000000000000000 30 30");
    return {
        id: STRESS_ID,
        description: "More than thirty impossible reactor cases force recursive search to explore both move choices.",
        input: lines([t, ...cases]),
        output: repeatValue("NO", t).replaceAll(" ", "\n"),
        timeLimitSeconds: 2,
    };
}

function build91(): StressCase {
    const t = 40;
    const parts: Array<string | number> = [t];
    const largeN = 180_000;
    const largeParent = Array.from({ length: largeN }, (_, i) => (i === 0 ? -1 : i));
    parts.push(largeN, spaced(largeParent));
    for (let cs = 1; cs < t; cs++) parts.push(1, -1);
    return {
        id: STRESS_ID,
        description: "One huge chain plus many tiny cases exposes repeated parent climbing in the brute layer counter.",
        input: lines(parts),
        output: [String(largeN), ...Array.from({ length: t - 1 }, () => "1")].join("\n"),
        timeLimitSeconds: 3,
    };
}

function build92(): StressCase {
    const t = 100_000;
    return {
        id: STRESS_ID,
        description: "A maximum batch verifies the T-case wrapper and total-string handling for case normalization.",
        input: lines([t, ...Array.from({ length: t }, () => "A")]),
        output: repeatValue("A", t).replaceAll(" ", "\n"),
        timeLimitSeconds: 2,
    };
}

function build93(): StressCase {
    const t = 40;
    const n = 5_000;
    const m = 2_500;
    const parts: Array<string | number> = [t];
    for (let cs = 0; cs < t; cs++) parts.push(`${n} ${m}`, repeatValue(-1, n));
    return {
        id: STRESS_ID,
        description: "Forty large negative-ledger cases make subset selection brute force branch deeply.",
        input: lines(parts),
        output: repeatValue(m, t).replaceAll(" ", "\n"),
        timeLimitSeconds: 3,
    };
}

function build94(): StressCase {
    const t = 100_000;
    return {
        id: STRESS_ID,
        description: "A maximum pulse batch verifies T-case parsing and output formatting for linear decoders.",
        input: lines([t, ...Array.from({ length: t }, () => ".")]),
        output: repeatValue("0", t).replaceAll(" ", "\n"),
        timeLimitSeconds: 2,
    };
}

function build95(): StressCase {
    const t = 40;
    const n = 7_500;
    const s = "1".repeat(n);
    return {
        id: STRESS_ID,
        description: "Large valid magic-code batches verify total length handling and non-hardcoded validators.",
        input: lines([t, ...Array.from({ length: t }, () => s)]),
        output: repeatValue("YES", t).replaceAll(" ", "\n"),
        timeLimitSeconds: 3,
    };
}

function build96(): StressCase {
    const t = 40;
    const n = 7_500;
    const values = Array.from({ length: n }, (_, i) => n - i);
    const parts: Array<string | number> = [t];
    for (let cs = 0; cs < t; cs++) parts.push(n, spaced(values));
    return {
        id: STRESS_ID,
        description: "Forty maximum reversed permutations verify edge-case repair classification.",
        input: lines(parts),
        output: repeatValue(3, t).replaceAll(" ", "\n"),
        timeLimitSeconds: 2,
    };
}

function build97(): StressCase {
    const t = 50;
    const n = 999_999_999_999_999_999n;
    return {
        id: STRESS_ID,
        description: "Large vault increments catch brute distribution loops over n.",
        input: lines([t, ...Array.from({ length: t }, () => `0 0 0 ${n}`)]),
        output: repeatValue("YES", t).replaceAll(" ", "\n"),
        timeLimitSeconds: 2,
    };
}

function build98(): StressCase {
    const t = 40;
    const parts: Array<string | number> = [t];
    const largeN = 299_880;
    const largeValues = Array.from({ length: largeN }, (_, i) => (i % 3) + 1);
    parts.push(largeN, spaced(largeValues));
    for (let cs = 1; cs < t; cs++) parts.push(3, "1 2 3");
    return {
        id: STRESS_ID,
        description: "One huge pod batch plus many tiny cases punish repeated used-array scans.",
        input: lines(parts),
        output: [String(largeN / 3), ...Array.from({ length: t - 1 }, () => "1")].join("\n"),
        timeLimitSeconds: 3,
    };
}

function build99(): StressCase {
    const t = 50;
    const n = 1_000_000_000_000_000_000n;
    const answer = n + (n - 1n) / 9n;
    return {
        id: STRESS_ID,
        description: "Huge fuel ledgers force formula use instead of simulating every purchase.",
        input: lines([t, ...Array.from({ length: t }, () => n.toString())]),
        output: repeatValue(answer, t).replaceAll(" ", "\n"),
        timeLimitSeconds: 2,
    };
}

function build100(): StressCase {
    const t = 40;
    const n = 7_500;
    const s = repeatedAlphabet(n);
    return {
        id: STRESS_ID,
        description: "Forty long aliases punish quadratic distinct-character scans.",
        input: lines([t, ...Array.from({ length: t }, () => s)]),
        output: repeatValue("OPEN", t).replaceAll(" ", "\n"),
        timeLimitSeconds: 3,
    };
}

const builders: Record<string, () => StressCase> = {
    "71": build71,
    "72": build72,
    "73": build73,
    "74": build74,
    "75": build75,
    "76": build76,
    "77": build77,
    "78": build78,
    "79": build79,
    "80": build80,
    "81": build81,
    "82": build82,
    "83": build83,
    "84": build84,
    "85": build85,
    "86": build86,
    "87": build87,
    "88": build88,
    "89": build89,
    "90": build90,
    "91": build91,
    "92": build92,
    "93": build93,
    "94": build94,
    "95": build95,
    "96": build96,
    "97": build97,
    "98": build98,
    "99": build99,
    "100": build100,
};

function patchKnownSolutionCode(question: any): void {
    const frontendId = String(question.frontendId || question.problemId);
    const bruteCpp = BRUTE_CPP_BY_ID[frontendId];
    if (!bruteCpp) return;

    const codeMap = question.solution?.bruteForce?.code;
    if (codeMap && typeof codeMap.set === "function") {
        codeMap.set("cpp", bruteCpp);
    } else {
        question.set("solution.bruteForce.code.cpp", bruteCpp);
    }
    question.markModified("solution");
}

async function main(): Promise<void> {
    if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not configured.");

    await mongoose.connect(process.env.MONGODB_URI);

    for (const [frontendId, build] of Object.entries(builders)) {
        const question = await DSAQuestion.findOne({ $or: [{ frontendId }, { problemId: frontendId }] });
        if (!question) {
            console.warn(`[stress71-100] ${frontendId}: question not found`);
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
            `[stress71-100] ${frontendId} ${question.title}: hidden ${previousHidden.length} -> ${question.hiddenTestCases.length}, ` +
            `time=${stress.timeLimitSeconds}s, inputChars=${stress.input.length}, outputChars=${stress.output.length}`
        );
    }

    await mongoose.disconnect();
}

main().catch(async (error) => {
    console.error("[stress71-100] failed:", error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
