import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import * as dotenv from "dotenv";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Job } from "bullmq";
import type { RunCodeResult } from "../services/code-execution.js";
import type { CodeExecutionJobData } from "../queues/code-execution-queue.js";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const envCandidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
    path.resolve(currentDir, "../../../.env"),
];
const envPath = envCandidates.find((p) => existsSync(p));
dotenv.config(envPath ? { path: envPath } : undefined);

const [
    { Worker },
    { validateEnv },
    { connectMongoDB },
    { prisma },
    { runCodeForQuestion },
    { trackCodeSubmission },
    { createBullMQConnection, getBullMQEnvInt },
    { CODE_EXECUTION_QUEUE_NAME },
] = await Promise.all([
    import("bullmq"),
    import("../lib/env.js"),
    import("../lib/mongoose.js"),
    import("../lib/prisma.js"),
    import("../services/code-execution.js"),
    import("../services/code-submission-tracking.js"),
    import("../lib/bullmq.js"),
    import("../queues/code-execution-queue.js"),
]);

function getWorkerConcurrency(): number {
    return getBullMQEnvInt(
        ["JUDGE0_QUEUE_CONCURRENCY", "QUEUE_CONCURRENCY"],
        10,
        1
    );
}

validateEnv();
await connectMongoDB();

const worker = new Worker<CodeExecutionJobData, RunCodeResult>(
    CODE_EXECUTION_QUEUE_NAME,
    async (job: Job<CodeExecutionJobData>) => {
        const { questionId, sourceCode, languageId, language, mode, userId, contestId, questionSource } = job.data;

        await job.updateProgress({
            stage: "running",
            startedAt: new Date().toISOString(),
        });

        const result = await runCodeForQuestion({
            questionId,
            sourceCode,
            languageId,
            language,
            mode,
            contestId,
            questionSource,
        });

        if (mode === "submit") {
            try {
                await trackCodeSubmission({
                    prisma,
                    userId,
                    questionId,
                    code: sourceCode,
                    language,
                    languageId,
                    result,
                });
            } catch (err) {
                console.error(
                    `[CodeExecWorker] Failed to track submission for job ${job.id}:`,
                    err
                );
            }
        }

        await job.updateProgress({
            stage: "completed",
            finishedAt: new Date().toISOString(),
        });

        return result;
    },
    {
        connection: createBullMQConnection("code-execution-worker") as any,
        concurrency: getWorkerConcurrency(),
        drainDelay: getBullMQEnvInt("BULLMQ_DRAIN_DELAY_SECONDS", 300, 1),
        stalledInterval: getBullMQEnvInt("BULLMQ_STALLED_INTERVAL_MS", 300_000, 1000),
    }
);

worker.on("completed", (job) => {
    console.log(`[CodeExecWorker] Completed job ${job.id}`);
});

worker.on("failed", (job, err) => {
    console.error(`[CodeExecWorker] Failed job ${job?.id}:`, err);
});

worker.on("error", (err) => {
    console.error("[CodeExecWorker] Worker error:", err);
});

console.log(
    `[CodeExecWorker] Listening on queue "${CODE_EXECUTION_QUEUE_NAME}" with concurrency=${getWorkerConcurrency()}`
);

async function shutdown(signal: string): Promise<void> {
    console.log(`[CodeExecWorker] Received ${signal}, shutting down...`);
    await worker.close();
    await prisma.$disconnect();
    process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
