/**
 * Adds worst-case hidden tests for the imported DSA questions 125-139.
 *
 * Usage:
 *   npx tsx apps/api/src/scripts/add-dsa-125-139-stress-hidden.ts
 *
 * The script is idempotent: it replaces the generated stress test by id
 * and leaves all samples, wrappers, solutions, and normal hidden tests intact.
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
};

const STRESS_ID = "hidden_stress_tle_guard";
const FIXED_BOARD_ID = "hidden_stress_fixed_board_correctness";

function lines(parts: Array<string | number | bigint>): string {
    return parts.map(String).join("\n");
}

function completeGraphEdges(n: number): string[] {
    const edges: string[] = [];
    for (let u = 1; u <= n; u++) {
        for (let v = u + 1; v <= n; v++) {
            edges.push(`${u} ${v}`);
        }
    }
    return edges;
}

function nC3(n: number): bigint {
    return (BigInt(n) * BigInt(n - 1) * BigInt(n - 2)) / 6n;
}

function countCompleteGraphSimpleCycles(n: number): bigint {
    let result = 0n;
    let choose = 1n;
    let factorial = 1n;

    for (let k = 1; k <= n; k++) {
        choose = (choose * BigInt(n - k + 1)) / BigInt(k);
        if (k > 1) factorial *= BigInt(k - 1);
        if (k >= 3) result += (choose * factorial) / 2n;
    }

    return result;
}

function buildHighDiversityLowercaseString(n: number): string {
    const alphabet = "abcdefghijklmnopqrstuvwxyz";
    let state = 1_234_567;
    let result = "";
    for (let i = 0; i < n; i++) {
        state = (state * 48_271) % 2_147_483_647;
        result += alphabet[(state + i * 7) % alphabet.length];
    }
    return result;
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
                states.push({
                    link: states[q]!.link,
                    len: states[p]!.len + 1,
                    next: new Map(states[q]!.next),
                });
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

function buildCourierRouteStress(): StressCase {
    const cliqueNodes = 14;
    const n = cliqueNodes + 1;
    const weightedEdges = completeGraphEdges(cliqueNodes).map((edge) => `${edge} 1`);
    return {
        id: STRESS_ID,
        description: "Dense unreachable map: brute path enumeration explores many simple routes before proving the destination is unreachable.",
        input: lines(["1", `${n} ${weightedEdges.length}`, ...weightedEdges]),
        output: "-1",
    };
}

function buildEnvelopeStress(): StressCase {
    const n = 28;
    const envelopes = Array.from({ length: n }, (_, i) => `${i + 1} ${i + 1}`);
    return {
        id: STRESS_ID,
        description: "Strictly increasing envelopes create exponentially many valid chains for permutation/backtracking solutions.",
        input: lines(["1", `${n} 0 0`, ...envelopes]),
        output: String(n),
    };
}

function buildBracketStress(): StressCase {
    const slots = 32;
    const costs = Array.from({ length: slots }, () => "1 1");
    return {
        id: STRESS_ID,
        description: "All positions are repair slots, forcing brute assignment over many bracket choices.",
        input: lines(["1", "?".repeat(slots), ...costs]),
        output: String(slots),
    };
}

function buildJumpPadStress(): StressCase {
    const n = 100_000;
    const m = 9_000;
    const powers = Array.from({ length: n }, () => "1").join(" ");
    const ops = Array.from({ length: m }, () => "1 1");
    const output = Array.from({ length: m }, () => `${n} ${n}`).join("\n");
    return {
        id: STRESS_ID,
        description: "Repeated launches with step size 1 force linear jumping in brute simulators.",
        input: lines(["1", `${n} ${m}`, powers, ...ops]),
        output,
    };
}

function buildFestivalDiameterStress(): StressCase {
    const q = 8_000;
    const ops: string[] = [];
    const out: string[] = [];
    let leaf = 2;
    for (let i = 1; i <= q; i++) {
        ops.push(String(leaf));
        out.push(String(i + 2));
        leaf = 2 * i + 3;
    }
    return {
        id: STRESS_ID,
        description: "Each operation extends the current diameter path, making repeated BFS recomputation quadratic.",
        input: lines(["1", q, ...ops]),
        output: out.join("\n"),
    };
}

function buildRoadUpgradeStress(): StressCase {
    const n = 180;
    const k = 80;
    const matrix = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => (i === j ? 0 : Math.abs(i - j) * 10)).join(" ")
    );
    const dist = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => (i === j ? 0 : Math.abs(i - j) * 10))
    );
    const updates: string[] = [];
    const answers: string[] = [];

    for (let step = 0; step < k; step++) {
        let a = (step * 17) % n;
        let b = (step * 31 + 7) % n;
        if (a === b) b = (b + 1) % n;
        const w = 1 + (step % 9);
        updates.push(`${a + 1} ${b + 1} ${w}`);

        if (w < dist[a][b]) {
            dist[a][b] = w;
            dist[b][a] = w;
        }
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                const viaAB = dist[i][a] + w + dist[b][j];
                const viaBA = dist[i][b] + w + dist[a][j];
                const best = Math.min(dist[i][j], viaAB, viaBA);
                if (best < dist[i][j]) dist[i][j] = best;
            }
        }

        let sum = 0n;
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                sum += BigInt(dist[i][j]);
            }
        }
        answers.push(sum.toString());
    }

    return {
        id: STRESS_ID,
        description: "Many road updates on a dense matrix make full Floyd-Warshall recomputation too slow.",
        input: lines(["1", n, ...matrix, k, ...updates]),
        output: answers.join("\n"),
    };
}

function buildCycleAuditStress(): StressCase {
    const n = 16;
    const edges = completeGraphEdges(n);
    return {
        id: STRESS_ID,
        description: "A complete graph contains an enormous number of simple cycles for DFS enumeration.",
        input: lines(["1", `${n} ${edges.length}`, ...edges]),
        output: countCompleteGraphSimpleCycles(n).toString(),
    };
}

function buildCircularMinimumStress(): StressCase {
    const n = 100_000;
    const updates = 15_000;
    const q = updates + 1;
    const values = Array.from({ length: n }, () => "0").join(" ");
    const ops = [
        ...Array.from({ length: updates }, () => `0 1 ${n} 1`),
        `1 1 ${n}`,
    ];
    return {
        id: STRESS_ID,
        description: "Full-range repeated updates force O(nq) brute arrays to touch hundreds of millions of cells.",
        input: lines(["1", n, values, q, ...ops]),
        output: String(updates),
    };
}

function buildWeaknessTripletStress(): StressCase {
    const n = 5_000;
    const scores = Array.from({ length: n }, (_, i) => String(n - i)).join(" ");
    return {
        id: STRESS_ID,
        description: "A strictly decreasing score list makes every index triple a weakness triplet.",
        input: lines(["1", n, scores]),
        output: nC3(n).toString(),
    };
}

function buildRangePowerStress(): StressCase {
    const n = 100_000;
    const q = 3_000;
    const values = Array.from({ length: n }, () => "1").join(" ");
    const queries = Array.from({ length: q }, () => `1 ${n}`);
    const answer = BigInt(n) * BigInt(n);
    return {
        id: STRESS_ID,
        description: "Large repeated full-range power queries make direct per-query scans exceed the CPU limit.",
        input: lines(["1", `${n} ${q}`, values, ...queries]),
        output: Array.from({ length: q }, () => answer.toString()).join("\n"),
    };
}

function buildBoardStateStress(): StressCase {
    const boards = [
        ["...", "...", "..."],
        ["X..", "...", "..."],
        ["X0.", "0X.", "..X"],
        ["XX.", "000", "X.."],
        ["X0X", "X00", "0XX"],
        ["XXX", "000", "..."],
    ];
    const inputLines = ["6", ...boards.flat()];
    const output = [
        "first",
        "second",
        "the first player won",
        "the second player won",
        "draw",
        "illegal",
    ].join("\n");
    return {
        id: FIXED_BOARD_ID,
        description: "Fixed-size 3x3 boards cannot produce TLE; this case keeps extra edge coverage for legality states.",
        input: lines(inputLines),
        output,
    };
}

function buildWeightedRequestStress(): StressCase {
    const n = 100_000;
    const q = 20_000;
    const values = Array.from({ length: n }, (_, i) => String(i + 1)).join(" ");
    const ranges = Array.from({ length: q }, () => `1 ${n}`);
    const sumValues = (BigInt(n) * BigInt(n + 1)) / 2n;
    return {
        id: STRESS_ID,
        description: "Repeated full-range requests force O(nq) brute frequency counting to scan too much data.",
        input: lines(["1", `${n} ${q}`, values, ...ranges]),
        output: (sumValues * BigInt(q)).toString(),
    };
}

function buildShiftAlignmentStress(): StressCase {
    const n = 1_000;
    const m = 1_000;
    const row = `1${"0".repeat(m - 1)}`;
    return {
        id: STRESS_ID,
        description: "Hundreds of long circular rows expose O(n*m^2) shift scanning while the answer remains simple.",
        input: lines(["1", `${n} ${m}`, ...Array.from({ length: n }, () => row)]),
        output: "0",
    };
}

function buildGoodSubstringStress(): StressCase {
    const n = 1_500;
    const s = buildHighDiversityLowercaseString(n);
    return {
        id: STRESS_ID,
        description: "A high-diversity max-length string forces brute solutions to copy and store many distinct substrings.",
        input: lines(["1", s, "1".repeat(26), "0"]),
        output: String(countDistinctSubstrings(s)),
    };
}

function buildXorSegmentStress(): StressCase {
    const n = 100_000;
    const updates = 15_001;
    const q = updates + 1;
    const values = Array.from({ length: n }, () => "0").join(" ");
    const ops = [
        ...Array.from({ length: updates }, () => `2 1 ${n} 1`),
        `1 1 ${n}`,
    ];
    return {
        id: STRESS_ID,
        description: "Repeated full-range xor updates force brute arrays to touch hundreds of millions of cells.",
        input: lines(["1", n, values, q, ...ops]),
        output: String(n),
    };
}

const stressByFrontendId: Record<string, () => StressCase> = {
    "125": buildCourierRouteStress,
    "126": buildEnvelopeStress,
    "127": buildBracketStress,
    "128": buildJumpPadStress,
    "129": buildFestivalDiameterStress,
    "130": buildRoadUpgradeStress,
    "131": buildCycleAuditStress,
    "132": buildCircularMinimumStress,
    "133": buildWeaknessTripletStress,
    "134": buildRangePowerStress,
    "135": buildBoardStateStress,
    "136": buildWeightedRequestStress,
    "137": buildShiftAlignmentStress,
    "138": buildGoodSubstringStress,
    "139": buildXorSegmentStress,
};

async function main(): Promise<void> {
    if (!process.env.MONGODB_URI) {
        throw new Error("MONGODB_URI is not configured.");
    }

    await mongoose.connect(process.env.MONGODB_URI);

    for (const [frontendId, build] of Object.entries(stressByFrontendId)) {
        const question = await DSAQuestion.findOne({
            $or: [{ frontendId }, { problemId: frontendId }],
        });

        if (!question) {
            console.warn(`[stress] ${frontendId}: question not found`);
            continue;
        }

        const stress = build();
        const previousHidden = question.hiddenTestCases || [];
        question.hiddenTestCases = previousHidden.filter(
            (testCase: any) => testCase.id !== stress.id && testCase.id !== STRESS_ID && testCase.id !== FIXED_BOARD_ID
        ) as any;
        question.hiddenTestCases.push({
            id: stress.id,
            description: stress.description,
            input: stress.input,
            output: stress.output,
        } as any);

        await question.save();

        console.log(
            `[stress] ${frontendId} ${question.title}: hidden ${previousHidden.length} -> ${question.hiddenTestCases.length}, ` +
            `stressInputChars=${stress.input.length}, stressOutputChars=${stress.output.length}`
        );
    }

    await mongoose.disconnect();
}

main().catch(async (error) => {
    console.error("[stress] failed:", error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
