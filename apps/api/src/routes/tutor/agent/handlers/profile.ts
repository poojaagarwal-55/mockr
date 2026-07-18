/**
 * Profile + memory handlers.
 *
 * UserTutorProfile holds explicit goals (target company / role / level /
 * deadline / hours per week / preferred topics + language).
 * TutorMemory holds free-form preferences / facts / feedback that come
 * up during conversation and should persist across chats.
 */

import { TutorMemoryKind } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../../../lib/prisma.js";

const MAX_MEMORIES_RETURNED = 25;
const MAX_MEMORY_VALUE_LENGTH = 800;

// ── Schemas ─────────────────────────────────────────────────────

export const getUserProfileArgs = z.object({}).strict();

export const updateUserProfileArgs = z
    .object({
        targetCompany: z.string().trim().max(80).nullable().optional(),
        targetRole: z.string().trim().max(80).nullable().optional(),
        targetLevel: z.string().trim().max(40).nullable().optional(),
        targetDate: z
            .string()
            .trim()
            .refine((s) => !s || !Number.isNaN(Date.parse(s)), { message: "invalid_date" })
            .nullable()
            .optional(),
        hoursPerWeek: z.coerce.number().int().min(0).max(80).nullable().optional(),
        preferredLanguage: z.string().trim().max(40).nullable().optional(),
        preferredTopics: z.array(z.string().trim().max(60)).max(20).optional(),
        notes: z.string().trim().max(800).nullable().optional(),
    })
    .strict();

export const getTutorMemoriesArgs = z
    .object({
        kind: z.enum(["preference", "goal", "fact", "feedback"]).optional(),
        limit: z.coerce.number().int().min(1).max(MAX_MEMORIES_RETURNED).optional().default(10),
    })
    .strict();

export const saveMemoryArgs = z
    .object({
        kind: z.enum(["preference", "goal", "fact", "feedback"]),
        key: z.string().trim().min(1).max(80),
        value: z.string().trim().min(1).max(MAX_MEMORY_VALUE_LENGTH),
        source: z.enum(["user_stated", "inferred", "tutor_set"]).optional().default("inferred"),
        expiresInDays: z.coerce.number().int().min(1).max(365).optional(),
    })
    .strict();

export const recallRelevantMemoriesArgs = z
    .object({
        query: z.string().trim().min(2).max(120),
        kind: z.enum(["preference", "goal", "fact", "feedback"]).optional(),
        limit: z.coerce.number().int().min(1).max(MAX_MEMORIES_RETURNED).optional().default(8),
    })
    .strict();

// ── Handlers ────────────────────────────────────────────────────

export async function handleGetUserProfile(userId: string, _args: z.infer<typeof getUserProfileArgs>) {
    const profile = await prisma.userTutorProfile.findUnique({
        where: { userId },
    });
    if (!profile) {
        return { exists: false };
    }
    return {
        exists: true,
        targetCompany: profile.targetCompany,
        targetRole: profile.targetRole,
        targetLevel: profile.targetLevel,
        targetDate: profile.targetDate?.toISOString() ?? null,
        hoursPerWeek: profile.hoursPerWeek,
        preferredLanguage: profile.preferredLanguage,
        preferredTopics: profile.preferredTopics,
        notes: profile.notes,
        updatedAt: profile.updatedAt.toISOString(),
    };
}

export async function handleUpdateUserProfile(userId: string, args: z.infer<typeof updateUserProfileArgs>) {
    const data: Record<string, unknown> = {};
    if (args.targetCompany !== undefined) data.targetCompany = args.targetCompany;
    if (args.targetRole !== undefined) data.targetRole = args.targetRole;
    if (args.targetLevel !== undefined) data.targetLevel = args.targetLevel;
    if (args.targetDate !== undefined) data.targetDate = args.targetDate ? new Date(args.targetDate) : null;
    if (args.hoursPerWeek !== undefined) data.hoursPerWeek = args.hoursPerWeek;
    if (args.preferredLanguage !== undefined) data.preferredLanguage = args.preferredLanguage;
    if (args.preferredTopics !== undefined) data.preferredTopics = args.preferredTopics;
    if (args.notes !== undefined) data.notes = args.notes;

    const profile = await prisma.userTutorProfile.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
    });

    return {
        ok: true,
        targetCompany: profile.targetCompany,
        targetRole: profile.targetRole,
        targetLevel: profile.targetLevel,
        targetDate: profile.targetDate?.toISOString() ?? null,
        hoursPerWeek: profile.hoursPerWeek,
        preferredLanguage: profile.preferredLanguage,
        preferredTopics: profile.preferredTopics,
        notes: profile.notes,
        updatedAt: profile.updatedAt.toISOString(),
    };
}

export async function handleGetTutorMemories(userId: string, args: z.infer<typeof getTutorMemoriesArgs>) {
    const where: any = { userId };
    if (args.kind) {
        where.kind = args.kind.toUpperCase() as TutorMemoryKind;
    }
    where.OR = [{ expiresAt: null }, { expiresAt: { gt: new Date() } }];

    const rows = await prisma.tutorMemory.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: args.limit,
    });

    return {
        count: rows.length,
        memories: rows.map((m) => ({
            id: m.id,
            kind: m.kind.toLowerCase(),
            key: m.key,
            value: m.value,
            source: m.source,
            updatedAt: m.updatedAt.toISOString(),
            expiresAt: m.expiresAt?.toISOString() ?? null,
        })),
    };
}

export async function handleRecallRelevantMemories(
    userId: string,
    args: z.infer<typeof recallRelevantMemoriesArgs>
) {
    // Tokenize and search both key and value (case-insensitive). For long-tail
    // matching this is intentionally simple — Postgres tsvector would be a
    // future upgrade if memories grow large.
    const tokens = args.query
        .toLowerCase()
        .split(/\s+/)
        .map((t) => t.replace(/[^a-z0-9_]/g, ""))
        .filter((t) => t.length >= 2)
        .slice(0, 6);
    if (tokens.length === 0) {
        return { count: 0, memories: [], note: "Query too short to search." };
    }

    const baseWhere: any = {
        userId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    };
    if (args.kind) baseWhere.kind = args.kind.toUpperCase() as TutorMemoryKind;

    // Match if ANY token appears in key or value.
    const tokenFilters = tokens.flatMap((t) => [
        { key: { contains: t, mode: "insensitive" as const } },
        { value: { contains: t, mode: "insensitive" as const } },
    ]);

    const rows = await prisma.tutorMemory.findMany({
        where: { ...baseWhere, AND: [{ OR: tokenFilters }] },
        orderBy: { updatedAt: "desc" },
        take: args.limit,
    });

    return {
        query: args.query,
        count: rows.length,
        memories: rows.map((m) => ({
            id: m.id,
            kind: m.kind.toLowerCase(),
            key: m.key,
            value: m.value,
            source: m.source,
            updatedAt: m.updatedAt.toISOString(),
        })),
    };
}

export async function handleSaveMemory(userId: string, args: z.infer<typeof saveMemoryArgs>) {
    const kind = args.kind.toUpperCase() as TutorMemoryKind;
    const expiresAt = args.expiresInDays
        ? new Date(Date.now() + args.expiresInDays * 24 * 60 * 60 * 1000)
        : null;

    const saved = await prisma.tutorMemory.upsert({
        where: { userId_kind_key: { userId, kind, key: args.key } },
        create: {
            userId,
            kind,
            key: args.key,
            value: args.value,
            source: args.source,
            expiresAt,
        },
        update: {
            value: args.value,
            source: args.source,
            expiresAt,
        },
    });

    return {
        ok: true,
        id: saved.id,
        kind: saved.kind.toLowerCase(),
        key: saved.key,
        value: saved.value,
        updatedAt: saved.updatedAt.toISOString(),
    };
}
