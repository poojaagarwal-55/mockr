/**
 * Adds one maximal stress hidden test to each DSA question 40-70.
 *
 * Usage:
 *   npx tsx apps/api/src/scripts/add-dsa-40-70-stress-hidden.ts
 *
 * The script is idempotent. It replaces only the generated stress case
 * and appends a per-question Time Limit constraint capped by the API at 5s.
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
dotenv.config(envPath ? { path: envPath } : undefined);

type StressCase = {
    id: string;
    description: string;
    input: string;
    output: string;
    timeLimitSeconds: number;
};

const STRESS_ID = "hidden_stress_40_70_guard";
const MOD = 1_000_000_007;

function lines(parts: Array<string | number | bigint>): string {
    return parts.map(String).join("\n");
}

function spaced(values: Array<string | number | bigint>): string {
    return values.map(String).join(" ");
}

function repeatValue(value: string | number, count: number): string {
    return Array.from({ length: count }, () => String(value)).join(" ");
}

function withRuntimeConstraints(constraints: string[] | undefined, seconds: number): string[] {
    const kept = (constraints || []).filter(
        (line) => !/^time\s*limit\s*[:=]/i.test(line) && !/^memory\s*limit\s*[:=]/i.test(line)
    );
    return [...kept, `Time Limit: ${Math.min(5, Math.max(1, seconds))}s`, "Memory Limit: 256MB"];
}

function buildLowercaseToken(index: number, length: number, first = "y"): string {
    const chars = [first];
    let x = index + 1;
    while (chars.length < length) {
        chars.push(String.fromCharCode(97 + (x % 26)));
        x = Math.floor(x / 26) + 7;
    }
    return chars.join("");
}

function oneSwapPrevious(values: number[]): number[] {
    const arr = [...values];
    let i = arr.length - 2;
    while (i >= 0 && arr[i] <= arr[i + 1]) i--;
    if (i < 0) return arr;
    let j = arr.length - 1;
    while (arr[j] >= arr[i]) j--;
    while (j > i + 1 && arr[j] === arr[j - 1]) j--;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return arr;
}

function futureOrWindows(readings: number[]): number[] {
    const last = Array(31).fill(-1);
    const answer = Array(readings.length).fill(1);
    for (let i = readings.length - 1; i >= 0; i--) {
        for (let bit = 0; bit < 31; bit++) {
            if (Math.floor(readings[i]! / 2 ** bit) % 2 === 1) last[bit] = i;
            if (last[bit] !== -1) answer[i] = Math.max(answer[i]!, last[bit] - i + 1);
        }
    }
    return answer;
}

function reverseOddLevels(values: number[]): number[] {
    const arr = [...values];
    let start = 1;
    let width = 2;
    let level = 1;
    while (start < arr.length) {
        const end = Math.min(arr.length - 1, start + width - 1);
        if (level % 2 === 1) {
            for (let l = start, r = end; l < r; l++, r--) {
                [arr[l], arr[r]] = [arr[r]!, arr[l]!];
            }
        }
        start += width;
        width *= 2;
        level++;
    }
    return arr;
}

function matrixRows(rows: number, cols: number, valueAt: (r: number, c: number) => number): string[] {
    return Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => String(valueAt(r, c))).join(" ")
    );
}

function countMirrorPairs(codes: string[]): bigint {
    const positions = new Map<string, number[]>();
    for (let i = 0; i < codes.length; i++) {
        const list = positions.get(codes[i]!) || [];
        list.push(i);
        positions.set(codes[i]!, list);
    }

    const isPalindrome = (s: string, left: number, right: number): boolean => {
        while (left < right) {
            if (s[left++] !== s[right--]) return false;
        }
        return true;
    };

    let answer = 0n;
    for (let i = 0; i < codes.length; i++) {
        const word = codes[i]!;
        for (let cut = 0; cut <= word.length; cut++) {
            if (isPalindrome(word, 0, cut - 1)) {
                const need = word.slice(cut).split("").reverse().join("");
                for (const j of positions.get(need) || []) if (j !== i) answer++;
            }
            if (cut !== word.length && isPalindrome(word, cut, word.length - 1)) {
                const need = word.slice(0, cut).split("").reverse().join("");
                for (const j of positions.get(need) || []) if (j !== i) answer++;
            }
        }
    }
    return answer;
}

function countDistinctSubstrings(s: string): number {
    type State = { link: number; len: number; next: Map<string, number> };
    const states: State[] = [{ link: -1, len: 0, next: new Map() }];
    let last = 0;

    for (const ch of s) {
        const cur = states.length;
        states.push({ link: 0, len: states[last]!.len + 1, next: new Map() });
        let p = last;
        while (p !== -1 && !states[p]!.next.has(ch)) {
            states[p]!.next.set(ch, cur);
            p = states[p]!.link;
        }
        if (p === -1) {
            states[cur]!.link = 0;
        } else {
            const q = states[p]!.next.get(ch)!;
            if (states[p]!.len + 1 === states[q]!.len) {
                states[cur]!.link = q;
            } else {
                const clone = states.length;
                states.push({ link: states[q]!.link, len: states[p]!.len + 1, next: new Map(states[q]!.next) });
                while (p !== -1 && states[p]!.next.get(ch) === q) {
                    states[p]!.next.set(ch, clone);
                    p = states[p]!.link;
                }
                states[q]!.link = clone;
                states[cur]!.link = clone;
            }
        }
        last = cur;
    }

    return states.reduce((total, state, idx) => {
        if (idx === 0) return total;
        return total + state.len - states[state.link]!.len;
    }, 0);
}

function powMod(base: number, exp: number): string {
    const mod = BigInt(MOD);
    let result = 1n;
    let current = BigInt(base) % mod;
    let power = BigInt(exp);
    while (power > 0n) {
        if (power & 1n) result = (result * current) % mod;
        current = (current * current) % mod;
        power >>= 1n;
    }
    return result.toString();
}

function randomLowercase(length: number): string {
    let state = 987_654_321;
    let result = "";
    for (let i = 0; i < length; i++) {
        state = (state * 48_271) % 2_147_483_647;
        result += String.fromCharCode(97 + ((state + i * 11) % 26));
    }
    return result;
}

function stableAlertCode(alertsA: number, alertsB: number): string {
    let answer = "";
    let last = "#";
    let run = 0;

    const canFinish = (a: number, b: number, ch: string, currentRun: number): boolean => {
        const aCap = ch === "a" ? (2 - currentRun) + 2 * b : 2 * (b + 1);
        const bCap = ch === "b" ? (2 - currentRun) + 2 * a : 2 * (a + 1);
        return a <= aCap && b <= bCap;
    };

    while (alertsA > 0 || alertsB > 0) {
        for (const ch of ["a", "b"]) {
            if (ch === "a") {
                if (alertsA === 0 || (last === ch && run === 2)) continue;
                alertsA--;
                const nextRun = last === ch ? run + 1 : 1;
                if (canFinish(alertsA, alertsB, ch, nextRun)) {
                    answer += ch;
                    last = ch;
                    run = nextRun;
                    break;
                }
                alertsA++;
            } else {
                if (alertsB === 0 || (last === ch && run === 2)) continue;
                alertsB--;
                const nextRun = last === ch ? run + 1 : 1;
                if (canFinish(alertsA, alertsB, ch, nextRun)) {
                    answer += ch;
                    last = ch;
                    run = nextRun;
                    break;
                }
                alertsB++;
            }
        }
    }

    return answer;
}

const FIXED_53_CPP = `class Solution {
public:
    long long smallestSharedEvenCycle(vector<int>& cycles) {
        const long long LIMIT = 1000000000000000000LL;
        auto gcd = [](long long a, long long b) {
            while (b != 0) {
                long long t = a % b;
                a = b;
                b = t;
            }
            return a < 0 ? -a : a;
        };

        long long lcm = 1;
        for (int cycle : cycles) {
            long long g = gcd(lcm, (long long)cycle);
            long long factor = cycle / g;
            if (lcm > LIMIT / factor) return -1;
            lcm *= factor;
        }

        if (lcm % 2 == 1) {
            if (lcm > LIMIT / 2) return -1;
            lcm *= 2;
        }
        return lcm;
    }
};`;

const OPT_69_CPP = `class Solution {
    struct State {
        int link = -1;
        int len = 0;
        unordered_map<char, int> next;
    };

public:
    int countDistinctPackets(string s) {
        vector<State> st(1);
        int last = 0;
        long long answer = 0;

        for (char ch : s) {
            int cur = st.size();
            st.push_back(State());
            st[cur].len = st[last].len + 1;
            int p = last;

            while (p != -1 && !st[p].next.count(ch)) {
                st[p].next[ch] = cur;
                p = st[p].link;
            }

            if (p == -1) {
                st[cur].link = 0;
            } else {
                int q = st[p].next[ch];
                if (st[p].len + 1 == st[q].len) {
                    st[cur].link = q;
                } else {
                    int clone = st.size();
                    st.push_back(st[q]);
                    st[clone].len = st[p].len + 1;
                    while (p != -1 && st[p].next[ch] == q) {
                        st[p].next[ch] = clone;
                        p = st[p].link;
                    }
                    st[q].link = st[cur].link = clone;
                }
            }

            last = cur;
            answer += st[cur].len - st[st[cur].link].len;
        }

        return (int)answer;
    }
};`;

const OPT_69_PYTHON = `class Solution:
    def countDistinctPackets(self, s: str) -> int:
        states = [{"link": -1, "len": 0, "next": {}}]
        last = 0
        answer = 0

        for ch in s:
            cur = len(states)
            states.append({"link": 0, "len": states[last]["len"] + 1, "next": {}})
            p = last
            while p != -1 and ch not in states[p]["next"]:
                states[p]["next"][ch] = cur
                p = states[p]["link"]
            if p == -1:
                states[cur]["link"] = 0
            else:
                q = states[p]["next"][ch]
                if states[p]["len"] + 1 == states[q]["len"]:
                    states[cur]["link"] = q
                else:
                    clone = len(states)
                    states.append({
                        "link": states[q]["link"],
                        "len": states[p]["len"] + 1,
                        "next": dict(states[q]["next"])
                    })
                    while p != -1 and states[p]["next"].get(ch) == q:
                        states[p]["next"][ch] = clone
                        p = states[p]["link"]
                    states[q]["link"] = clone
                    states[cur]["link"] = clone
            last = cur
            answer += states[cur]["len"] - states[states[cur]["link"]]["len"]

        return answer`;

const OPT_69_JAVA = `import java.util.*;

class Solution {
    static class State {
        int link = -1;
        int len = 0;
        Map<Character, Integer> next = new HashMap<>();
    }

    public int countDistinctPackets(String s) {
        ArrayList<State> states = new ArrayList<>();
        states.add(new State());
        int last = 0;
        long answer = 0;

        for (char ch : s.toCharArray()) {
            int cur = states.size();
            State curState = new State();
            curState.len = states.get(last).len + 1;
            states.add(curState);

            int p = last;
            while (p != -1 && !states.get(p).next.containsKey(ch)) {
                states.get(p).next.put(ch, cur);
                p = states.get(p).link;
            }

            if (p == -1) {
                states.get(cur).link = 0;
            } else {
                int q = states.get(p).next.get(ch);
                if (states.get(p).len + 1 == states.get(q).len) {
                    states.get(cur).link = q;
                } else {
                    int clone = states.size();
                    State cloneState = new State();
                    cloneState.link = states.get(q).link;
                    cloneState.len = states.get(p).len + 1;
                    cloneState.next.putAll(states.get(q).next);
                    states.add(cloneState);

                    while (p != -1 && states.get(p).next.get(ch) == q) {
                        states.get(p).next.put(ch, clone);
                        p = states.get(p).link;
                    }
                    states.get(q).link = clone;
                    states.get(cur).link = clone;
                }
            }

            last = cur;
            answer += states.get(cur).len - states.get(states.get(cur).link).len;
        }

        return (int)answer;
    }
}`;

const OPT_69_JS = `class Solution {
    countDistinctPackets(s) {
        const states = [{ link: -1, len: 0, next: new Map() }];
        let last = 0;
        let answer = 0;

        for (const ch of s) {
            const cur = states.length;
            states.push({ link: 0, len: states[last].len + 1, next: new Map() });
            let p = last;

            while (p !== -1 && !states[p].next.has(ch)) {
                states[p].next.set(ch, cur);
                p = states[p].link;
            }

            if (p === -1) {
                states[cur].link = 0;
            } else {
                const q = states[p].next.get(ch);
                if (states[p].len + 1 === states[q].len) {
                    states[cur].link = q;
                } else {
                    const clone = states.length;
                    states.push({
                        link: states[q].link,
                        len: states[p].len + 1,
                        next: new Map(states[q].next)
                    });
                    while (p !== -1 && states[p].next.get(ch) === q) {
                        states[p].next.set(ch, clone);
                        p = states[p].link;
                    }
                    states[q].link = clone;
                    states[cur].link = clone;
                }
            }

            last = cur;
            answer += states[cur].len - states[states[cur].link].len;
        }

        return answer;
    }
}`;

const BRUTE_CPP_BY_ID: Record<string, string> = {
    "43": `class Solution {
public:
    long long auditStoredRainwater(vector<int>& walls) {
        long long stored = 0;
        int n = walls.size();
        for (int i = 0; i < n; ++i) {
            int leftBest = 0, rightBest = 0;
            for (int l = 0; l <= i; ++l) leftBest = max(leftBest, walls[l]);
            for (int r = i; r < n; ++r) rightBest = max(rightBest, walls[r]);
            stored += max(0, min(leftBest, rightBest) - walls[i]);
        }
        return stored;
    }
};`,
    "44": `class Solution {
public:
    long long maximumDraftScore(vector<int>& values, vector<int>& multipliers) {
        int n = values.size(), m = multipliers.size();
        function<long long(int,int)> dfs = [&](int step, int left) -> long long {
            if (step == m) return 0;
            int right = n - 1 - (step - left);
            long long takeLeft = 1LL * multipliers[step] * values[left] + dfs(step + 1, left + 1);
            long long takeRight = 1LL * multipliers[step] * values[right] + dfs(step + 1, left);
            return max(takeLeft, takeRight);
        };
        return dfs(0, 0);
    }
};`,
    "45": `class Solution {
public:
    int minimumSafeHops(vector<int>& blocked, int forward, int backward, int home) {
        unordered_set<int> closed(blocked.begin(), blocked.end());
        int limit = home + forward + backward + 2000;
        for (int x : blocked) limit = max(limit, x + forward + backward + 2000);

        function<bool(int,int,int)> canReach = [&](int pos, int usedBack, int depth) {
            if (pos == home) return true;
            if (depth == 0 || pos < 0 || pos > limit || closed.count(pos)) return false;
            if (canReach(pos + forward, 0, depth - 1)) return true;
            if (!usedBack && canReach(pos - backward, 1, depth - 1)) return true;
            return false;
        };

        for (int depth = 0; depth <= limit; ++depth) {
            if (canReach(0, 0, depth)) return depth;
        }
        return -1;
    }
};`,
    "46": `class Solution {
public:
    vector<int> processMergeRequests(int n, vector<vector<int>>& restrictions, vector<vector<int>>& requests) {
        vector<int> group(n);
        iota(group.begin(), group.end(), 0);
        vector<int> answer;
        for (auto& req : requests) {
            vector<int> candidate = group;
            int from = candidate[req[1]], to = candidate[req[0]];
            for (int i = 0; i < n; ++i) if (candidate[i] == from) candidate[i] = to;
            bool ok = true;
            for (auto& r : restrictions) {
                bool seenA = false, seenB = false;
                for (int i = 0; i < n; ++i) {
                    if (candidate[i] == candidate[r[0]]) seenA = true;
                    if (candidate[i] == candidate[r[1]]) seenB = true;
                }
                if (seenA && seenB && candidate[r[0]] == candidate[r[1]]) { ok = false; break; }
            }
            if (ok) group = candidate;
            answer.push_back(ok ? 1 : 0);
        }
        return answer;
    }
};`,
    "47": `class Solution {
public:
    string lowestBadgeCode(string s, vector<vector<int>>& pairs) {
        int n = s.size();
        vector<int> done(n);
        string answer = s;
        for (int start = 0; start < n; ++start) {
            if (done[start]) continue;
            vector<int> component;
            queue<int> q;
            q.push(start);
            done[start] = 1;
            while (!q.empty()) {
                int u = q.front(); q.pop();
                component.push_back(u);
                for (auto& p : pairs) {
                    int v = -1;
                    if (p[0] == u) v = p[1];
                    if (p[1] == u) v = p[0];
                    if (v != -1 && !done[v]) {
                        done[v] = 1;
                        q.push(v);
                    }
                }
            }
            string chars;
            for (int idx : component) chars.push_back(s[idx]);
            sort(component.begin(), component.end());
            sort(chars.begin(), chars.end());
            for (int i = 0; i < (int)component.size(); ++i) answer[component[i]] = chars[i];
        }
        return answer;
    }
};`,
    "48": `class Solution {
public:
    int longestAlphabetRun(string stream) {
        int n = stream.size(), best = 0;
        for (int i = 0; i < n; ++i) {
            for (int j = i; j < n; ++j) {
                bool ok = true;
                for (int k = i + 1; k <= j; ++k) {
                    if (stream[k] != stream[k - 1] + 1) { ok = false; break; }
                }
                if (ok) best = max(best, j - i + 1);
            }
        }
        return best;
    }
};`,
    "49": `class Solution {
public:
    long long minimumStartingWallet(vector<vector<int>>& transactions) {
        int n = transactions.size();
        vector<int> order(n);
        iota(order.begin(), order.end(), 0);
        long long best = LLONG_MAX;
        function<void(int)> dfs = [&](int pos) {
            if (pos == n) {
                long long money = 0, need = 0;
                for (int idx : order) {
                    int cost = transactions[idx][0], cashback = transactions[idx][1];
                    if (money < cost) { need += cost - money; money = cost; }
                    money -= cost;
                    money += cashback;
                }
                best = min(best, need);
                return;
            }
            for (int i = pos; i < n; ++i) {
                swap(order[pos], order[i]);
                dfs(pos + 1);
                swap(order[pos], order[i]);
            }
        };
        dfs(0);
        return best;
    }
};`,
    "50": `class Solution {
    int dayOfYear(const string& date) {
        vector<int> days = {31,28,31,30,31,30,31,31,30,31,30,31};
        int month = stoi(date.substr(0,2));
        int day = stoi(date.substr(3,2));
        for (int i = 0; i < month - 1; ++i) day += days[i];
        return day;
    }
public:
    int commonOnsiteDays(vector<string>& arrivals, vector<string>& leaves) {
        int best = 0;
        for (int start = 1; start <= 365; ++start) {
            for (int end = start; end <= 365; ++end) {
                bool ok = true;
                for (int i = 0; i < (int)arrivals.size(); ++i) {
                    if (dayOfYear(arrivals[i]) > start || dayOfYear(leaves[i]) < end) { ok = false; break; }
                }
                if (ok) best = max(best, end - start + 1);
            }
        }
        return best;
    }
};`,
    "51": `class Solution {
    bool inRow(char ch, const string& row) {
        ch = tolower(ch);
        for (char r : row) if (tolower(r) == ch) return true;
        return false;
    }
public:
    vector<string> singleLaneWords(vector<string>& rows, vector<string>& words) {
        vector<string> answer;
        for (string& word : words) {
            bool accepted = false;
            for (string& row : rows) {
                bool ok = true;
                for (char ch : word) if (!inRow(ch, row)) { ok = false; break; }
                if (ok) { accepted = true; break; }
            }
            if (accepted) answer.push_back(word);
        }
        return answer;
    }
};`,
    "52": `class Solution {
public:
    vector<int> previousScheduleCode(vector<int>& codes) {
        vector<int> best = codes;
        bool found = false;
        int n = codes.size();
        for (int i = 0; i < n; ++i) {
            for (int j = i + 1; j < n; ++j) {
                vector<int> candidate = codes;
                swap(candidate[i], candidate[j]);
                if (candidate < codes && (!found || candidate > best)) {
                    best = candidate;
                    found = true;
                }
            }
        }
        return best;
    }
};`,
    "53": `class Solution {
    bool valid(long long candidate, vector<int>& cycles) {
        if (candidate % 2) return false;
        for (int cycle : cycles) if (candidate % cycle != 0) return false;
        return true;
    }
public:
    long long smallestSharedEvenCycle(vector<int>& cycles) {
        const long long LIMIT = 1000000000000000000LL;
        for (long long candidate = 2; candidate <= LIMIT; candidate += 2) {
            if (valid(candidate, cycles)) return candidate;
        }
        return -1;
    }
};`,
    "54": `class Solution {
public:
    vector<int> locateSignalPeak(vector<vector<int>>& grid) {
        int rows = grid.size(), cols = grid[0].size();
        for (int r = 0; r < rows; ++r) {
            for (int c = 0; c < cols; ++c) {
                bool peak = true;
                for (int i = 0; i < rows; ++i) {
                    for (int j = 0; j < cols; ++j) {
                        if (abs(i - r) + abs(j - c) == 1 && grid[i][j] >= grid[r][c]) peak = false;
                    }
                }
                if (peak) return {r, c};
            }
        }
        return {-1, -1};
    }
};`,
    "55": `class Solution {
public:
    vector<int> minimumFutureOrWindows(vector<int>& readings) {
        int n = readings.size();
        vector<int> answer(n, 1);
        for (int i = 0; i < n; ++i) {
            int target = 0;
            for (int j = i; j < n; ++j) target |= readings[j];
            int current = 0;
            for (int j = i; j < n; ++j) {
                current |= readings[j];
                if (current == target) { answer[i] = j - i + 1; break; }
            }
        }
        return answer;
    }
};`,
    "56": `class Solution {
public:
    int maximumMatchedTrainees(vector<int>& players, vector<int>& trainers) {
        sort(players.begin(), players.end());
        sort(trainers.begin(), trainers.end());
        vector<int> used(trainers.size());
        int matched = 0;
        for (int skill : players) {
            for (int j = 0; j < (int)trainers.size(); ++j) {
                if (!used[j] && trainers[j] >= skill) {
                    used[j] = 1;
                    matched++;
                    break;
                }
            }
        }
        return matched;
    }
};`,
    "57": `class Solution {
    bool sameLettersSlow(const string& a, const string& b) {
        if (a.size() != b.size()) return false;
        for (char ch : a) {
            int ca = 0, cb = 0;
            for (char x : a) if (x == ch) ca++;
            for (char x : b) if (x == ch) cb++;
            if (ca != cb) return false;
        }
        return true;
    }
public:
    vector<string> cleanupAdjacentAnagrams(vector<string>& words) {
        vector<string> answer;
        for (string& word : words) {
            if (answer.empty() || !sameLettersSlow(answer.back(), word)) answer.push_back(word);
        }
        return answer;
    }
};`,
    "58": `class Solution {
    bool isPalindrome(const string& s) {
        for (int l = 0, r = (int)s.size() - 1; l < r; ++l, --r) if (s[l] != s[r]) return false;
        return true;
    }
public:
    long long countMirrorPairs(vector<string>& codes) {
        long long answer = 0;
        for (int i = 0; i < (int)codes.size(); ++i) {
            for (int j = 0; j < (int)codes.size(); ++j) {
                if (i != j && isPalindrome(codes[i] + codes[j])) answer++;
            }
        }
        return answer;
    }
};`,
    "59": `class Solution {
public:
    vector<int> reverseOddMemoLevels(vector<int>& levelOrder) {
        vector<int> result = levelOrder;
        int start = 1, width = 2, level = 1;
        while (start < (int)result.size()) {
            int end = min((int)result.size(), start + width);
            if (level % 2 == 1) {
                vector<int> reversed;
                for (int i = start; i < end; ++i) {
                    reversed.insert(reversed.begin(), result[i]);
                }
                for (int i = 0; i < (int)reversed.size(); ++i) result[start + i] = reversed[i];
            }
            start += width;
            width *= 2;
            level++;
        }
        return result;
    }
};`,
    "60": `class Solution {
    bool isPrefix(const string& a, const string& b) {
        if (a.size() > b.size()) return false;
        for (int i = 0; i < (int)a.size(); ++i) if (a[i] != b[i]) return false;
        return true;
    }
public:
    vector<int> prefixInfluenceScores(vector<string>& words) {
        vector<int> answer(words.size());
        for (int i = 0; i < (int)words.size(); ++i) {
            int score = 0;
            for (string& word : words) {
                for (int len = 1; len <= (int)words[i].size(); ++len) {
                    if (isPrefix(words[i].substr(0, len), word)) score++;
                }
            }
            answer[i] = score;
        }
        return answer;
    }
};`,
    "61": `class Solution {
public:
    bool canAssembleBlueprint(vector<int>& target, vector<vector<int>>& packets) {
        vector<int> used(packets.size());
        function<bool(int)> dfs = [&](int index) {
            if (index == (int)target.size()) return true;
            for (int p = 0; p < (int)packets.size(); ++p) {
                if (used[p]) continue;
                bool fits = index + (int)packets[p].size() <= (int)target.size();
                for (int j = 0; fits && j < (int)packets[p].size(); ++j) {
                    if (target[index + j] != packets[p][j]) fits = false;
                }
                if (fits) {
                    used[p] = 1;
                    if (dfs(index + packets[p].size())) return true;
                    used[p] = 0;
                }
            }
            return false;
        };
        return dfs(0);
    }
};`,
    "62": `class Solution {
public:
    vector<vector<int>> secureMirrorFrame(vector<vector<int>>& frame) {
        vector<vector<int>> answer;
        for (auto& row : frame) {
            vector<int> built;
            for (int value : row) {
                built.insert(built.begin(), value ^ 1);
            }
            answer.push_back(built);
        }
        return answer;
    }
};`,
    "63": `class Solution {
public:
    long long countBudgetSubarrays(vector<int>& nums, long long k) {
        long long answer = 0;
        for (int i = 0; i < (int)nums.size(); ++i) {
            long long sum = 0;
            for (int j = i; j < (int)nums.size(); ++j) {
                sum += nums[j];
                if (sum * (j - i + 1) < k) answer++;
            }
        }
        return answer;
    }
};`,
    "64": `class Solution {
public:
    bool canMatchAlias(string source, string pattern, vector<string>& mappings) {
        for (int start = 0; start + (int)pattern.size() <= (int)source.size(); ++start) {
            bool ok = true;
            for (int i = 0; i < (int)pattern.size() && ok; ++i) {
                if (pattern[i] == source[start + i]) continue;
                bool allowed = false;
                for (string& mp : mappings) {
                    if (mp[0] == pattern[i] && mp[1] == source[start + i]) { allowed = true; break; }
                }
                if (!allowed) ok = false;
            }
            if (ok) return true;
        }
        return false;
    }
};`,
    "65": `class Solution {
    int componentsAfterRemoving(int removed, vector<vector<int>>& graph) {
        int n = graph.size(), components = 0;
        vector<int> seen(n);
        for (int start = 0; start < n; ++start) {
            if (start == removed || seen[start]) continue;
            components++;
            queue<int> q;
            q.push(start);
            seen[start] = 1;
            while (!q.empty()) {
                int u = q.front(); q.pop();
                for (int v : graph[u]) if (v != removed && !seen[v]) {
                    seen[v] = 1;
                    q.push(v);
                }
            }
        }
        return components;
    }
public:
    int countCriticalRouters(int n, vector<vector<int>>& edges) {
        vector<vector<int>> graph(n);
        for (auto& e : edges) { graph[e[0]].push_back(e[1]); graph[e[1]].push_back(e[0]); }
        int base = componentsAfterRemoving(-1, graph);
        int answer = 0;
        for (int node = 0; node < n; ++node) if (componentsAfterRemoving(node, graph) > base) answer++;
        return answer;
    }
};`,
    "66": `class Solution {
public:
    int maximumMatrixGap(vector<vector<int>>& grid) {
        int rows = grid.size(), cols = grid[0].size();
        int best = INT_MIN;
        for (int r1 = 0; r1 < rows; ++r1) {
            for (int c1 = 0; c1 < cols; ++c1) {
                for (int r2 = r1; r2 < rows; ++r2) {
                    for (int c2 = (r2 == r1 ? c1 + 1 : 0); c2 < cols; ++c2) {
                        best = max(best, grid[r2][c2] - grid[r1][c1]);
                    }
                }
            }
        }
        return best;
    }
};`,
    "67": `class Solution {
    long long sumFrom(int u, vector<vector<int>>& children, vector<int>& load) {
        long long total = load[u];
        for (int v : children[u]) total += sumFrom(v, children, load);
        return total;
    }
public:
    long long largestDivisionLoad(vector<int>& parent, vector<int>& load) {
        int n = parent.size();
        vector<vector<int>> children(n);
        for (int i = 0; i < n; ++i) if (parent[i] != -1) children[parent[i]].push_back(i);
        long long best = LLONG_MIN;
        for (int i = 0; i < n; ++i) best = max(best, sumFrom(i, children, load));
        return best;
    }
};`,
    "68": `class Solution {
    int swapsByTryingOrders(vector<int> values) {
        vector<int> sorted = values;
        sort(sorted.begin(), sorted.end());
        int best = INT_MAX;
        function<void(int,int)> dfs = [&](int idx, int swaps) {
            if (swaps >= best) return;
            if (idx == (int)values.size()) { best = min(best, swaps); return; }
            for (int i = idx; i < (int)values.size(); ++i) {
                if (values[i] == sorted[idx]) {
                    swap(values[i], values[idx]);
                    dfs(idx + 1, swaps + (i != idx));
                    swap(values[i], values[idx]);
                }
            }
        };
        dfs(0, 0);
        return best == INT_MAX ? 0 : best;
    }
public:
    int minimumSwapsToSortedSignalTree(vector<int>& levelOrder) {
        int answer = 0;
        for (int start = 0, width = 1; start < (int)levelOrder.size(); start += width, width *= 2) {
            int end = min((int)levelOrder.size(), start + width);
            vector<int> level(levelOrder.begin() + start, levelOrder.begin() + end);
            answer += swapsByTryingOrders(level);
        }
        return answer;
    }
};`,
    "69": `class Solution {
    bool sameSubstring(const string& s, int a, int b, int len) {
        for (int k = 0; k < len; ++k) if (s[a + k] != s[b + k]) return false;
        return true;
    }
public:
    int countDistinctPackets(string s) {
        int n = s.size(), answer = 0;
        for (int i = 0; i < n; ++i) {
            for (int len = 1; i + len <= n; ++len) {
                bool seen = false;
                for (int prev = 0; prev < i && !seen; ++prev) {
                    if (prev + len <= n && sameSubstring(s, prev, i, len)) seen = true;
                }
                if (!seen) answer++;
            }
        }
        return answer;
    }
};`,
    "70": `class Solution {
    const int MOD = 1000000007;
    bool isPalindrome(const string& s, int l, int r) {
        while (l < r) if (s[l++] != s[r--]) return false;
        return true;
    }
public:
    int countMirrorPartitions(string s) {
        function<int(int)> dfs = [&](int index) -> int {
            if (index == (int)s.size()) return 1;
            long long ways = 0;
            for (int end = index; end < (int)s.size(); ++end) {
                if (isPalindrome(s, index, end)) ways = (ways + dfs(end + 1)) % MOD;
            }
            return (int)ways;
        };
        return dfs(0);
    }
};`,
};

function patchKnownSolutionCode(question: any): void {
    const setCode = (approach: "optimized" | "bruteForce", language: string, code: string): void => {
        const codeMap = question.solution?.[approach]?.code;
        if (codeMap && typeof codeMap.set === "function") {
            codeMap.set(language, code);
        } else {
            question.set(`solution.${approach}.code.${language}`, code);
        }
        question.markModified("solution");
    };

    if (String(question.frontendId || question.problemId) === "53") {
        setCode("optimized", "cpp", FIXED_53_CPP);
        setCode("bruteForce", "cpp", FIXED_53_CPP);
    }

    if (String(question.frontendId || question.problemId) === "69") {
        if (question.solution?.optimized) {
            question.solution.optimized.explanation = "Build a suffix automaton and add the number of new substrings contributed by each character.";
            question.solution.optimized.timeComplexity = "O(n)";
            question.solution.optimized.spaceComplexity = "O(n)";
        }
        setCode("optimized", "cpp", OPT_69_CPP);
        setCode("optimized", "python3", OPT_69_PYTHON);
        setCode("optimized", "java", OPT_69_JAVA);
        setCode("optimized", "javascript", OPT_69_JS);
    }

    const bruteCpp = BRUTE_CPP_BY_ID[String(question.frontendId || question.problemId)];
    if (bruteCpp) {
        setCode("bruteForce", "cpp", bruteCpp);
    }
}

function build40(): StressCase {
    const n = 50_000;
    const q = 50_000;
    return {
        id: STRESS_ID,
        description: "Maximum repeated prefix lookup: brute prefix scans must compare every word against every query.",
        input: lines([`${n} ${q}`, repeatValue("a".repeat(30), n), repeatValue("a".repeat(30), q)]),
        output: repeatValue(n, q),
        timeLimitSeconds: 3,
    };
}

function build41(): StressCase {
    const a = 60_000;
    const b = 60_000;
    return {
        id: STRESS_ID,
        description: "Large balanced alert counts make exponential string construction impossible while greedy construction stays linear.",
        input: `${a} ${b}`,
        output: stableAlertCode(a, b),
        timeLimitSeconds: 3,
    };
}

function build42(): StressCase {
    const roots = Array.from({ length: 49_999 }, (_, i) => buildLowercaseToken(i, 30, "y"));
    roots.push("z".repeat(30));
    const wordCount = 30_000;
    const words = Array.from({ length: wordCount }, () => "z".repeat(30));
    return {
        id: STRESS_ID,
        description: "Many long nonmatching roots force brute replacement to scan almost the full dictionary for every word.",
        input: lines([`${roots.length} ${wordCount}`, roots.join(" "), words.join(" ")]),
        output: words.join(" "),
        timeLimitSeconds: 3,
    };
}

function build43(): StressCase {
    const n = 100_000;
    return {
        id: STRESS_ID,
        description: "Two extreme boundary walls make quadratic left/right rescans too slow.",
        input: lines([n, ["100000", ...Array.from({ length: n - 2 }, () => "0"), "100000"].join(" ")]),
        output: String(BigInt(n - 2) * 100000n),
        timeLimitSeconds: 2,
    };
}

function build44(): StressCase {
    const n = 100_000;
    const m = 1_000;
    return {
        id: STRESS_ID,
        description: "Maximum multiplier count makes subset/backtracking draft choices explode.",
        input: lines([`${n} ${m}`, repeatValue(1000, n), repeatValue(1000, m)]),
        output: "1000000000",
        timeLimitSeconds: 5,
    };
}

function build45(): StressCase {
    return {
        id: STRESS_ID,
        description: "Blocked destination forces path-search brute force to exhaust a huge branching space.",
        input: lines(["1 1 1 10000", "10000"]),
        output: "-1",
        timeLimitSeconds: 2,
    };
}

function build46(): StressCase {
    const n = 1000;
    const r = 5000;
    const q = 5000;
    const restrictions = [
        ...Array.from({ length: r - 1 }, () => "998 999"),
        "0 1",
    ];
    const requests = Array.from({ length: q }, () => "0 1");
    return {
        id: STRESS_ID,
        description: "Every request conflicts with a large restriction list, punishing full rescans and component copies.",
        input: lines([`${n} ${r} ${q}`, ...restrictions, ...requests]),
        output: repeatValue(0, q),
        timeLimitSeconds: 4,
    };
}

function build47(): StressCase {
    const n = 100_000;
    const s = Array.from({ length: n }, (_, i) => String.fromCharCode(122 - (i % 26))).join("");
    const pairs = Array.from({ length: n - 1 }, (_, i) => `${i} ${i + 1}`);
    const counts = Array(26).fill(0);
    for (const ch of s) counts[ch.charCodeAt(0) - 97]++;
    const output = counts.map((count, idx) => String.fromCharCode(97 + idx).repeat(count)).join("");
    return {
        id: STRESS_ID,
        description: "One huge swappable component forces efficient grouping and sorted reconstruction.",
        input: lines([s, pairs.length, ...pairs]),
        output,
        timeLimitSeconds: 4,
    };
}

function build48(): StressCase {
    const n = 200_000;
    const stream = Array.from({ length: n }, (_, i) => String.fromCharCode(97 + (i % 26))).join("");
    return {
        id: STRESS_ID,
        description: "Maximum stream length catches quadratic substring/run checks.",
        input: stream,
        output: "26",
        timeLimitSeconds: 2,
    };
}

function build49(): StressCase {
    const n = 20;
    return {
        id: STRESS_ID,
        description: "Many loss-making transactions make permutation search impossible while the ledger formula is linear.",
        input: lines([n, ...Array.from({ length: n }, () => "100000 0")]),
        output: String(n * 100000),
        timeLimitSeconds: 2,
    };
}

function build50(): StressCase {
    const n = 100_000;
    return {
        id: STRESS_ID,
        description: "Maximum full-year intervals verify date conversion and intersection boundaries.",
        input: lines([n, ...Array.from({ length: n }, () => "01-01 12-31")]),
        output: "365",
        timeLimitSeconds: 2,
    };
}

function build51(): StressCase {
    const rows = Array.from({ length: 10 }, () => "a".repeat(100));
    const word = `${"a".repeat(99)}b`;
    const wordCount = 100_000;
    return {
        id: STRESS_ID,
        description: "Many rejected mixed-row words stress row membership checks without producing a huge visible answer.",
        input: lines([rows.length, ...rows, wordCount, ...Array.from({ length: wordCount }, () => word)]),
        output: "[]",
        timeLimitSeconds: 3,
    };
}

function build52(): StressCase {
    const n = 100_000;
    const values = Array.from({ length: n }, (_, i) => n - i);
    return {
        id: STRESS_ID,
        description: "Maximum descending schedule catches quadratic swap simulation.",
        input: lines([n, spaced(values)]),
        output: spaced(oneSwapPrevious(values)),
        timeLimitSeconds: 3,
    };
}

function build53(): StressCase {
    const cycle = 999_999_937;
    return {
        id: STRESS_ID,
        description: "A large odd cycle verifies lcm parity handling without iterative answer probing.",
        input: lines([1, cycle]),
        output: String(BigInt(cycle) * 2n),
        timeLimitSeconds: 2,
    };
}

function build54(): StressCase {
    const rows = 500;
    const cols = 500;
    return {
        id: STRESS_ID,
        description: "Maximum grid with the only strict peak at the final cell checks boundary handling.",
        input: lines([`${rows} ${cols}`, ...matrixRows(rows, cols, (r, c) => r * cols + c)]),
        output: `${rows - 1} ${cols - 1}`,
        timeLimitSeconds: 2,
    };
}

function build55(): StressCase {
    const n = 200_000;
    const readings = Array.from({ length: n }, () => 0);
    return {
        id: STRESS_ID,
        description: "Maximum reading count exposes quadratic future-window scans.",
        input: lines([n, spaced(readings)]),
        output: spaced(futureOrWindows(readings)),
        timeLimitSeconds: 3,
    };
}

function build56(): StressCase {
    const n = 100_000;
    const m = 100_000;
    return {
        id: STRESS_ID,
        description: "No trainer can match any player, forcing naive nested matching to scan everything.",
        input: lines([`${n} ${m}`, repeatValue(1_000_000_000, n), repeatValue(1, m)]),
        output: "0",
        timeLimitSeconds: 3,
    };
}

function build57(): StressCase {
    const n = 100_000;
    const word = "a".repeat(50) + "b".repeat(50);
    const anagram = "b".repeat(50) + "a".repeat(50);
    const words = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? word : anagram));
    return {
        id: STRESS_ID,
        description: "A long chain of adjacent anagrams keeps only the first word and stresses signature comparison.",
        input: lines([n, ...words]),
        output: word,
        timeLimitSeconds: 3,
    };
}

function build58(): StressCase {
    const half = 5_000;
    const codes: string[] = [];
    for (let i = 0; i < half; i++) {
        const base = buildLowercaseToken(i, 100, "m");
        codes.push(base, base.split("").reverse().join(""));
    }
    return {
        id: STRESS_ID,
        description: "Thousands of long mirror pairs punish pairwise palindrome checks.",
        input: lines([codes.length, ...codes]),
        output: countMirrorPairs(codes).toString(),
        timeLimitSeconds: 5,
    };
}

function build59(): StressCase {
    const n = 131_071;
    const values = Array.from({ length: n }, (_, i) => i + 1);
    return {
        id: STRESS_ID,
        description: "Maximum complete level order verifies odd-level reversal over a large tree array.",
        input: lines([n, spaced(values)]),
        output: spaced(reverseOddLevels(values)),
        timeLimitSeconds: 3,
    };
}

function build60(): StressCase {
    const n = 100_000;
    return {
        id: STRESS_ID,
        description: "Maximum total prefix volume catches pairwise prefix scoring.",
        input: lines([n, ...Array.from({ length: n }, () => "aaa")]),
        output: repeatValue(300_000, n),
        timeLimitSeconds: 4,
    };
}

function build61(): StressCase {
    const targetLength = 100_000;
    const packetCount = 100_000;
    const target = Array.from({ length: targetLength }, (_, i) => i + 1);
    const packets = Array.from({ length: packetCount }, (_, i) => `1 ${packetCount - i}`);
    return {
        id: STRESS_ID,
        description: "Many packet fragments tile a maximum target, making permutation assembly infeasible.",
        input: lines([targetLength, spaced(target), packetCount, ...packets]),
        output: "YES",
        timeLimitSeconds: 4,
    };
}

function build62(): StressCase {
    const rows = 500;
    const cols = 500;
    return {
        id: STRESS_ID,
        description: "Maximum binary frame verifies reverse-and-flip output formatting.",
        input: lines([`${rows} ${cols}`, ...matrixRows(rows, cols, () => 0)]),
        output: matrixRows(rows, cols, () => 1).join("\n"),
        timeLimitSeconds: 3,
    };
}

function build63(): StressCase {
    const n = 100_000;
    return {
        id: STRESS_ID,
        description: "All subarrays are valid, exposing quadratic budget-window enumeration.",
        input: lines([`${n} 1000000000000000`, repeatValue(1, n)]),
        output: String((BigInt(n) * BigInt(n + 1)) / 2n),
        timeLimitSeconds: 3,
    };
}

function build64(): StressCase {
    const sourceLength = 5_000;
    const patternLength = 2_500;
    const mappings = [...Array.from({ length: 1_999 }, () => "c d"), "a b"];
    return {
        id: STRESS_ID,
        description: "Many alignments and mappings punish repeated raw mapping scans.",
        input: lines(["b".repeat(sourceLength), `${"a".repeat(patternLength - 1)}z`, mappings.length, ...mappings]),
        output: "NO",
        timeLimitSeconds: 5,
    };
}

function build65(): StressCase {
    const n = 100_000;
    const edges = Array.from({ length: n - 1 }, (_, i) => `0 ${i + 1}`);
    return {
        id: STRESS_ID,
        description: "A maximum star graph has one critical router and punishes remove-and-recheck algorithms.",
        input: lines([`${n} ${edges.length}`, ...edges]),
        output: "1",
        timeLimitSeconds: 3,
    };
}

function build66(): StressCase {
    const rows = 700;
    const cols = 700;
    return {
        id: STRESS_ID,
        description: "Large increasing matrix makes rectangle-pair brute force impossible.",
        input: lines([`${rows} ${cols}`, ...matrixRows(rows, cols, (r, c) => r * cols + c)]),
        output: String(rows * cols - 1),
        timeLimitSeconds: 3,
    };
}

function build67(): StressCase {
    const n = 50_000;
    const parent = Array.from({ length: n }, (_, i) => (i === 0 ? -1 : i - 1));
    return {
        id: STRESS_ID,
        description: "A long division chain exposes repeated subtree recomputation while staying inside recursion-safe limits.",
        input: lines([n, spaced(parent), repeatValue(1, n)]),
        output: String(n),
        timeLimitSeconds: 3,
    };
}

function build68(): StressCase {
    const levels = 16;
    const n = 2 ** levels - 1;
    const values: number[] = [];
    let current = 1;
    for (let level = 0; level < levels; level++) {
        const width = 2 ** level;
        const levelValues = Array.from({ length: width }, (_, i) => current + i).reverse();
        values.push(...levelValues);
        current += width;
    }
    const swaps = Array.from({ length: levels }, (_, level) => Math.floor(2 ** level / 2))
        .reduce((sum, value) => sum + value, 0);
    return {
        id: STRESS_ID,
        description: "Every level is reversed, forcing real cycle-count swap logic instead of local guessing.",
        input: lines([n, spaced(values)]),
        output: String(swaps),
        timeLimitSeconds: 3,
    };
}

function build69(): StressCase {
    const s = randomLowercase(3_000);
    return {
        id: STRESS_ID,
        description: "A high-diversity maximum string forces substring-copy solutions to store millions of distinct packets.",
        input: s,
        output: String(countDistinctSubstrings(s)),
        timeLimitSeconds: 5,
    };
}

function build70(): StressCase {
    const n = 2_000;
    return {
        id: STRESS_ID,
        description: "An all-mirror string has exponentially many partitions for brute recursion.",
        input: "a".repeat(n),
        output: powMod(2, n - 1),
        timeLimitSeconds: 5,
    };
}

const builders: Record<string, () => StressCase> = {
    "40": build40,
    "41": build41,
    "42": build42,
    "43": build43,
    "44": build44,
    "45": build45,
    "46": build46,
    "47": build47,
    "48": build48,
    "49": build49,
    "50": build50,
    "51": build51,
    "52": build52,
    "53": build53,
    "54": build54,
    "55": build55,
    "56": build56,
    "57": build57,
    "58": build58,
    "59": build59,
    "60": build60,
    "61": build61,
    "62": build62,
    "63": build63,
    "64": build64,
    "65": build65,
    "66": build66,
    "67": build67,
    "68": build68,
    "69": build69,
    "70": build70,
};

async function main(): Promise<void> {
    if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not configured.");

    await mongoose.connect(process.env.MONGODB_URI);

    for (const [frontendId, build] of Object.entries(builders)) {
        const question = await DSAQuestion.findOne({ $or: [{ frontendId }, { problemId: frontendId }] });
        if (!question) {
            console.warn(`[stress40-70] ${frontendId}: question not found`);
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
            `[stress40-70] ${frontendId} ${question.title}: hidden ${previousHidden.length} -> ${question.hiddenTestCases.length}, ` +
            `time=${stress.timeLimitSeconds}s, inputChars=${stress.input.length}, outputChars=${stress.output.length}`
        );
    }

    await mongoose.disconnect();
}

main().catch(async (error) => {
    console.error("[stress40-70] failed:", error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
