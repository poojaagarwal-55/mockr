import { Queue, QueueEvents, type JobsOptions } from "bullmq";
import {
    createBullMQConnection,
    getBullMQEnvInt,
    isBullMQConfigured,
} from "../lib/bullmq.js";
import type { DsaQuestionSource, RunCodeResult } from "../services/code-execution.js";

export const CODE_EXECUTION_QUEUE_NAME = "code-execution";

export type CodeExecutionJobMode = "run" | "submit";

export interface CodeExecutionJobData {
    userId: string;
    questionId: string;
    sourceCode: string;
    languageId?: number;
    language?: string;
    mode: CodeExecutionJobMode;
    contestId?: string;
    questionSource?: DsaQuestionSource;
}

let codeExecutionQueue:
    | Queue<CodeExecutionJobData, RunCodeResult, CodeExecutionJobMode>
    | null = null;
let codeExecutionQueueEvents: QueueEvents | null = null;

function getDefaultJobOptions(): JobsOptions {
    return {
        attempts: getBullMQEnvInt(["JUDGE0_QUEUE_ATTEMPTS", "QUEUE_MAX_ATTEMPTS"], 2, 1),
        backoff: {
            type: "exponential",
            delay: getBullMQEnvInt(
                ["JUDGE0_QUEUE_BACKOFF_MS", "QUEUE_RETRY_BASE_DELAY_MS"],
                5000,
                100
            ),
        },
        removeOnComplete: {
            age: getBullMQEnvInt("JUDGE0_QUEUE_REMOVE_ON_COMPLETE_AGE", 86400, 60),
            count: getBullMQEnvInt("JUDGE0_QUEUE_REMOVE_ON_COMPLETE_COUNT", 10000, 100),
        },
        removeOnFail: {
            age: getBullMQEnvInt("JUDGE0_QUEUE_REMOVE_ON_FAIL_AGE", 604800, 60),
            count: getBullMQEnvInt("JUDGE0_QUEUE_REMOVE_ON_FAIL_COUNT", 5000, 100),
        },
    };
}

export function getCodeExecutionQueue() {
    if (!codeExecutionQueue) {
        codeExecutionQueue = new Queue<
            CodeExecutionJobData,
            RunCodeResult,
            CodeExecutionJobMode
        >(CODE_EXECUTION_QUEUE_NAME, {
            connection: createBullMQConnection("code-execution-queue") as any,
            defaultJobOptions: getDefaultJobOptions(),
        }) as Queue<CodeExecutionJobData, RunCodeResult, CodeExecutionJobMode>;
    }

    return codeExecutionQueue;
}

export function getCodeExecutionQueueEvents() {
    if (!codeExecutionQueueEvents) {
        codeExecutionQueueEvents = new QueueEvents(CODE_EXECUTION_QUEUE_NAME, {
            connection: createBullMQConnection("code-execution-events") as any,
        });
    }

    return codeExecutionQueueEvents;
}

export async function enqueueCodeExecutionJob(data: CodeExecutionJobData) {
    const queue = getCodeExecutionQueue();
    return queue.add(data.mode, data, {
        priority: data.mode === "submit" ? 1 : 5,
    });
}

export async function getCodeExecutionJobSnapshot(jobId: string, userId?: string) {
    const queue = getCodeExecutionQueue();
    const job = await queue.getJob(jobId);
    if (!job) return null;
    if (userId && job.data.userId !== userId) return null;

    const state = await job.getState();
    return {
        id: job.id,
        name: job.name,
        state,
        progress: job.progress,
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason || null,
        createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
        processedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
        finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
        result: state === "completed" ? job.returnvalue : null,
    };
}

export async function getCodeExecutionQueueCounts() {
    const queue = getCodeExecutionQueue();
    return queue.getJobCounts(
        "waiting",
        "active",
        "delayed",
        "completed",
        "failed",
        "paused"
    );
}

export async function closeCodeExecutionQueueClients(): Promise<void> {
    await Promise.all([
        codeExecutionQueue?.close(),
        codeExecutionQueueEvents?.close(),
    ]);
    codeExecutionQueue = null;
    codeExecutionQueueEvents = null;
}

export { isBullMQConfigured };
