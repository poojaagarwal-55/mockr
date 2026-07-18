/**
 * Replaces fake brute-force snippets for DSA questions 71-89 in Python,
 * Java, and JavaScript.
 *
 * Usage:
 *   npx tsx apps/api/src/scripts/patch-dsa-71-89-brute-all-languages.ts
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

type Language = "python3" | "java" | "javascript";

const BRUTE_CODE: Record<string, Record<Language, string>> = {
    "71": {
        python3: `class Solution:
    def minimumCourierTour(self, cost):
        n = len(cost)
        best = 10**18
        used = [False] * n
        used[0] = True

        def dfs(city, count, total):
            nonlocal best
            if count == n:
                best = min(best, total + cost[city][0])
                return
            for nxt in range(n):
                if not used[nxt]:
                    used[nxt] = True
                    dfs(nxt, count + 1, total + cost[city][nxt])
                    used[nxt] = False

        dfs(0, 1, 0)
        return best`,
        java: `class Solution {
    int[][] cost;
    boolean[] used;
    int n;
    int best;

    public int minimumCourierTour(int[][] cost) {
        this.cost = cost;
        this.n = cost.length;
        this.used = new boolean[n];
        this.best = Integer.MAX_VALUE;
        used[0] = true;
        dfs(0, 1, 0);
        return best;
    }

    void dfs(int city, int count, int total) {
        if (count == n) {
            best = Math.min(best, total + cost[city][0]);
            return;
        }
        for (int nxt = 0; nxt < n; nxt++) {
            if (!used[nxt]) {
                used[nxt] = true;
                dfs(nxt, count + 1, total + cost[city][nxt]);
                used[nxt] = false;
            }
        }
    }
}`,
        javascript: `class Solution {
    minimumCourierTour(cost) {
        const n = cost.length;
        const used = Array(n).fill(false);
        let best = Infinity;
        used[0] = true;
        const dfs = (city, count, total) => {
            if (count === n) {
                best = Math.min(best, total + cost[city][0]);
                return;
            }
            for (let nxt = 0; nxt < n; nxt++) {
                if (!used[nxt]) {
                    used[nxt] = true;
                    dfs(nxt, count + 1, total + cost[city][nxt]);
                    used[nxt] = false;
                }
            }
        };
        dfs(0, 1, 0);
        return best;
    }
}`,
    },
    "72": {
        python3: `class Solution:
    def bestPipelineBrackets(self, dims):
        n = len(dims) - 1

        def solve(i, j):
            if i == j:
                return 0, "A" + str(i + 1)
            best_cost = 10**30
            best_shape = ""
            for k in range(i, j):
                left_cost, left_shape = solve(i, k)
                right_cost, right_shape = solve(k + 1, j)
                cost = left_cost + right_cost + dims[i] * dims[k + 1] * dims[j + 1]
                if cost < best_cost:
                    best_cost = cost
                    best_shape = "(" + left_shape + right_shape + ")"
            return best_cost, best_shape

        return solve(0, n - 1)[1]`,
        java: `class Solution {
    int[] dims;

    static class Result {
        long cost;
        String shape;
        Result(long cost, String shape) { this.cost = cost; this.shape = shape; }
    }

    public String bestPipelineBrackets(int[] dims) {
        this.dims = dims;
        return solve(0, dims.length - 2).shape;
    }

    Result solve(int i, int j) {
        if (i == j) return new Result(0, "A" + (i + 1));
        Result best = new Result(Long.MAX_VALUE / 4, "");
        for (int k = i; k < j; k++) {
            Result left = solve(i, k);
            Result right = solve(k + 1, j);
            long cost = left.cost + right.cost + 1L * dims[i] * dims[k + 1] * dims[j + 1];
            if (cost < best.cost) best = new Result(cost, "(" + left.shape + right.shape + ")");
        }
        return best;
    }
}`,
        javascript: `class Solution {
    bestPipelineBrackets(dims) {
        const solve = (i, j) => {
            if (i === j) return [0, "A" + (i + 1)];
            let bestCost = Number.MAX_SAFE_INTEGER;
            let bestShape = "";
            for (let k = i; k < j; k++) {
                const [lc, ls] = solve(i, k);
                const [rc, rs] = solve(k + 1, j);
                const cost = lc + rc + dims[i] * dims[k + 1] * dims[j + 1];
                if (cost < bestCost) {
                    bestCost = cost;
                    bestShape = "(" + ls + rs + ")";
                }
            }
            return [bestCost, bestShape];
        };
        return solve(0, dims.length - 2)[1];
    }
}`,
    },
    "73": {
        python3: `class Solution:
    def maximumQuietBonus(self, levelOrder):
        def dfs(i, parent_taken):
            if i >= len(levelOrder) or levelOrder[i] == -1:
                return 0
            skip = dfs(2 * i + 1, False) + dfs(2 * i + 2, False)
            if parent_taken:
                return skip
            take = levelOrder[i] + dfs(2 * i + 1, True) + dfs(2 * i + 2, True)
            return max(take, skip)

        return dfs(0, False)`,
        java: `class Solution {
    int[] levelOrder;

    public long maximumQuietBonus(int[] levelOrder) {
        this.levelOrder = levelOrder;
        return dfs(0, false);
    }

    long dfs(int i, boolean parentTaken) {
        if (i >= levelOrder.length || levelOrder[i] == -1) return 0;
        long skip = dfs(2 * i + 1, false) + dfs(2 * i + 2, false);
        if (parentTaken) return skip;
        long take = levelOrder[i] + dfs(2 * i + 1, true) + dfs(2 * i + 2, true);
        return Math.max(take, skip);
    }
}`,
        javascript: `class Solution {
    maximumQuietBonus(levelOrder) {
        const dfs = (i, parentTaken) => {
            if (i >= levelOrder.length || levelOrder[i] === -1) return 0;
            const skip = dfs(2 * i + 1, false) + dfs(2 * i + 2, false);
            if (parentTaken) return skip;
            const take = levelOrder[i] + dfs(2 * i + 1, true) + dfs(2 * i + 2, true);
            return Math.max(take, skip);
        };
        return dfs(0, false);
    }
}`,
    },
    "74": {
        python3: `class Solution:
    def countBalancedFeedSplits(self, s):
        answer = 0
        for end in range(len(s)):
            balance = 0
            for i in range(end + 1):
                balance += 1 if s[i] == '1' else -1
            if balance == 0:
                answer += 1
        return answer`,
        java: `class Solution {
    public int countBalancedFeedSplits(String s) {
        int answer = 0;
        for (int end = 0; end < s.length(); end++) {
            int balance = 0;
            for (int i = 0; i <= end; i++) balance += s.charAt(i) == '1' ? 1 : -1;
            if (balance == 0) answer++;
        }
        return answer;
    }
}`,
        javascript: `class Solution {
    countBalancedFeedSplits(s) {
        let answer = 0;
        for (let end = 0; end < s.length; end++) {
            let balance = 0;
            for (let i = 0; i <= end; i++) balance += s[i] === "1" ? 1 : -1;
            if (balance === 0) answer++;
        }
        return answer;
    }
}`,
    },
    "75": {
        python3: `class Solution:
    def countMirrorSubstrings(self, s):
        def is_pal(left, right):
            while left < right:
                if s[left] != s[right]:
                    return False
                left += 1
                right -= 1
            return True

        answer = 0
        for i in range(len(s)):
            for j in range(i, len(s)):
                if is_pal(i, j):
                    answer += 1
        return answer`,
        java: `class Solution {
    public long countMirrorSubstrings(String s) {
        long answer = 0;
        for (int i = 0; i < s.length(); i++) {
            for (int j = i; j < s.length(); j++) {
                if (isPalindrome(s, i, j)) answer++;
            }
        }
        return answer;
    }

    boolean isPalindrome(String s, int left, int right) {
        while (left < right) if (s.charAt(left++) != s.charAt(right--)) return false;
        return true;
    }
}`,
        javascript: `class Solution {
    countMirrorSubstrings(s) {
        const isPal = (left, right) => {
            while (left < right) if (s[left++] !== s[right--]) return false;
            return true;
        };
        let answer = 0;
        for (let i = 0; i < s.length; i++) {
            for (let j = i; j < s.length; j++) {
                if (isPal(i, j)) answer++;
            }
        }
        return answer;
    }
}`,
    },
    "76": {
        python3: `class Solution:
    def countExactGrantPlans(self, nums, target):
        import sys
        sys.setrecursionlimit(1000000)
        MOD = 1000000007

        def dfs(i, total):
            if i == len(nums):
                return 1 if total == target else 0
            return (dfs(i + 1, total) + dfs(i + 1, total + nums[i])) % MOD

        return dfs(0, 0)`,
        java: `class Solution {
    static final int MOD = 1000000007;
    int[] nums;
    long target;

    public int countExactGrantPlans(int[] nums, long target) {
        this.nums = nums;
        this.target = target;
        return dfs(0, 0);
    }

    int dfs(int i, long total) {
        if (i == nums.length) return total == target ? 1 : 0;
        long ways = dfs(i + 1, total);
        ways += dfs(i + 1, total + nums[i]);
        return (int)(ways % MOD);
    }
}`,
        javascript: `class Solution {
    countExactGrantPlans(nums, target) {
        const MOD = 1000000007;
        const dfs = (i, total) => {
            if (i === nums.length) return total === target ? 1 : 0;
            return (dfs(i + 1, total) + dfs(i + 1, total + nums[i])) % MOD;
        };
        return dfs(0, 0);
    }
}`,
    },
    "77": {
        python3: `class Solution:
    def countDistinctLongestReviews(self, a, b):
        m, n = len(a), len(b)
        best = 0
        seen = set()
        for mask_a in range(1 << m):
            left = []
            for i in range(m):
                if mask_a & (1 << i):
                    left.append(a[i])
            left = "".join(left)
            for mask_b in range(1 << n):
                if bin(mask_b).count("1") != len(left):
                    continue
                right = []
                for j in range(n):
                    if mask_b & (1 << j):
                        right.append(b[j])
                right = "".join(right)
                if left == right:
                    if len(left) > best:
                        best = len(left)
                        seen.clear()
                    if len(left) == best:
                        seen.add(left)
        return len(seen)`,
        java: `class Solution {
    public int countDistinctLongestReviews(String a, String b) {
        int m = a.length(), n = b.length();
        int best = 0;
        Set<String> seen = new HashSet<>();
        for (int maskA = 0; maskA < (1 << m); maskA++) {
            StringBuilder leftBuilder = new StringBuilder();
            for (int i = 0; i < m; i++) if ((maskA & (1 << i)) != 0) leftBuilder.append(a.charAt(i));
            String left = leftBuilder.toString();
            for (int maskB = 0; maskB < (1 << n); maskB++) {
                if (Integer.bitCount(maskB) != left.length()) continue;
                StringBuilder rightBuilder = new StringBuilder();
                for (int j = 0; j < n; j++) if ((maskB & (1 << j)) != 0) rightBuilder.append(b.charAt(j));
                if (left.equals(rightBuilder.toString())) {
                    if (left.length() > best) {
                        best = left.length();
                        seen.clear();
                    }
                    if (left.length() == best) seen.add(left);
                }
            }
        }
        return seen.size();
    }
}`,
        javascript: `class Solution {
    countDistinctLongestReviews(a, b) {
        const m = a.length, n = b.length;
        let best = 0;
        const seen = new Set();
        const bits = (x) => {
            let c = 0;
            while (x > 0) { c += x & 1; x >>= 1; }
            return c;
        };
        for (let maskA = 0; maskA < (1 << m); maskA++) {
            let left = "";
            for (let i = 0; i < m; i++) if (maskA & (1 << i)) left += a[i];
            for (let maskB = 0; maskB < (1 << n); maskB++) {
                if (bits(maskB) !== left.length) continue;
                let right = "";
                for (let j = 0; j < n; j++) if (maskB & (1 << j)) right += b[j];
                if (left === right) {
                    if (left.length > best) {
                        best = left.length;
                        seen.clear();
                    }
                    if (left.length === best) seen.add(left);
                }
            }
        }
        return seen.size;
    }
}`,
    },
    "78": {
        python3: `class Solution:
    def kthSmallestFromRanges(self, ranges, k):
        low = min(r[0] for r in ranges)
        high = max(r[1] for r in ranges)
        value = low
        while value <= high:
            for left, right in ranges:
                if left <= value <= right:
                    k -= 1
                    if k == 0:
                        return value
            value += 1
        return -1`,
        java: `class Solution {
    public long kthSmallestFromRanges(int[][] ranges, long k) {
        long low = ranges[0][0], high = ranges[0][1];
        for (int[] r : ranges) {
            low = Math.min(low, r[0]);
            high = Math.max(high, r[1]);
        }
        for (long value = low; value <= high; value++) {
            for (int[] r : ranges) {
                if (r[0] <= value && value <= r[1]) {
                    k--;
                    if (k == 0) return value;
                }
            }
        }
        return -1;
    }
}`,
        javascript: `class Solution {
    kthSmallestFromRanges(ranges, k) {
        let low = ranges[0][0], high = ranges[0][1];
        for (const r of ranges) {
            low = Math.min(low, r[0]);
            high = Math.max(high, r[1]);
        }
        for (let value = low; value <= high; value++) {
            for (const r of ranges) {
                if (r[0] <= value && value <= r[1]) {
                    k--;
                    if (k === 0) return value;
                }
            }
        }
        return -1;
    }
}`,
    },
    "79": {
        python3: `class Solution:
    def minimumPaintingDeadline(self, boards, painters):
        best = 10**30

        def dfs(i, used, current, worst):
            nonlocal best
            if used > painters or max(worst, current) >= best:
                return
            if i == len(boards):
                best = min(best, max(worst, current))
                return
            dfs(i + 1, used, current + boards[i], worst)
            if i > 0:
                dfs(i + 1, used + 1, boards[i], max(worst, current))

        dfs(0, 1, 0, 0)
        return best`,
        java: `class Solution {
    int[] boards;
    long painters;
    long best;

    public long minimumPaintingDeadline(int[] boards, long painters) {
        this.boards = boards;
        this.painters = painters;
        this.best = Long.MAX_VALUE / 4;
        dfs(0, 1, 0, 0);
        return best;
    }

    void dfs(int i, long used, long current, long worst) {
        if (used > painters || Math.max(worst, current) >= best) return;
        if (i == boards.length) {
            best = Math.min(best, Math.max(worst, current));
            return;
        }
        dfs(i + 1, used, current + boards[i], worst);
        if (i > 0) dfs(i + 1, used + 1, boards[i], Math.max(worst, current));
    }
}`,
        javascript: `class Solution {
    minimumPaintingDeadline(boards, painters) {
        let best = Number.MAX_SAFE_INTEGER;
        const dfs = (i, used, current, worst) => {
            if (used > painters || Math.max(worst, current) >= best) return;
            if (i === boards.length) {
                best = Math.min(best, Math.max(worst, current));
                return;
            }
            dfs(i + 1, used, current + boards[i], worst);
            if (i > 0) dfs(i + 1, used + 1, boards[i], Math.max(worst, current));
        };
        dfs(0, 1, 0, 0);
        return best;
    }
}`,
    },
    "80": {
        python3: `class Solution:
    def countDistinctMirrorSubstrings(self, s):
        seen = set()
        for i in range(len(s)):
            for j in range(i, len(s)):
                sub = s[i:j + 1]
                if sub == sub[::-1]:
                    seen.add(sub)
        return len(seen)`,
        java: `class Solution {
    public int countDistinctMirrorSubstrings(String s) {
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < s.length(); i++) {
            for (int j = i; j < s.length(); j++) {
                String sub = s.substring(i, j + 1);
                String rev = new StringBuilder(sub).reverse().toString();
                if (sub.equals(rev)) seen.add(sub);
            }
        }
        return seen.size();
    }
}`,
        javascript: `class Solution {
    countDistinctMirrorSubstrings(s) {
        const seen = new Set();
        for (let i = 0; i < s.length; i++) {
            for (let j = i; j < s.length; j++) {
                const sub = s.slice(i, j + 1);
                const rev = sub.split("").reverse().join("");
                if (sub === rev) seen.add(sub);
            }
        }
        return seen.size;
    }
}`,
    },
    "81": {
        python3: `class Solution:
    def maximumUniquePacketEnergy(self, nums):
        best = 0
        for i in range(len(nums)):
            seen = set()
            total = 0
            for j in range(i, len(nums)):
                if nums[j] in seen:
                    break
                seen.add(nums[j])
                total += nums[j]
                best = max(best, total)
        return best`,
        java: `class Solution {
    public long maximumUniquePacketEnergy(int[] nums) {
        long best = 0;
        for (int i = 0; i < nums.length; i++) {
            Set<Integer> seen = new HashSet<>();
            long total = 0;
            for (int j = i; j < nums.length; j++) {
                if (seen.contains(nums[j])) break;
                seen.add(nums[j]);
                total += nums[j];
                best = Math.max(best, total);
            }
        }
        return best;
    }
}`,
        javascript: `class Solution {
    maximumUniquePacketEnergy(nums) {
        let best = 0;
        for (let i = 0; i < nums.length; i++) {
            const seen = new Set();
            let total = 0;
            for (let j = i; j < nums.length; j++) {
                if (seen.has(nums[j])) break;
                seen.add(nums[j]);
                total += nums[j];
                best = Math.max(best, total);
            }
        }
        return best;
    }
}`,
    },
    "82": {
        python3: `class Solution:
    def minimumLockTurns(self, blocked, target):
        closed = set(blocked)
        if "0000" in closed:
            return -1

        def next_codes(code):
            out = []
            for i, ch in enumerate(code):
                d = ord(ch) - 48
                for delta in (-1, 1):
                    nd = (d + delta) % 10
                    out.append(code[:i] + str(nd) + code[i + 1:])
            return out

        def dfs(code, depth):
            if code in closed:
                return False
            if code == target:
                return True
            if depth == 0:
                return False
            for nxt in next_codes(code):
                if dfs(nxt, depth - 1):
                    return True
            return False

        for depth in range(41):
            if dfs("0000", depth):
                return depth
        return -1`,
        java: `class Solution {
    Set<String> closed;
    String target;

    public int minimumLockTurns(String[] blocked, String target) {
        this.closed = new HashSet<>(Arrays.asList(blocked));
        this.target = target;
        if (closed.contains("0000")) return -1;
        for (int depth = 0; depth <= 40; depth++) if (dfs("0000", depth)) return depth;
        return -1;
    }

    boolean dfs(String code, int depth) {
        if (closed.contains(code)) return false;
        if (code.equals(target)) return true;
        if (depth == 0) return false;
        for (String next : nextCodes(code)) if (dfs(next, depth - 1)) return true;
        return false;
    }

    List<String> nextCodes(String code) {
        List<String> out = new ArrayList<>();
        char[] chars = code.toCharArray();
        for (int i = 0; i < 4; i++) {
            int d = chars[i] - '0';
            for (int delta : new int[]{-1, 1}) {
                char[] next = code.toCharArray();
                next[i] = (char)('0' + (d + delta + 10) % 10);
                out.add(new String(next));
            }
        }
        return out;
    }
}`,
        javascript: `class Solution {
    minimumLockTurns(blocked, target) {
        const closed = new Set(blocked);
        if (closed.has("0000")) return -1;
        const nextCodes = (code) => {
            const out = [];
            for (let i = 0; i < 4; i++) {
                const d = Number(code[i]);
                for (const delta of [-1, 1]) {
                    const nd = (d + delta + 10) % 10;
                    out.push(code.slice(0, i) + String(nd) + code.slice(i + 1));
                }
            }
            return out;
        };
        const dfs = (code, depth) => {
            if (closed.has(code)) return false;
            if (code === target) return true;
            if (depth === 0) return false;
            for (const next of nextCodes(code)) if (dfs(next, depth - 1)) return true;
            return false;
        };
        for (let depth = 0; depth <= 40; depth++) if (dfs("0000", depth)) return depth;
        return -1;
    }
}`,
    },
    "83": {
        python3: `class Solution:
    def hasThreeLevelSignal(self, nums):
        n = len(nums)
        for i in range(n):
            for j in range(i + 1, n):
                for k in range(j + 1, n):
                    if nums[i] < nums[k] < nums[j]:
                        return True
        return False`,
        java: `class Solution {
    public boolean hasThreeLevelSignal(int[] nums) {
        int n = nums.length;
        for (int i = 0; i < n; i++) {
            for (int j = i + 1; j < n; j++) {
                for (int k = j + 1; k < n; k++) {
                    if (nums[i] < nums[k] && nums[k] < nums[j]) return true;
                }
            }
        }
        return false;
    }
}`,
        javascript: `class Solution {
    hasThreeLevelSignal(nums) {
        const n = nums.length;
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                for (let k = j + 1; k < n; k++) {
                    if (nums[i] < nums[k] && nums[k] < nums[j]) return true;
                }
            }
        }
        return false;
    }
}`,
    },
    "84": {
        python3: `class Solution:
    def largestStableTriangle(self, edges):
        best = 0
        n = len(edges)
        for i in range(n):
            for j in range(i + 1, n):
                for k in range(j + 1, n):
                    a, b, c = edges[i], edges[j], edges[k]
                    if a + b > c and a + c > b and b + c > a:
                        best = max(best, a + b + c)
        return best`,
        java: `class Solution {
    public int largestStableTriangle(int[] edges) {
        int n = edges.length, best = 0;
        for (int i = 0; i < n; i++) {
            for (int j = i + 1; j < n; j++) {
                for (int k = j + 1; k < n; k++) {
                    int a = edges[i], b = edges[j], c = edges[k];
                    if (a + b > c && a + c > b && b + c > a) best = Math.max(best, a + b + c);
                }
            }
        }
        return best;
    }
}`,
        javascript: `class Solution {
    largestStableTriangle(edges) {
        let best = 0;
        for (let i = 0; i < edges.length; i++) {
            for (let j = i + 1; j < edges.length; j++) {
                for (let k = j + 1; k < edges.length; k++) {
                    const a = edges[i], b = edges[j], c = edges[k];
                    if (a + b > c && a + c > b && b + c > a) best = Math.max(best, a + b + c);
                }
            }
        }
        return best;
    }
}`,
    },
    "85": {
        python3: `class Solution:
    def totalAppealScore(self, s):
        answer = 0
        for i in range(len(s)):
            seen = set()
            for j in range(i, len(s)):
                seen.add(s[j])
                answer += len(seen)
        return answer`,
        java: `class Solution {
    public long totalAppealScore(String s) {
        long answer = 0;
        for (int i = 0; i < s.length(); i++) {
            boolean[] seen = new boolean[256];
            int distinct = 0;
            for (int j = i; j < s.length(); j++) {
                int ch = s.charAt(j);
                if (!seen[ch]) {
                    seen[ch] = true;
                    distinct++;
                }
                answer += distinct;
            }
        }
        return answer;
    }
}`,
        javascript: `class Solution {
    totalAppealScore(s) {
        let answer = 0;
        for (let i = 0; i < s.length; i++) {
            const seen = new Set();
            for (let j = i; j < s.length; j++) {
                seen.add(s[j]);
                answer += seen.size;
            }
        }
        return answer;
    }
}`,
    },
    "86": {
        python3: `class Solution:
    def totalVowelWindowLoad(self, s):
        vowels = set("aeiou")
        answer = 0
        for i in range(len(s)):
            for j in range(i, len(s)):
                for k in range(i, j + 1):
                    if s[k] in vowels:
                        answer += 1
        return answer`,
        java: `class Solution {
    public long totalVowelWindowLoad(String s) {
        long answer = 0;
        for (int i = 0; i < s.length(); i++) {
            for (int j = i; j < s.length(); j++) {
                for (int k = i; k <= j; k++) if (isVowel(s.charAt(k))) answer++;
            }
        }
        return answer;
    }

    boolean isVowel(char ch) {
        return ch == 'a' || ch == 'e' || ch == 'i' || ch == 'o' || ch == 'u';
    }
}`,
        javascript: `class Solution {
    totalVowelWindowLoad(s) {
        const vowels = new Set(["a", "e", "i", "o", "u"]);
        let answer = 0;
        for (let i = 0; i < s.length; i++) {
            for (let j = i; j < s.length; j++) {
                for (let k = i; k <= j; k++) if (vowels.has(s[k])) answer++;
            }
        }
        return answer;
    }
}`,
    },
    "87": {
        python3: `class Solution:
    def countSignedBudgetWays(self, nums, target):
        answer = 0

        def dfs(i, total):
            nonlocal answer
            if i == len(nums):
                if total == target:
                    answer += 1
                return
            dfs(i + 1, total + nums[i])
            dfs(i + 1, total - nums[i])

        dfs(0, 0)
        return answer`,
        java: `class Solution {
    int[] nums;
    long target;
    int answer;

    public int countSignedBudgetWays(int[] nums, long target) {
        this.nums = nums;
        this.target = target;
        this.answer = 0;
        dfs(0, 0);
        return answer;
    }

    void dfs(int i, long total) {
        if (i == nums.length) {
            if (total == target) answer++;
            return;
        }
        dfs(i + 1, total + nums[i]);
        dfs(i + 1, total - nums[i]);
    }
}`,
        javascript: `class Solution {
    countSignedBudgetWays(nums, target) {
        let answer = 0;
        const dfs = (i, total) => {
            if (i === nums.length) {
                if (total === target) answer++;
                return;
            }
            dfs(i + 1, total + nums[i]);
            dfs(i + 1, total - nums[i]);
        };
        dfs(0, 0);
        return answer;
    }
}`,
    },
    "88": {
        python3: `class Solution:
    def partitionAuditLengths(self, s):
        answer = []
        start = 0
        while start < len(s):
            end = start
            i = start
            while i <= end:
                last = i
                for j in range(i, len(s)):
                    if s[j] == s[i]:
                        last = j
                end = max(end, last)
                i += 1
            answer.append(end - start + 1)
            start = end + 1
        return answer`,
        java: `class Solution {
    public int[] partitionAuditLengths(String s) {
        ArrayList<Integer> answer = new ArrayList<>();
        int start = 0;
        while (start < s.length()) {
            int end = start;
            for (int i = start; i <= end; i++) {
                int last = i;
                for (int j = i; j < s.length(); j++) if (s.charAt(j) == s.charAt(i)) last = j;
                end = Math.max(end, last);
            }
            answer.add(end - start + 1);
            start = end + 1;
        }
        int[] out = new int[answer.size()];
        for (int i = 0; i < answer.size(); i++) out[i] = answer.get(i);
        return out;
    }
}`,
        javascript: `class Solution {
    partitionAuditLengths(s) {
        const answer = [];
        let start = 0;
        while (start < s.length) {
            let end = start;
            for (let i = start; i <= end; i++) {
                let last = i;
                for (let j = i; j < s.length; j++) if (s[j] === s[i]) last = j;
                end = Math.max(end, last);
            }
            answer.push(end - start + 1);
            start = end + 1;
        }
        return answer;
    }
}`,
    },
    "89": {
        python3: `class Solution:
    def countShortestSafeRoutes(self, n, roads):
        MOD = 1000000007
        graph = [[] for _ in range(n)]
        for u, v, w in roads:
            graph[u].append((v, w))
            graph[v].append((u, w))
        best = 10**30
        ways = 0
        seen = [False] * n

        def dfs(u, dist):
            nonlocal best, ways
            if dist > best:
                return
            if u == n - 1:
                if dist < best:
                    best = dist
                    ways = 1
                elif dist == best:
                    ways = (ways + 1) % MOD
                return
            seen[u] = True
            for v, w in graph[u]:
                if not seen[v]:
                    dfs(v, dist + w)
            seen[u] = False

        dfs(0, 0)
        return ways`,
        java: `class Solution {
    static final int MOD = 1000000007;
    ArrayList<int[]>[] graph;
    boolean[] seen;
    long best;
    int ways;
    int target;

    public int countShortestSafeRoutes(int n, int[][] roads) {
        graph = new ArrayList[n];
        for (int i = 0; i < n; i++) graph[i] = new ArrayList<>();
        for (int[] e : roads) {
            graph[e[0]].add(new int[]{e[1], e[2]});
            graph[e[1]].add(new int[]{e[0], e[2]});
        }
        seen = new boolean[n];
        best = Long.MAX_VALUE / 4;
        ways = 0;
        target = n - 1;
        dfs(0, 0);
        return ways;
    }

    void dfs(int u, long dist) {
        if (dist > best) return;
        if (u == target) {
            if (dist < best) {
                best = dist;
                ways = 1;
            } else if (dist == best) {
                ways = (ways + 1) % MOD;
            }
            return;
        }
        seen[u] = true;
        for (int[] edge : graph[u]) if (!seen[edge[0]]) dfs(edge[0], dist + edge[1]);
        seen[u] = false;
    }
}`,
        javascript: `class Solution {
    countShortestSafeRoutes(n, roads) {
        const MOD = 1000000007;
        const graph = Array.from({ length: n }, () => []);
        for (const [u, v, w] of roads) {
            graph[u].push([v, w]);
            graph[v].push([u, w]);
        }
        const seen = Array(n).fill(false);
        let best = Number.MAX_SAFE_INTEGER;
        let ways = 0;
        const dfs = (u, dist) => {
            if (dist > best) return;
            if (u === n - 1) {
                if (dist < best) {
                    best = dist;
                    ways = 1;
                } else if (dist === best) {
                    ways = (ways + 1) % MOD;
                }
                return;
            }
            seen[u] = true;
            for (const [v, w] of graph[u]) if (!seen[v]) dfs(v, dist + w);
            seen[u] = false;
        };
        dfs(0, 0);
        return ways;
    }
}`,
    },
};

function setSolutionCode(question: any, language: Language, code: string): void {
    const codeMap = question.solution?.bruteForce?.code;
    if (codeMap && typeof codeMap.set === "function") {
        codeMap.set(language, code);
    } else {
        question.set(`solution.bruteForce.code.${language}`, code);
    }
    question.markModified("solution");
}

async function main(): Promise<void> {
    if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not configured.");

    await mongoose.connect(process.env.MONGODB_URI);

    for (const [frontendId, languageCode] of Object.entries(BRUTE_CODE)) {
        const question = await DSAQuestion.findOne({ $or: [{ frontendId }, { problemId: frontendId }] });
        if (!question) {
            console.warn(`[brute-all-langs] ${frontendId}: question not found`);
            continue;
        }

        for (const [language, code] of Object.entries(languageCode) as Array<[Language, string]>) {
            setSolutionCode(question, language, code);
        }

        await question.save();
        console.log(`[brute-all-langs] ${frontendId} ${question.title}: patched python3/java/javascript brute snippets`);
    }

    await mongoose.disconnect();
}

main().catch(async (error) => {
    console.error("[brute-all-langs] failed:", error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
