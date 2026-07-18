/**
 * Artifact handlers.
 *
 * Artifacts are persistent things the agent produces for the user —
 * question sheets, action plans, quizzes, study notes. They live in the
 * tutor_artifacts table and are referenced by id from the chat.
 *
 * Skill tools (create_*) write artifacts; these handlers let the agent
 * read what's been produced previously and supersede stale outputs.
 */

import { TutorArtifactStatus, TutorArtifactType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../../../lib/prisma.js";

const MAX_ARTIFACTS_RETURNED = 25;

// ── Schemas ─────────────────────────────────────────────────────

export const listArtifactsArgs = z
    .object({
        type: z.enum(["question_sheet", "action_plan", "quiz", "study_note"]).optional(),
        status: z.enum(["active", "archived", "superseded", "all"]).optional().default("active"),
        limit: z.coerce.number().int().min(1).max(MAX_ARTIFACTS_RETURNED).optional().default(10),
    })
    .strict();

export const getArtifactArgs = z
    .object({
        artifactId: z.string().trim().min(1).max(64),
    })
    .strict();

export const archiveArtifactArgs = z
    .object({
        artifactId: z.string().trim().min(1).max(64),
    })
    .strict();

// ── Handlers ────────────────────────────────────────────────────

export async function handleListArtifacts(userId: string, args: z.infer<typeof listArtifactsArgs>) {
    const where: any = { userId };
    if (args.type) where.artifactType = args.type.toUpperCase() as TutorArtifactType;
    if (args.status !== "all") {
        where.status =
            args.status === "active"
                ? TutorArtifactStatus.ACTIVE
                : args.status === "archived"
                    ? TutorArtifactStatus.ARCHIVED
                    : TutorArtifactStatus.SUPERSEDED;
    }

    const rows = await prisma.tutorArtifact.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: args.limit,
        select: {
            id: true,
            artifactType: true,
            title: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            meta: true,
        },
    });

    return {
        count: rows.length,
        artifacts: rows.map((a) => ({
            id: a.id,
            type: a.artifactType.toLowerCase(),
            title: a.title,
            status: a.status.toLowerCase(),
            createdAt: a.createdAt.toISOString(),
            updatedAt: a.updatedAt.toISOString(),
            meta: a.meta ?? null,
        })),
    };
}

export async function handleGetArtifact(userId: string, args: z.infer<typeof getArtifactArgs>) {
    const artifact = await prisma.tutorArtifact.findFirst({
        where: { id: args.artifactId, userId },
    });
    if (!artifact) {
        throw Object.assign(new Error("artifact_not_found"), { code: "NOT_FOUND" });
    }
    return {
        id: artifact.id,
        type: artifact.artifactType.toLowerCase(),
        title: artifact.title,
        status: artifact.status.toLowerCase(),
        content: artifact.content,
        meta: artifact.meta ?? null,
        parentId: artifact.parentId,
        createdAt: artifact.createdAt.toISOString(),
        updatedAt: artifact.updatedAt.toISOString(),
    };
}

export async function handleArchiveArtifact(userId: string, args: z.infer<typeof archiveArtifactArgs>) {
    const existing = await prisma.tutorArtifact.findFirst({
        where: { id: args.artifactId, userId },
        select: { id: true, status: true, title: true },
    });
    if (!existing) {
        throw Object.assign(new Error("artifact_not_found"), { code: "NOT_FOUND" });
    }
    if (existing.status === TutorArtifactStatus.ARCHIVED) {
        return { ok: true, id: existing.id, status: "archived", note: "Already archived." };
    }

    const updated = await prisma.tutorArtifact.update({
        where: { id: existing.id },
        data: { status: TutorArtifactStatus.ARCHIVED },
        select: { id: true, status: true, title: true },
    });

    return {
        ok: true,
        id: updated.id,
        title: updated.title,
        status: updated.status.toLowerCase(),
    };
}
