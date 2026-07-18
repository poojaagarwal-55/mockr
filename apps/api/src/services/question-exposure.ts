import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { Prisma } from "@interviewforge/db";
import { cacheDel, cacheGet } from "../lib/redis.js";
import { prisma } from "../lib/prisma.js";

export type QuestionSource =
    | "dsa"
    | "cs_fundamental"
    | "cs_sql"
    | "genai_concept"
    | "genai_coding"
    | "genai_system_design"
    | "ds_concept"
    | "ds_sql"
    | "ds_coding"
    | "pm_case"
    | "pm_concept"
    | "pm_strategy"
    | "problem_solving_case"
    | "system_design";

export type RecordQuestionExposureInput = {
    userId: string;
    questionSource: QuestionSource;
    questionId: string;
    sessionId?: string | null;
};

const EXPOSURE_CACHE_TTL_SECONDS = 60 * 60 * 24;

function cacheKey(userId: string, source: QuestionSource): string {
    return `api:users:${userId}:question-exposures:v2:${source}`;
}

async function getDurableSeenIds(
    userId: string,
    questionSource: QuestionSource
): Promise<string[]> {
    try {
        const rows = await prisma.$queryRaw<Array<{ question_id: string }>>(
            Prisma.sql`
                SELECT question_id
                FROM user_question_exposures
                WHERE user_id = ${userId}
                  AND question_source = ${questionSource}
            `
        );
        return rows.map((row) => row.question_id);
    } catch (err: any) {
        if (err?.code === "P2010" || String(err?.message || "").includes("user_question_exposures")) {
            console.warn("[QuestionExposure] Ledger table unavailable; treating user as having no durable question exposure.");
            return [];
        }
        throw err;
    }
}

export async function getSeenQuestionIds(
    userId: string,
    questionSource: QuestionSource,
    _legacy?: unknown
): Promise<string[]> {
    return cacheGet(cacheKey(userId, questionSource), EXPOSURE_CACHE_TTL_SECONDS, async () => {
        return Array.from(new Set(await getDurableSeenIds(userId, questionSource)));
    });
}

export async function getLeastRecentlySeenQuestionIds(
    userId: string,
    questionSource: QuestionSource,
    limit: number = 100
): Promise<string[]> {
    if (!userId) return [];

    try {
        const rows = await prisma.$queryRaw<Array<{ question_id: string }>>(
            Prisma.sql`
                SELECT question_id
                FROM user_question_exposures
                WHERE user_id = ${userId}
                  AND question_source = ${questionSource}
                ORDER BY last_seen_at ASC, first_seen_at ASC
                LIMIT ${Math.max(1, Math.min(500, Math.floor(limit)))}
            `
        );
        return rows.map((row) => row.question_id);
    } catch (err: any) {
        if (err?.code === "P2010" || String(err?.message || "").includes("user_question_exposures")) {
            console.warn("[QuestionExposure] Ledger table unavailable; least-recently-seen fallback skipped.");
            return [];
        }
        throw err;
    }
}

export async function findLeastRecentlySeenMongoDoc(
    model: any,
    userId: string,
    questionSource: QuestionSource,
    match: Record<string, any> = {},
    project?: Record<string, any>
): Promise<any | null> {
    const ids = await getLeastRecentlySeenQuestionIds(userId, questionSource);
    const objectIds = toMongoObjectIds(ids);
    if (objectIds.length === 0) return null;
    const matchStage = match._id
        ? { $and: [match, { _id: { $in: objectIds } }] }
        : { ...match, _id: { $in: objectIds } };

    const pipeline: any[] = [
        { $match: matchStage },
        { $addFields: { __dedupeOrder: { $indexOfArray: [objectIds, "$_id"] } } },
        { $sort: { __dedupeOrder: 1 } },
        { $limit: 1 },
    ];

    if (project) {
        pipeline.push({ $project: project });
    }

    const [doc] = await model.aggregate(pipeline);
    return doc ?? null;
}

export async function findLeastRecentlySeenMongoDocs(
    model: any,
    userId: string,
    questionSource: QuestionSource,
    match: Record<string, any> = {},
    limit: number = 1,
    project?: Record<string, any>
): Promise<any[]> {
    const ids = await getLeastRecentlySeenQuestionIds(userId, questionSource, Math.max(limit * 5, 100));
    const objectIds = toMongoObjectIds(ids);
    if (objectIds.length === 0) return [];
    const matchStage = match._id
        ? { $and: [match, { _id: { $in: objectIds } }] }
        : { ...match, _id: { $in: objectIds } };

    const pipeline: any[] = [
        { $match: matchStage },
        { $addFields: { __dedupeOrder: { $indexOfArray: [objectIds, "$_id"] } } },
        { $sort: { __dedupeOrder: 1 } },
        { $limit: Math.max(1, Math.floor(limit)) },
    ];

    if (project) {
        pipeline.push({ $project: project });
    }

    return model.aggregate(pipeline);
}

export async function findRandomMongoDoc(
    model: any,
    match: Record<string, any> = {},
    project?: Record<string, any>
): Promise<any | null> {
    const pipeline: any[] = [
        { $match: match },
        { $sample: { size: 1 } },
    ];

    if (project) {
        pipeline.push({ $project: project });
    }

    const [doc] = await model.aggregate(pipeline);
    return doc ?? null;
}

export async function findRandomMongoDocs(
    model: any,
    match: Record<string, any> = {},
    limit: number = 1,
    project?: Record<string, any>
): Promise<any[]> {
    const pipeline: any[] = [
        { $match: match },
        { $sample: { size: Math.max(1, Math.floor(limit)) } },
    ];

    if (project) {
        pipeline.push({ $project: project });
    }

    return model.aggregate(pipeline);
}

export async function recordQuestionExposure(input: RecordQuestionExposureInput): Promise<void> {
    const questionId = String(input.questionId || "").trim();
    if (!input.userId || !questionId) return;

    try {
        await prisma.$executeRaw(
            Prisma.sql`
                INSERT INTO user_question_exposures (
                    id,
                    user_id,
                    question_source,
                    question_id,
                    session_id,
                    first_seen_at,
                    last_seen_at,
                    seen_count
                )
                VALUES (
                    ${randomUUID()},
                    ${input.userId},
                    ${input.questionSource},
                    ${questionId},
                    ${input.sessionId ?? null},
                    NOW(),
                    NOW(),
                    1
                )
                ON CONFLICT (user_id, question_source, question_id)
                DO UPDATE SET
                    last_seen_at = NOW(),
                    seen_count = user_question_exposures.seen_count + 1,
                    session_id = COALESCE(${input.sessionId ?? null}, user_question_exposures.session_id)
            `
        );
    } catch (err: any) {
        if (err?.code === "P2010" || String(err?.message || "").includes("user_question_exposures")) {
            console.warn("[QuestionExposure] Ledger table unavailable; skipped durable exposure write.");
            return;
        }
        throw err;
    }

    await cacheDel([cacheKey(input.userId, input.questionSource)]);
}

export function toMongoObjectIds(ids: string[]): mongoose.Types.ObjectId[] {
    return ids
        .map((id) => {
            try {
                return new mongoose.Types.ObjectId(id);
            } catch {
                return null;
            }
        })
        .filter((id): id is mongoose.Types.ObjectId => id !== null);
}
