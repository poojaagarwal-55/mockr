/**
 * Backfills the tutor knowledge base from existing EvaluationReports.
 *
 * For each report (oldest first), runs the post-session pipeline:
 *   - extracts UserWeakArea rows (upserted by (userId, topic))
 *   - extracts UserMistake rows (replaced per report — idempotent on retry)
 *   - invalidates per-user tutor stats cache
 *
 * Safe to re-run. Skips reports that already have any UserMistake rows
 * (a coarse "already processed" signal) unless --force is passed.
 *
 * Usage (from project root):
 *   npx tsx apps/api/src/scripts/backfill-tutor-knowledge-base.ts
 *
 * Flags:
 *   --limit <n>      Process at most n reports (default: all)
 *   --user <userId>  Only process reports for this user
 *   --force          Reprocess reports even if they already have mistakes
 *   --concurrency <n> Parallel workers (default: 2). Higher = faster, more LLM cost / rate-limit risk.
 *   --dry-run        Print plan without calling the pipeline
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
try { dns.setServers(["8.8.8.8", "8.8.4.4"]); } catch {}

import * as dotenv from "dotenv";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const currentDir =
    typeof __dirname !== "undefined"
        ? __dirname
        : fileURLToPath(new URL(".", (import.meta as any).url));

const envCandidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
    path.resolve(currentDir, "../../../../.env"),
];
const envPath = envCandidates.find((p) => existsSync(p));
dotenv.config(envPath ? { path: envPath } : undefined);

import { prisma } from "../lib/prisma.js";
import { runPostSessionPipeline } from "../services/tutor/post-session-pipeline.js";

type Args = {
    limit: number | null;
    userId: string | null;
    force: boolean;
    concurrency: number;
    dryRun: boolean;
};

function parseArgs(): Args {
    const argv = process.argv.slice(2);
    const args: Args = { limit: null, userId: null, force: false, concurrency: 2, dryRun: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--limit") args.limit = Math.max(1, parseInt(argv[++i] ?? "0", 10) || 0) || null;
        else if (a === "--user") args.userId = argv[++i] ?? null;
        else if (a === "--force") args.force = true;
        else if (a === "--concurrency") args.concurrency = Math.max(1, Math.min(8, parseInt(argv[++i] ?? "2", 10) || 2));
        else if (a === "--dry-run") args.dryRun = true;
        else if (a === "-h" || a === "--help") {
            console.log(`Usage: backfill-tutor-knowledge-base.ts [--limit n] [--user id] [--force] [--concurrency n] [--dry-run]`);
            process.exit(0);
        }
    }
    return args;
}

async function pickReports(args: Args): Promise<{ id: string; userId: string; generatedAt: Date }[]> {
    const reports = await prisma.evaluationReport.findMany({
        where: {
            ...(args.userId ? { userId: args.userId } : {}),
        },
        select: { id: true, userId: true, generatedAt: true },
        orderBy: { generatedAt: "asc" },
        ...(args.limit ? { take: args.limit } : {}),
    });

    if (args.force) return reports;

    // Filter out reports that already have at least one mistake — assume done.
    const ids = reports.map((r) => r.id);
    if (ids.length === 0) return reports;
    const processed = await prisma.userMistake.findMany({
        where: { reportId: { in: ids } },
        select: { reportId: true },
        distinct: ["reportId"],
    });
    const processedSet = new Set(processed.map((p) => p.reportId).filter((id): id is string => !!id));
    return reports.filter((r) => !processedSet.has(r.id));
}

async function runWorkerPool<T>(items: T[], concurrency: number, worker: (item: T, idx: number) => Promise<void>) {
    let cursor = 0;
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (true) {
            const idx = cursor++;
            if (idx >= items.length) return;
            try {
                await worker(items[idx], idx);
            } catch (err: any) {
                console.error(`[backfill] worker error idx=${idx} err=${err?.message ?? err}`);
            }
        }
    });
    await Promise.all(runners);
}

async function main() {
    const args = parseArgs();
    console.log(`[backfill] starting`, args);

    const reports = await pickReports(args);
    console.log(`[backfill] candidates=${reports.length}`);

    if (args.dryRun || reports.length === 0) {
        for (const r of reports.slice(0, 20)) {
            console.log(`  - ${r.id}  user=${r.userId.slice(0, 8)}…  generatedAt=${r.generatedAt.toISOString()}`);
        }
        if (reports.length > 20) console.log(`  … +${reports.length - 20} more`);
        await prisma.$disconnect();
        return;
    }

    let success = 0;
    let failed = 0;
    let totalWeakAreas = 0;
    let totalMistakes = 0;
    const startedAt = Date.now();

    await runWorkerPool(reports, args.concurrency, async (report, idx) => {
        const t0 = Date.now();
        try {
            const res = await runPostSessionPipeline(report.id);
            totalWeakAreas += res.weakAreasUpserted;
            totalMistakes += res.mistakesInserted;
            if (res.errors.length > 0) {
                failed++;
                console.warn(
                    `[backfill] (${idx + 1}/${reports.length}) report=${report.id} partial weakAreas=${res.weakAreasUpserted} mistakes=${res.mistakesInserted} errors=${res.errors.join(",")} (${Date.now() - t0}ms)`
                );
            } else {
                success++;
                console.log(
                    `[backfill] (${idx + 1}/${reports.length}) report=${report.id} ok weakAreas=${res.weakAreasUpserted} mistakes=${res.mistakesInserted} (${Date.now() - t0}ms)`
                );
            }
        } catch (err: any) {
            failed++;
            console.error(`[backfill] (${idx + 1}/${reports.length}) report=${report.id} FAILED ${err?.message ?? err}`);
        }
    });

    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    console.log(
        `[backfill] done success=${success} failed=${failed} weakAreasUpserted=${totalWeakAreas} mistakesInserted=${totalMistakes} elapsed=${elapsedSec}s`
    );

    await prisma.$disconnect();
}

main().catch(async (err) => {
    console.error("[backfill] fatal", err);
    try { await prisma.$disconnect(); } catch {}
    process.exit(1);
});
