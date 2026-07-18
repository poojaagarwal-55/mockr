import type { PrismaClient } from "@interviewforge/db";
import { cacheDel } from "../lib/redis.js";
import type { RunCodeResult } from "./code-execution.js";

interface TrackCodeSubmissionInput {
    prisma: PrismaClient | null | undefined;
    userId: string | null | undefined;
    questionId: string;
    code: string;
    language?: string;
    languageId?: number;
    result: RunCodeResult;
}

function parseNumber(value: string | undefined): number {
    if (!value) return 0;
    const match = value.match(/\d+(?:\.\d+)?/);
    return match ? Number.parseFloat(match[0]) : 0;
}

function deriveSubmissionStatus(result: RunCodeResult): string {
    if (!result.success && result.compileOutput) {
        return "compile_error";
    }

    if (!result.success) {
        return "error";
    }

    const samplePassed = result.sample?.summary?.passed || 0;
    const sampleTotal = result.sample?.summary?.total || 0;
    const hiddenPassed = result.hidden?.summary?.passed || 0;
    const hiddenTotal = result.hidden?.summary?.total || 0;
    const allPassed =
        sampleTotal > 0 &&
        samplePassed === sampleTotal &&
        (!result.hidden?.summary || hiddenPassed === hiddenTotal);

    return allPassed ? "accepted" : "wrong_answer";
}

function getMaxRuntimeAndMemory(result: RunCodeResult): {
    maxRuntimeSeconds: number;
    maxMemoryKb: number;
} {
    let maxRuntimeSeconds = 0;
    let maxMemoryKb = 0;

    for (const test of result.sample?.tests || []) {
        maxRuntimeSeconds = Math.max(maxRuntimeSeconds, parseNumber(test.time));
        maxMemoryKb = Math.max(maxMemoryKb, parseNumber(test.memory));
    }

    if (result.hidden?.firstFailed) {
        maxRuntimeSeconds = Math.max(
            maxRuntimeSeconds,
            parseNumber(result.hidden.firstFailed.time)
        );
        maxMemoryKb = Math.max(
            maxMemoryKb,
            parseNumber(result.hidden.firstFailed.memory)
        );
    }

    return { maxRuntimeSeconds, maxMemoryKb };
}

export async function trackCodeSubmission({
    prisma,
    userId,
    questionId,
    code,
    language,
    languageId,
    result,
}: TrackCodeSubmissionInput): Promise<void> {
    if (!userId || !prisma) return;

    const status = deriveSubmissionStatus(result);
    const { maxRuntimeSeconds, maxMemoryKb } = getMaxRuntimeAndMemory(result);
    const languageLabel = language || languageId?.toString() || "unknown";

    await prisma.userQuestionSubmission.create({
        data: {
            userId,
            questionId,
            code,
            language: languageLabel,
            status,
            runtimeMs:
                maxRuntimeSeconds > 0
                    ? Math.round(maxRuntimeSeconds * 1000)
                    : null,
            memoryKb: maxMemoryKb > 0 ? maxMemoryKb : null,
        },
    });

    const existingProgress = await prisma.userQuestionProgress.findUnique({
        where: { userId_questionId: { userId, questionId } },
    });

    const newStatus =
        status === "accepted"
            ? "solved"
            : existingProgress?.status === "solved"
                ? "solved"
                : "attempted";

    await prisma.userQuestionProgress.upsert({
        where: {
            userId_questionId: { userId, questionId },
        },
        update: {
            status: newStatus,
            lastAttemptedAt: new Date(),
            ...(status === "accepted" &&
                !existingProgress?.solvedAt && { solvedAt: new Date() }),
            language: language || languageId?.toString(),
            attemptCount: { increment: 1 },
        },
        create: {
            userId,
            questionId,
            status: status === "accepted" ? "solved" : "attempted",
            ...(status === "accepted" && { solvedAt: new Date() }),
            language: languageLabel,
            attemptCount: 1,
        },
    });

    await cacheDel([
        `ide:progress:${userId}`,
        `ide:submissions:${userId}:${questionId}`,
    ]);
}
