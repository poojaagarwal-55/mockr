import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { generateReport } from "../services/report-generator.js";
import { DSAQuestion, buildDSAAvailableForPracticeFilter } from "../models/DSAQuestion.js";
import { SQLQuestion } from "../models/SQLQuestion.js";
import { CSFundamentalQuestion } from "../models/CSFundamentalQuestion.js";
import { SystemDesignQuestion } from "../models/system-design-question.js";
import { PMCaseQuestion } from "../models/PMCaseQuestion.js";
import { PMStrategyQuestion } from "../models/PMStrategyQuestion.js";
import { checkRateLimit } from "../lib/rate-limiter.js";
import { uploadToR2, deleteFromR2, uploadToR2Avatar, deleteFromR2Avatar } from "../lib/r2.js";
import { buildModuleConfigSummary } from "./tutor/module-context.js";

// Process-local de-dupe so repeated client retries don't trigger duplicate
// expensive generation jobs for the same session.
const inFlightReportGenerations = new Set<string>();
const lastReportGenerationAttemptAt = new Map<string, number>();
const REPORT_RETRY_COOLDOWN_MS = 2 * 60 * 1000;
const REPORT_RETRY_ENTRY_TTL_MS = 6 * 60 * 60 * 1000;
const REPORT_RETRY_MAX_ENTRIES = 5000;

function pruneRetryBookkeeping(now = Date.now()): void {
    for (const [sessionId, ts] of lastReportGenerationAttemptAt.entries()) {
        if (now - ts > REPORT_RETRY_ENTRY_TTL_MS) {
            lastReportGenerationAttemptAt.delete(sessionId);
        }
    }

    // Bound memory growth even under sustained traffic.
    while (lastReportGenerationAttemptAt.size > REPORT_RETRY_MAX_ENTRIES) {
        const oldestKey = lastReportGenerationAttemptAt.keys().next().value as string | undefined;
        if (!oldestKey) break;
        lastReportGenerationAttemptAt.delete(oldestKey);
    }
}

const updateProfileSchema = z.object({
    fullName: z.string().min(1).optional(),
    username: z.string().optional().nullable(),
    mobile: z.string().optional().nullable(),
    country: z.string().optional().nullable(),
    avatarUrl: z.string().url().optional().nullable(),
    onboardingCompleted: z.boolean().optional(),
    onboardingField: z.string().optional().nullable(),
    onboardingPosition: z.string().optional().nullable(),
    onboardingCompany: z.string().optional().nullable(),
    onboardingTrack: z.string().optional().nullable(),
    onboardingTimeline: z.string().optional().nullable(),
    // Extended profile fields
    gender: z.enum(["male", "female", "non_binary", "prefer_not_to_say"]).optional().nullable(),
    birthday: z.string().optional().nullable(), // ISO date string, stored as DateTime
    location: z.string().max(200).optional().nullable(),
    website: z.string().url().max(500).optional().nullable(),
    githubUrl: z.string().url().max(500).optional().nullable(),
    linkedinUrl: z.string().url().max(500).optional().nullable(),
    twitterUrl: z.string().url().max(500).optional().nullable(),
    readmeUrl: z.string().url().max(500).optional().nullable(),
    skills: z.array(z.string().max(50)).max(50).optional(),
    workExperience: z.array(z.object({
        id: z.string(),
        company: z.string().max(200),
        title: z.string().max(200),
        startDate: z.string(), // "YYYY-MM"
        endDate: z.string().optional().nullable(), // null = present
        description: z.string().max(2000).optional().nullable(),
    })).optional().nullable(),
    education: z.array(z.object({
        id: z.string(),
        institution: z.string().max(200),
        degree: z.string().max(200),
        field: z.string().max(200).optional().nullable(),
        startDate: z.string(), // "YYYY-MM"
        endDate: z.string().optional().nullable(),
    })).optional().nullable(),
});

const renameSheetSchema = z.object({
    label: z.string().trim().min(1).max(100),
});

export type SheetQuestion = {
    id: string;
    question: string;
    whatWeAreLookingFor: string;
    category: string;
    difficulty: string;
    problemSlug?: string;
};

function toProblemSlug(value: any, fallback?: string): string | undefined {
    const base = String(value || fallback || "").trim().toLowerCase();
    if (!base) return undefined;
    const slug = base
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 120);
    return slug || undefined;
}

function toWeakAreaLabel(value: any): string {
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    if (value && typeof value === "object") {
        return (
            value.area ||
            value.title ||
            value.category ||
            value.name ||
            value.desc ||
            value.step ||
            "general improvement"
        );
    }
    return "general improvement";
}

function inferDifficultyFromLevel(level?: string): "Easy" | "Medium" | "Hard" {
    const lvl = String(level || "").toLowerCase();
    if (lvl.includes("staff") || lvl.includes("senior")) return "Hard";
    if (lvl.includes("sde2") || lvl.includes("mid")) return "Medium";
    return "Easy";
}

function toSearchTerms(weakAreas: string[]): string[] {
    return Array.from(
        new Set(
            weakAreas
                .flatMap((x) => x.toLowerCase().split(/[^a-z0-9]+/g))
                .filter((x) => x.length >= 3)
        )
    ).slice(0, 12);
}

/**
 * Map a canonical session type string to an internal category.
 * Any unrecognised type gracefully falls to its closest category.
 */
function resolveInterviewCategory(
    sessionType: string
): "coding" | "sql" | "system_design" | "cs_fundamentals" | "behavioural" | "full_interview" {
    const t = sessionType.toLowerCase().replace(/[^a-z_]/g, "");
    if (t === "system_design") return "system_design";
    if (t === "cs_fundamentals" || t === "csfundamentals") return "cs_fundamentals";
    if (t === "sql") return "sql";
    if (t === "behavioural" || t === "behavioral" || t === "behaviour" || t === "behavior") return "behavioural";
    if (t === "full_interview" || t === "fullinterview") return "full_interview";
    // coding / dsa / technical / default
    return "coding";
}

const STUDENT_COMPETENCY_GROUPS: Array<{ id: string; legacyIds: string[] }> = [
    { id: "ownership_initiative", legacyIds: ["ownership_initiative", "conviction_under_uncertainty"] },
    { id: "structured_thinking", legacyIds: ["structured_thinking", "structured_debugging", "first_principles", "optimization_instinct"] },
    { id: "clarifying_before_acting", legacyIds: ["clarifying_before_acting", "spec_questioning"] },
    { id: "adaptability", legacyIds: ["adaptability"] },
    { id: "depth_of_experience", legacyIds: ["depth_of_experience", "resume_depth"] },
    { id: "coachability", legacyIds: ["coachability", "hint_absorption"] },
];

function normalizeStudentCompetencies(raw: unknown): Array<{ id: string; score: number }> {
    const rows = Array.isArray(raw) ? raw as Array<{ id?: unknown; score?: unknown; strength?: unknown }> : [];
    return STUDENT_COMPETENCY_GROUPS.map((group) => {
        const matches = rows.filter((item) => group.legacyIds.includes(String(item?.id || "")));
        const observed = matches.filter((item) => String(item?.strength || "") !== "not_observed");
        const scoreRows = observed.length > 0 ? observed : matches;
        const avg = scoreRows.length > 0
            ? scoreRows.reduce((sum, item) => sum + (Number(item?.score) || 0), 0) / scoreRows.length
            : 0;
        return { id: group.id, score: Math.round(avg) };
    });
}

/** Build behavioural STAR-format prompts directly from the user's weak area labels. */
function buildBehaviouralQuestions(weakAreas: string[], limit: number): SheetQuestion[] {
    if (weakAreas.length === 0) {
        return [{
            id: "beh-1",
            question: "Tell me about a time you handled a difficult situation at work. Walk me through your actions and the outcome.",
            whatWeAreLookingFor: "STAR structure, clear ownership and decision-making, quantifiable outcome.",
            category: "behavioural",
            difficulty: "medium",
        }];
    }
    return weakAreas.slice(0, limit).map((area, idx) => ({
        id: `beh-${idx + 1}`,
        question: `Describe a specific situation where you demonstrated ${area}. What was the context, what actions did you take, and what was the measurable outcome?`,
        whatWeAreLookingFor: `STAR format response focusing on ${area}: concrete situation, individual action ownership, and a clear, measurable result.`,
        category: area.toLowerCase().replace(/\s+/g, "_"),
        difficulty: "medium",
    }));
}

export async function buildDbBackedSheetQuestions(params: {
    sessionType: string;
    weakAreas: string[];
    level: string;
    limit: number;
}): Promise<SheetQuestion[]> {
    const { sessionType, weakAreas, level, limit } = params;
    const category = resolveInterviewCategory(sessionType);
    const terms = toSearchTerms(weakAreas);
    const regex = terms.length > 0 ? new RegExp(terms.join("|"), "i") : null;
    const preferredDifficulty = inferDifficultyFromLevel(level);

    // ── System Design ─────────────────────────────────────────────────────────
    if (category === "system_design") {
        // Weak areas for system design are architectural concepts — try to match them.
        const sdFilter: any = regex
            ? {
                  $or: [
                      { title: { $regex: regex } },
                      { problemStatement: { $regex: regex } },
                  ],
              }
            : {};

        let docs = await SystemDesignQuestion.aggregate([{ $match: sdFilter }, { $sample: { size: limit * 2 } }]);

        // If regex found nothing, fall back to difficulty-matched or any SD question.
        if (!docs || docs.length === 0) {
            docs = await SystemDesignQuestion.aggregate([{ $match: { difficulty: preferredDifficulty } }, { $sample: { size: limit * 2 } }]);
        }
        if (!docs || docs.length === 0) {
            docs = await SystemDesignQuestion.aggregate([{ $sample: { size: limit * 2 } }]);
        }

        return (docs || []).slice(0, limit).map((d: any, idx: number) => ({
            id: `sd-${d._id?.toString() || idx}`,
            question: String(d.problemStatement || d.title || "Design a scalable system for this use case."),
            whatWeAreLookingFor: "Requirements clarity, architecture trade-offs, scaling, reliability, and observability.",
            category: "system_design",
            difficulty: String(d.difficulty || "Medium").toLowerCase(),
            problemSlug: toProblemSlug(d.slug, d.title || d.problemStatement),
        }));
    }

    // ── CS Fundamentals ───────────────────────────────────────────────────────
    if (category === "cs_fundamentals") {
        // Map weak area keywords → known enum topics
        const topicFromWeakArea = new Set<string>();
        for (const area of weakAreas.map((x) => x.toLowerCase())) {
            if (/db|database|sql|rdbms/.test(area)) topicFromWeakArea.add("DBMS");
            if (/operating|\bos\b|process|thread|memory|kernel/.test(area)) topicFromWeakArea.add("OS");
            if (/network|\bcn\b|tcp|http|dns|socket|protocol/.test(area)) topicFromWeakArea.add("CN");
            if (/oop|oops|object|inherit|polymorphi|encapsul|abstract/.test(area)) topicFromWeakArea.add("OOPS");
        }

        // Use all 4 topics when weak-area mapping doesn't match any specific topic
        const targetTopics = topicFromWeakArea.size > 0
            ? Array.from(topicFromWeakArea)
            : ["OS", "OOPS", "CN", "DBMS"];

        const perTopic = Math.ceil(limit / targetTopics.length);

        // Fetch random questions from each topic using $sample for diversity
        const topicBatches = await Promise.all(
            targetTopics.map((topic) =>
                CSFundamentalQuestion.aggregate([
                    { $match: { topic } },
                    { $sample: { size: perTopic } },
                ])
            )
        );

        // Round-robin interleave so all topics are evenly represented
        const docs: any[] = [];
        let hasMore = true;
        let round = 0;
        while (hasMore && docs.length < limit) {
            hasMore = false;
            for (const batch of topicBatches) {
                if (round < batch.length && docs.length < limit) {
                    docs.push(batch[round]);
                    hasMore = true;
                }
            }
            round++;
        }

        // Fallback: if $sample returned nothing (empty collection), try plain find
        if (docs.length === 0) {
            const fallback = await CSFundamentalQuestion.aggregate([{ $sample: { size: limit } }]);
            docs.push(...(fallback || []));
        }

        return docs.slice(0, limit).map((d: any, idx: number) => ({
            id: `cs-${d._id?.toString() || idx}`,
            question: String(d.question || "Explain this CS concept with a real example."),
            whatWeAreLookingFor: "Clear core concept understanding, practical example, and trade-off awareness.",
            category: String(d.topic || "cs_fundamentals").toLowerCase(),
            difficulty: "medium",
            problemSlug: toProblemSlug(d.slug, d.question),
        }));
    }


    // ── SQL ───────────────────────────────────────────────────────────────────
    if (category === "sql") {
        const sqlFilter = regex
            ? { $or: [{ title: { $regex: regex } }, { description: { $regex: regex } }] }
            : {};
        let docs = await SQLQuestion.aggregate([{ $match: sqlFilter }, { $sample: { size: limit * 2 } }]);
        if (!docs || docs.length === 0) {
            docs = await SQLQuestion.aggregate([{ $sample: { size: limit * 2 } }]);
        }
        return (docs || []).slice(0, limit).map((d: any, idx: number) => ({
            id: `sql-${d._id?.toString() || idx}`,
            question: `${String(d.title || "SQL Question")}: ${String(d.description || "").slice(0, 260)}${String(d.description || "").length > 260 ? "..." : ""}`,
            whatWeAreLookingFor: "Correct SQL logic, edge-case handling, and query efficiency.",
            category: "sql",
            difficulty: "medium",
            problemSlug: toProblemSlug(d.slug, d.title),
        }));
    }

    // ── Behavioural ───────────────────────────────────────────────────────────
    // No dedicated DB collection — generate targeted STAR-format prompts from weak areas.
    if (category === "behavioural") {
        return buildBehaviouralQuestions(weakAreas, limit);
    }

    // ── Coding (default) & Full Interview ─────────────────────────────────────
    // Fetch DSA questions first, filtered by weak-area terms for relevance.
    const dsaFilter: any = {
        ...buildDSAAvailableForPracticeFilter(),
        difficulty: preferredDifficulty,
    };
    if (regex) {
        dsaFilter.$or = [
            { title: { $regex: regex } },
            { description: { $regex: regex } },
            { topics: { $elemMatch: { $regex: regex } } },
        ];
    }

    let dsaDocs = await DSAQuestion.aggregate([{ $match: dsaFilter }, { $sample: { size: limit * 2 } }]);

    // If difficulty-constrained regex found nothing, retry without difficulty filter
    if ((!dsaDocs || dsaDocs.length === 0) && regex) {
        dsaDocs = await DSAQuestion.aggregate([
            {
                $match: {
                    $or: [
                        { title: { $regex: regex } },
                        { description: { $regex: regex } },
                        { topics: { $elemMatch: { $regex: regex } } },
                    ],
                    ...buildDSAAvailableForPracticeFilter(),
                }
            },
            { $sample: { size: limit * 2 } }
        ]);
    }

    // If still nothing, get any DSA questions at the right difficulty
    if (!dsaDocs || dsaDocs.length === 0) {
        dsaDocs = await DSAQuestion.aggregate([
            {
                $match: {
                    ...buildDSAAvailableForPracticeFilter(),
                    difficulty: preferredDifficulty,
                },
            },
            { $sample: { size: limit * 2 } },
        ]);
    }

    const fromDsa = (dsaDocs || []).slice(0, limit).map((d: any, idx: number) => ({
        id: `dsa-${d._id?.toString() || idx}`,
        question: `${String(d.title || "Coding Problem")}: ${String(d.description || "").slice(0, 260)}${String(d.description || "").length > 260 ? "..." : ""}`,
        whatWeAreLookingFor: "Correct approach, time/space complexity analysis, and clear explanation of trade-offs.",
        category: "coding",
        difficulty: String(d.difficulty || "Medium").toLowerCase(),
        problemSlug: toProblemSlug(d.slug, d.title),
    }));

    // For full_interview: mix DB-backed coding + CS fundamentals questions.
    if (category === "full_interview") {
        const csSlots = Math.max(2, Math.floor(limit / 3));
        const codingSlots = Math.max(0, limit - csSlots);

        const topicFromWeakArea = new Set<string>();
        for (const area of weakAreas.map((x) => x.toLowerCase())) {
            if (/db|database|sql|rdbms/.test(area)) topicFromWeakArea.add("DBMS");
            if (/operating|\bos\b|process|thread|memory|kernel/.test(area)) topicFromWeakArea.add("OS");
            if (/network|\bcn\b|tcp|http|dns|socket|protocol/.test(area)) topicFromWeakArea.add("CN");
            if (/oop|oops|object|inherit|polymorphi|encapsul|abstract/.test(area)) topicFromWeakArea.add("OOPS");
        }

        const targetTopics = topicFromWeakArea.size > 0
            ? Array.from(topicFromWeakArea)
            : ["OS", "OOPS", "CN", "DBMS"];
        const perTopic = Math.max(1, Math.ceil(csSlots / targetTopics.length));

        const topicBatches = await Promise.all(
            targetTopics.map((topic) =>
                CSFundamentalQuestion.aggregate([
                    { $match: { topic } },
                    { $sample: { size: perTopic } },
                ])
            )
        );

        const csDocs: any[] = [];
        let hasMore = true;
        let round = 0;
        while (hasMore && csDocs.length < csSlots) {
            hasMore = false;
            for (const batch of topicBatches) {
                if (round < batch.length && csDocs.length < csSlots) {
                    csDocs.push(batch[round]);
                    hasMore = true;
                }
            }
            round++;
        }

        if (csDocs.length < csSlots) {
            const moreCs = await CSFundamentalQuestion.aggregate([{ $sample: { size: csSlots * 2 } }]);
            const existingIds = new Set(csDocs.map((d) => String(d._id)));
            for (const doc of moreCs || []) {
                const id = String(doc?._id || "");
                if (!id || existingIds.has(id)) continue;
                csDocs.push(doc);
                existingIds.add(id);
                if (csDocs.length >= csSlots) break;
            }
        }

        const fromCs = csDocs.slice(0, csSlots).map((d: any, idx: number) => ({
            id: `cs-${d._id?.toString() || idx}`,
            question: String(d.question || "Explain this CS concept with a real example."),
            whatWeAreLookingFor: "Clear core concept understanding, practical example, and trade-off awareness.",
            category: String(d.topic || "cs_fundamentals").toLowerCase(),
            difficulty: "medium",
            problemSlug: toProblemSlug(d.slug, d.question),
        }));

        let mixed = [...fromDsa.slice(0, codingSlots), ...fromCs].slice(0, limit);

        if (mixed.length < limit && fromDsa.length > codingSlots) {
            mixed = [...mixed, ...fromDsa.slice(codingSlots, limit)].slice(0, limit);
        }

        return mixed;
    }

    return fromDsa.slice(0, limit);
}

import { cacheGet, cacheDel } from "../lib/redis.js";

export default async function userRoutes(fastify: FastifyInstance) {
    // All routes in this module require authentication
    fastify.addHook("preHandler", fastify.authenticate);

    // ─── Get Profile ──────────────────────────────────────────
    fastify.get("/users/me", async (request, reply) => {
        try {
            const userId = request.user!.id;
            const cacheKey = `api:users:${userId}:profile`;

            console.log('[GET /users/me] Fetching user profile for:', userId);

            const user = await cacheGet(cacheKey, 3600, async () => {
                return prisma.user.findUnique({
                    where: { id: userId },
                    include: {
                        _count: {
                            select: {
                                sessions: true,
                                reports: true,
                                resumes: true,
                            },
                        },
                    },
                });
            });

            if (!user) {
                return reply.status(404).send({ error: "Not found" });
            }

            console.log('[GET /users/me] User found:', {
                id: user.id,
                email: user.email,
                mobile: user.mobile,
                mobileVerified: user.mobileVerified,
                mobileVerifiedAt: user.mobileVerifiedAt,
                mobileVerifiedType: typeof user.mobileVerified,
                mobileVerifiedValue: JSON.stringify(user.mobileVerified)
            });

            reply.cacheControl("NONE");
            const response = {
                id: user.id,
                email: user.email,
                username: user.username,
                mobile: user.mobile,
                mobileVerified: user.mobileVerified,
                mobileVerifiedAt: user.mobileVerifiedAt ? (typeof user.mobileVerifiedAt === 'string' ? user.mobileVerifiedAt : user.mobileVerifiedAt.toISOString()) : null,
                country: user.country,
                fullName: user.fullName,
                role: user.role,
                placementCollegeEmailDomain: user.placementCollegeEmailDomain,
                avatarUrl: user.avatarUrl,
                createdAt: user.createdAt,
                onboardingCompleted: user.onboardingCompleted,
                // Extended profile fields
                gender: user.gender,
                birthday: user.birthday?.toISOString().split("T")[0] ?? null,
                location: user.location,
                website: user.website,
                githubUrl: user.githubUrl,
                linkedinUrl: user.linkedinUrl,
                twitterUrl: user.twitterUrl,
                readmeUrl: user.readmeUrl,
                skills: user.skills,
                workExperience: user.workExperience,
                education: user.education,
                stats: {
                    totalSessions: user._count.sessions,
                    totalReports: user._count.reports,
                    totalResumes: user._count.resumes,
                },
            };

            console.log('[GET /users/me] Returning response with mobileVerified:', response.mobileVerified, 'type:', typeof response.mobileVerified);
            console.log('[GET /users/me] Full response:', JSON.stringify(response, null, 2));
            return response;
        } catch (err) {
            fastify.log.error(err, "GET /users/me failed");
            return reply.status(500).send({ message: "Failed to load profile. Please try again." });
        }
    });

    // ─── Update Profile (used by onboarding + settings) ─────
    fastify.patch("/users/me", async (request, reply) => {
        const parsed = updateProfileSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        try {
            const d = parsed.data;

            // Build a clean update payload with only known Prisma columns
            const updateData: Record<string, unknown> = {};
            if (d.fullName      !== undefined) updateData.fullName      = d.fullName;
            if (d.username      !== undefined) updateData.username      = d.username;
            if (d.mobile        !== undefined) updateData.mobile        = d.mobile;
            if (d.country       !== undefined) updateData.country       = d.country;
            if (d.avatarUrl     !== undefined) updateData.avatarUrl     = d.avatarUrl;
            if (d.onboardingCompleted !== undefined) updateData.onboardingCompleted = d.onboardingCompleted;
            if (d.onboardingField    !== undefined) updateData.onboardingField    = d.onboardingField;
            if (d.onboardingPosition !== undefined) updateData.onboardingPosition = d.onboardingPosition;
            if (d.onboardingCompany  !== undefined) updateData.onboardingCompany  = d.onboardingCompany;
            if (d.onboardingTrack    !== undefined) updateData.onboardingTrack    = d.onboardingTrack;
            if (d.onboardingTimeline !== undefined) updateData.onboardingTimeline = d.onboardingTimeline;
            // Extended profile fields
            if (d.gender        !== undefined) updateData.gender        = d.gender;
            if (d.location      !== undefined) updateData.location      = d.location;
            if (d.website       !== undefined) updateData.website       = d.website;
            if (d.githubUrl     !== undefined) updateData.githubUrl     = d.githubUrl;
            if (d.linkedinUrl   !== undefined) updateData.linkedinUrl   = d.linkedinUrl;
            if (d.twitterUrl    !== undefined) updateData.twitterUrl    = d.twitterUrl;
            if (d.readmeUrl     !== undefined) updateData.readmeUrl     = d.readmeUrl;
            if (d.skills        !== undefined) updateData.skills        = d.skills;
            if (d.workExperience !== undefined) updateData.workExperience = d.workExperience ?? null;
            if (d.education     !== undefined) updateData.education     = d.education ?? null;
            // birthday: convert ISO string → DateTime
            if (d.birthday !== undefined) {
                updateData.birthday = d.birthday ? new Date(d.birthday) : null;
            }

            const user = await prisma.user.update({
                where: { id: request.user!.id },
                data: updateData,
            });

            await cacheDel([`api:users:${user.id}:profile`]);

            return {
                id: user.id,
                email: user.email,
                fullName: user.fullName,
                username: user.username,
                mobile: user.mobile,
                country: user.country,
                avatarUrl: user.avatarUrl,
                onboardingCompleted: user.onboardingCompleted,
                gender: user.gender,
                birthday: user.birthday?.toISOString().split("T")[0] ?? null,
                location: user.location,
                website: user.website,
                githubUrl: user.githubUrl,
                linkedinUrl: user.linkedinUrl,
                twitterUrl: user.twitterUrl,
                readmeUrl: user.readmeUrl,
                skills: user.skills,
                workExperience: user.workExperience,
                education: user.education,
            };
        } catch (err) {
            fastify.log.error(err, "PATCH /users/me failed");
            return reply.status(500).send({ message: "Failed to update profile. Please try again." });
        }
    });

    // ─── Send Phone Verification OTP ──────────────────────────
    fastify.post("/users/me/phone/send-otp", async (request, reply) => {
        const userId = request.user!.id;
        const { mobile } = request.body as { mobile: string };

        if (!mobile || !/^\+?[1-9]\d{1,14}$/.test(mobile)) {
            return reply.status(400).send({ error: "Invalid phone number format" });
        }

        const rl = checkRateLimit(`phone-otp:${userId}`, 3, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ 
                message: `Too many OTP requests. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.` 
            });
        }

        try {
            const { sendOTPViaMSG91 } = await import("../services/msg91.js");
            const result = await sendOTPViaMSG91(mobile);
            
            if (!result.success) {
                return reply.status(500).send({ error: result.message });
            }

            return { success: true, message: "OTP sent successfully" };
        } catch (err) {
            fastify.log.error(err, "Failed to send OTP");
            return reply.status(500).send({ error: "Failed to send OTP" });
        }
    });

    // ─── Verify Phone OTP ─────────────────────────────────────
    fastify.post("/users/me/phone/verify-otp", async (request, reply) => {
        const userId = request.user!.id;
        const { mobile, otp } = request.body as { mobile: string; otp: string };

        if (!mobile || !otp) {
            return reply.status(400).send({ error: "Mobile and OTP are required" });
        }

        try {
            const { verifyOTPViaMSG91 } = await import("../services/msg91.js");
            const result = await verifyOTPViaMSG91(mobile, otp);
            
            if (!result.success) {
                return reply.status(400).send({ error: result.message });
            }

            // Update user's mobile and verification status
            const user = await prisma.user.update({
                where: { id: userId },
                data: {
                    mobile,
                    mobileVerified: true,
                    mobileVerifiedAt: new Date(),
                },
            });

            await cacheDel([`api:users:${userId}:profile`]);

            return { 
                success: true, 
                message: "Phone verified successfully",
                mobile: user.mobile,
                mobileVerified: user.mobileVerified,
            };
        } catch (err) {
            fastify.log.error(err, "Failed to verify OTP");
            return reply.status(500).send({ error: "Failed to verify OTP" });
        }
    });

    // ─── Change Phone Number ──────────────────────────────────
    fastify.post("/users/me/phone/change", async (request, reply) => {
        const userId = request.user!.id;
        const { newMobile, otp } = request.body as { newMobile: string; otp: string };

        if (!newMobile || !otp) {
            return reply.status(400).send({ error: "New mobile and OTP are required" });
        }

        if (!/^\+?[1-9]\d{1,14}$/.test(newMobile)) {
            return reply.status(400).send({ error: "Invalid phone number format" });
        }

        const rl = checkRateLimit(`phone-change:${userId}`, 3, 3600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ 
                message: `Too many phone change attempts. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.` 
            });
        }

        try {
            const { verifyOTPViaMSG91 } = await import("../services/msg91.js");
            const result = await verifyOTPViaMSG91(newMobile, otp);
            
            if (!result.success) {
                return reply.status(400).send({ error: result.message });
            }

            // Check if this phone number is already used by another user
            const existingUser = await prisma.user.findFirst({
                where: {
                    mobile: newMobile,
                    id: { not: userId },
                },
            });

            if (existingUser) {
                return reply.status(409).send({ 
                    error: "This phone number is already registered with another account" 
                });
            }

            // Update user's mobile number
            const user = await prisma.user.update({
                where: { id: userId },
                data: {
                    mobile: newMobile,
                    mobileVerified: true,
                    mobileVerifiedAt: new Date(),
                },
            });

            await cacheDel([`api:users:${userId}:profile`]);

            return { 
                success: true, 
                message: "Phone number changed successfully",
                mobile: user.mobile,
            };
        } catch (err) {
            fastify.log.error(err, "Failed to change phone number");
            return reply.status(500).send({ error: "Failed to change phone number" });
        }
    });

    // ─── Upload Avatar ────────────────────────────────────────
    fastify.post("/users/me/avatar", async (request, reply) => {
        const userId = request.user!.id;

        const rl = checkRateLimit(`avatar-upload:${userId}`, 10, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ message: `Rate limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.` });
        }

        const data = await request.file();
        if (!data) {
            return reply.status(400).send({ message: "No file uploaded." });
        }

        const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
        if (!allowedTypes.includes(data.mimetype)) {
            return reply.status(400).send({ message: "Only JPEG, PNG, WebP, or GIF images are allowed." });
        }

        const MAX_SIZE = 2 * 1024 * 1024; // 2MB
        const chunks: Buffer[] = [];
        let totalSize = 0;

        for await (const chunk of data.file) {
            totalSize += chunk.length;
            if (totalSize > MAX_SIZE) {
                return reply.status(400).send({ message: "Image must be under 2MB." });
            }
            chunks.push(chunk);
        }

        const buffer = Buffer.concat(chunks);
        const ext = data.mimetype.split("/")[1].replace("jpeg", "jpg");
        const key = `avatars/${userId}.${ext}`;

        // Delete old avatar if it exists and is in our bucket
        const existingUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { avatarUrl: true },
        });
        if (existingUser?.avatarUrl) {
            const avatarPublicBase = (process.env.R2_AVATAR_PUBLIC_URL || "").replace(/\/$/, "");
            if (avatarPublicBase && existingUser.avatarUrl.startsWith(avatarPublicBase)) {
                const oldKey = existingUser.avatarUrl.replace(`${avatarPublicBase}/`, "");
                await deleteFromR2Avatar(oldKey).catch(() => {});
            }
        }

        // Upload to avatar bucket
        const avatarUrl = await uploadToR2Avatar(key, buffer, data.mimetype);

        const user = await prisma.user.update({
            where: { id: userId },
            data: { avatarUrl },
        });

        await cacheDel([`api:users:${userId}:profile`]);

        return { avatarUrl: user.avatarUrl };
    });

    // ─── Get User's Dashboard Stats ─────────────────────────
    fastify.get("/users/me/stats", async (request, reply) => {
        const userId = request.user!.id;
        const cacheKey = `api:users:${userId}:stats`;

        const statsData = await cacheGet(cacheKey, 3600, async () => {
            const [totalSessions, completedSessions, reports] = await Promise.all([
                prisma.interviewSession.count({ where: { userId } }),
                prisma.interviewSession.count({
                    where: { userId, status: "COMPLETED" },
                }),
                prisma.evaluationReport.findMany({
                    where: { userId },
                    orderBy: { generatedAt: "desc" },
                    take: 100,
                    select: {
                        id: true,
                        overallScore: true,
                        generatedAt: true,
                        rubricScores: true,
                        session: {
                            select: {
                                role: true,
                                level: true,
                                type: true,
                                id: true
                            }
                        }
                    },
                }),
            ]);

            const scores = reports.map((r) => Number(r.overallScore));
            const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
            const bestScore = scores.length > 0 ? Math.max(...scores) : 0;

            return {
                totalSessions,
                completedSessions,
                avgScore: Math.round(avgScore),
                bestScore: Math.round(bestScore),
                recentReports: reports,
            };
        });

        reply.cacheControl("NONE");
        return statsData;
    });


    // ─── List User Reports ───────────────────────────────────
    fastify.get("/users/me/reports", async (request, reply) => {
        const userId = request.user!.id;
        const query = request.query as { limit?: string; offset?: string };
        const parsedLimit = Number(query.limit);
        const parsedOffset = Number(query.offset);
        const limit = Number.isFinite(parsedLimit)
            ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 100)
            : 20;
        const offset = Number.isFinite(parsedOffset)
            ? Math.max(Math.trunc(parsedOffset), 0)
            : 0;

        const cacheKey = `api:users:${userId}:reports:v2:${limit}:${offset}`;

        const reportData = await cacheGet(cacheKey, 3600, async () => {
            const [reports, total] = await Promise.all([
                prisma.evaluationReport.findMany({
                    where: { userId },
                    orderBy: { generatedAt: "desc" },
                    take: limit,
                    skip: offset,
                    include: {
                        session: {
                            select: {
                                id: true,
                                role: true,
                                level: true,
                                type: true,
                                moduleConfig: true,
                                createdAt: true,
                            },
                        },
                    },
                }),
                prisma.evaluationReport.count({ where: { userId } }),
            ]);
            return { reports, total };
        });

        // Peer-to-peer reports are surfaced in their own dedicated tab
        // (/interviews/peer/reports via /p2p/me/reports) so they can link to the
        // peer report page instead of the AI report route. Keep this endpoint to
        // AI evaluation reports only.
        reply.cacheControl("NONE");
        return {
            reports: reportData.reports.map((r) => ({
                id: r.id,
                sessionId: r.sessionId,
                overallScore: Number(r.overallScore),
                generatedAt: r.generatedAt,
                session: r.session,
                moduleConfigSummary: buildModuleConfigSummary(r.session.type, r.session.moduleConfig),
            })),
            total: reportData.total,
            limit,
            offset,
        };
    });

    // ─── Activity Dates (for streak calendar) ───────────────
    fastify.get("/users/me/activity-dates", async (request, reply) => {
        const userId = request.user!.id;
        const { year } = request.query as { year?: string };
        const y = year ? parseInt(year, 10) : new Date().getFullYear();

        const cacheKey = `api:users:${userId}:activity:${y}`;
        
        const dates = await cacheGet(cacheKey, 21600, async () => {
            const start = new Date(y, 0, 1);
            const end = new Date(y + 1, 0, 1);

            const sessions = await prisma.interviewSession.findMany({
                where: {
                    userId,
                    status: "COMPLETED",
                    completedAt: { gte: start, lt: end },
                },
                select: { completedAt: true },
            });

            return [...new Set(
                sessions.map((s) => s.completedAt!.toISOString().split("T")[0])
            )];
        });

        reply.cacheControl("NONE");
        return { dates };
    });

    // ─── Get Report Details ──────────────────────────────────
    // Accepts either a report ID or a session ID for compatibility
    // with existing frontend routes that may still pass sessionId.
    fastify.get("/users/me/reports/:id", async (request, reply) => {
        pruneRetryBookkeeping();

        const userId = request.user!.id;
        const { id } = request.params as { id: string };

        const report = await prisma.evaluationReport.findFirst({
            where: {
                userId,
                OR: [{ id }, { sessionId: id }],
            },
        });

        if (!report) {
            const session = await prisma.interviewSession.findFirst({
                where: {
                    id,
                    userId,
                },
                select: {
                    id: true,
                    status: true,
                    completedAt: true,
                    startedAt: true,
                    createdAt: true,
                },
            });

            if (session) {
                // Keep this endpoint read-only. If the interview is completed but the
                // report is not yet available, trigger ONE background generation attempt.
                if (session.status === "COMPLETED" && !inFlightReportGenerations.has(session.id)) {
                    const now = Date.now();
                    const lastAttempt = lastReportGenerationAttemptAt.get(session.id) || 0;
                    if (now - lastAttempt < REPORT_RETRY_COOLDOWN_MS) {
                        return reply.status(202).send({
                            status: "PENDING",
                            message: "Report is being generated. Please retry in a bit.",
                            sessionId: session.id,
                        });
                    }

                    lastReportGenerationAttemptAt.set(session.id, now);
                    inFlightReportGenerations.add(session.id);

                    generateReport(session.id)
                        .then((result) => {
                            if (result.status === "generated" || result.status === "exists") {
                                lastReportGenerationAttemptAt.delete(session.id);
                            }
                            if (result.status === "failed") {
                                fastify.log.error(
                                    { sessionId: session.id, error: result.error },
                                    "Background report generation retry failed"
                                );
                            }
                        })
                        .catch((err) => {
                            fastify.log.error({ err, sessionId: session.id }, "Background report generation retry failed");
                        })
                        .finally(() => {
                            inFlightReportGenerations.delete(session.id);
                        });

                    return reply.status(202).send({
                        status: "PENDING",
                        message: "Report is being generated. Please retry in a few seconds.",
                        sessionId: session.id,
                    });
                }

                if (session.status !== "COMPLETED") {
                    // Guard against a race condition where the frontend requests the
                    // report immediately after ending the interview, before the DB
                    // write that marks the session COMPLETED has committed.
                    // If the session was started or created within the last 60 seconds,
                    // treat this as a transient state and ask the client to retry.
                    const SESSION_COMPLETION_GRACE_MS = 60_000;
                    const lastActivityAt = session.completedAt ?? session.startedAt ?? session.createdAt;
                    const msSinceUpdate = Date.now() - new Date(lastActivityAt).getTime();
                    if (msSinceUpdate < SESSION_COMPLETION_GRACE_MS) {
                        fastify.log.warn(
                            { sessionId: session.id, status: session.status, msSinceUpdate },
                            "Report requested for non-COMPLETED session within grace period — returning 202 PENDING"
                        );
                        return reply.status(202).send({
                            status: "PENDING",
                            message: "Interview is finishing up. Please retry in a few seconds.",
                            sessionId: session.id,
                        });
                    }

                    return reply.status(409).send({
                        status: "INTERVIEW_NOT_COMPLETED",
                        message: "Interview is still in progress. End the interview to generate a report.",
                        sessionId: session.id,
                    });
                }

                return reply.status(202).send({
                    status: "PENDING",
                    message: "Report is being generated. Please retry in a few seconds.",
                    sessionId: session.id,
                });
            }

            return reply.status(404).send({
                error: "Not Found",
                message: "Report not found",
            });
        }

        // Report now exists; drop retry bookkeeping for this session.
        lastReportGenerationAttemptAt.delete(report.sessionId);
        inFlightReportGenerations.delete(report.sessionId);

        const [session, sessionMessages] = await Promise.all([
            prisma.interviewSession.findFirst({
                where: { id: report.sessionId, userId },
                include: {
                    sessionQuestions: { orderBy: { askedAt: "asc" } },
                },
            }),
            prisma.sessionMessage.findMany({
                where: { sessionId: report.sessionId },
                orderBy: { createdAt: "asc" },
                select: { role: true, content: true, createdAt: true, stage: true },
            }),
        ]);

        if (!session) {
            return reply.status(404).send({
                error: "Not Found",
                message: "Interview session not found for this report",
            });
        }

        // ── Fetch full question text from MongoDB (for content-based matching) ──
        async function fetchQuestionText(
            sq: (typeof session.sessionQuestions)[number],
            sessionType: string
        ): Promise<string | null> {
            try {
                if (sq.questionFundamentalId) {
                    const doc = await CSFundamentalQuestion.findById(sq.questionFundamentalId).select("question").lean() as any;
                    return doc?.question ? String(doc.question) : null;
                }
                if (sq.questionSqlId) {
                    const doc = await SQLQuestion.findById(sq.questionSqlId).select("title description").lean() as any;
                    return doc ? [doc.title, doc.description].filter(Boolean).join(" ") : null;
                }
                if (sq.questionId) {
                    if (sessionType === "system_design") {
                        const doc = await SystemDesignQuestion.findById(sq.questionId).select("title problemStatement").lean() as any;
                        return doc ? [doc.title, doc.problemStatement].filter(Boolean).join(" ") : null;
                    }
                    const doc = await DSAQuestion.findById(sq.questionId).select("title description").lean() as any;
                    return doc ? [doc.title, doc.description].filter(Boolean).join(" ") : null;
                }
            } catch { /* non-fatal */ }
            return null;
        }

        // ── Fetch question title from MongoDB when not stored in Postgres ─────
        async function fetchQuestionTitle(
            sq: (typeof session.sessionQuestions)[number],
            sessionType: string
        ): Promise<string | null> {
            try {
                if (sq.questionId) {
                    if (sessionType === "system_design") {
                        const doc = await SystemDesignQuestion.findById(sq.questionId).select("title").lean() as any;
                        if (doc?.title) return String(doc.title);
                    } else {
                        const doc = await DSAQuestion.findById(sq.questionId).select("title").lean() as any;
                        if (doc?.title) return String(doc.title);
                    }
                }
                if (sq.questionSqlId) {
                    const doc = await SQLQuestion.findById(sq.questionSqlId).select("title").lean() as any;
                    if (doc?.title) return String(doc.title);
                }
                if (sq.questionFundamentalId) {
                    if (sq.questionCategory === "pm_case") {
                        const doc = await PMCaseQuestion.findById(sq.questionFundamentalId).select("scenario title").lean() as any;
                        if (doc?.scenario || doc?.title) return String(doc.scenario || doc.title);
                    }
                    if (sq.questionCategory === "pm_strategy") {
                        const doc = await PMStrategyQuestion.findById(sq.questionFundamentalId).select("scenario title").lean() as any;
                        if (doc?.scenario || doc?.title) return String(doc.scenario || doc.title);
                    }
                    const doc = await CSFundamentalQuestion.findById(sq.questionFundamentalId).select("question").lean() as any;
                    if (doc?.question) return String(doc.question);
                }
            } catch { /* non-fatal */ }
            return null;
        }

        // ── Fetch sample answers — Postgres first, MongoDB fallback ───────────
        async function fetchSampleAnswer(sq: (typeof session.sessionQuestions)[number], sessionType: string): Promise<string | null> {
            // ✅ PRIMARY: read the denormalized value stored at session init (zero MongoDB hops)
            if ((sq as any).sampleAnswer) return String((sq as any).sampleAnswer);

            // 🔄 FALLBACK: for sessions created before the sampleAnswer migration (rows have null)
            try {
                if (sq.questionId && sessionType === "system_design") {
                    const doc = await SystemDesignQuestion.findById(sq.questionId).select("rubricFull").lean() as any;
                    if (doc?.rubricFull?.sampleAnswer) return String(doc.rubricFull.sampleAnswer);
                }
                if (sq.questionId && !sq.questionSqlId && !sq.questionFundamentalId && sessionType !== "system_design") {
                    const doc = await DSAQuestion.findById(sq.questionId).select("solution").lean() as any;
                    if (doc?.solution?.optimized?.explanation) return String(doc.solution.optimized.explanation);
                    if (doc?.solution?.bruteForce?.explanation) return String(doc.solution.bruteForce.explanation);
                }
                if (sq.questionSqlId) {
                    const doc = await SQLQuestion.findById(sq.questionSqlId).select("solution").lean() as any;
                    if (doc?.solution) return typeof doc.solution === "string" ? doc.solution : JSON.stringify(doc.solution, null, 2);
                }
                if (sq.questionFundamentalId) {
                    const doc = await CSFundamentalQuestion.findById(sq.questionFundamentalId).select("answer").lean() as any;
                    if (doc?.answer) return String(doc.answer);
                }
            } catch { /* non-fatal */ }
            return null;
        }



        // ════════════════════════════════════════════════════════════════════════
        // REPORT QUESTION EXTRACTION
        // ════════════════════════════════════════════════════════════════════════
        // Every question that was actually presented to the candidate now has a
        // SessionQuestion row created at display time:
        //   - DSA:          handleOpenIDE creates the row when IDE opens
        //   - SQL:          handleFetchQuestion creates the row when SQL is fetched
        //   - System Design: prefetchSystemDesignQuestion creates the row at session init
        //   - CS Theory:    handleRecordQuestion creates the row when AI calls record_question
        //
        // The report simply reads all SessionQuestion rows for this session.
        // No keyword matching, no conversation parsing, no false positives.
        // ════════════════════════════════════════════════════════════════════════

        const dedupedSessionQuestions = Array.from(
            session.sessionQuestions.reduce((map, sq) => {
                const key = sq.questionId || sq.questionSqlId || sq.questionFundamentalId || sq.id;
                const existing = map.get(key);
                if (!existing) {
                    map.set(key, sq);
                    return map;
                }

                // Prefer the row with more useful report data, which is usually the
                // later display-time row rather than the prefetch-time row.
                const existingScore = Number(Boolean((existing as any).questionTitle)) + Number(Boolean((existing as any).finalCode)) + Number(Boolean((existing as any).aiNotes));
                const currentScore = Number(Boolean((sq as any).questionTitle)) + Number(Boolean((sq as any).finalCode)) + Number(Boolean((sq as any).aiNotes));
                if (currentScore >= existingScore) {
                    map.set(key, sq);
                }
                return map;
            }, new Map<string, (typeof session.sessionQuestions)[number]>()).values()
        );

        const reportQuestions = await Promise.all(
            dedupedSessionQuestions.map(async (sq, idx) => {
                const storedTitle = sq.questionTitle?.trim();
                const resolvedTitle = (storedTitle && storedTitle.toLowerCase() !== "unknown question")
                    ? storedTitle
                    : await fetchQuestionTitle(sq, session.type) || `Question ${idx + 1}`;

                const inferredCategory =
                    sq.questionCategory ||
                    (sq.questionSqlId ? "sql"
                        : sq.questionFundamentalId
                            ? (session.type === "gen_ai_role" ? "genai_concepts" : "cs_fundamentals")
                            : session.type === "system_design" ? "system_design"
                            : "coding");

                const sampleAnswer = await fetchSampleAnswer(sq, session.type);

                // Fetch sampleDiagramUrl for system design questions
                let sampleDiagramUrl: string | null = null;
                if (sq.questionId && session.type === "system_design") {
                    try {
                        const sdDoc = await SystemDesignQuestion.findById(sq.questionId)
                            .select("sampleDiagramUrl")
                            .lean() as any;
                        sampleDiagramUrl = sdDoc?.sampleDiagramUrl || null;
                    } catch { /* non-fatal */ }
                }

                return {
                    id: sq.id,
                    questionId: sq.questionId || sq.questionSqlId || sq.questionFundamentalId,
                    title: resolvedTitle,
                    category: inferredCategory,
                    difficulty: sq.questionDifficulty || "unspecified",
                    finalCode: sq.finalCode,
                    score: sq.score ? Number(sq.score) : null,
                    aiNotes: sq.aiNotes,
                    timeSpent: sq.timeSpent,
                    askedAt: sq.askedAt,
                    userTranscript: (() => {
                        // Extract full conversation exchange between this question's askedAt and the next
                        const askedAt = sq.askedAt ? new Date(sq.askedAt).getTime() : null;
                        const nextSq = dedupedSessionQuestions[idx + 1];
                        const nextAskedAt = nextSq?.askedAt ? new Date(nextSq.askedAt).getTime() : null;
                        const exchange = sessionMessages
                            .filter((m) => {
                                if (m.role !== "user" && m.role !== "assistant") return false;
                                const t = new Date(m.createdAt).getTime();
                                if (askedAt && t < askedAt) return false;
                                if (nextAskedAt && t > nextAskedAt) return false;
                                return true;
                            })
                            .map((m) => ({
                                role: m.role === "assistant" ? "interviewer" : "candidate",
                                content: m.content.trim(),
                            }))
                            .filter((m) => m.content.length > 0);
                        // Return as JSON string so the frontend can parse and render each turn
                        return exchange.length > 0 ? JSON.stringify(exchange) : null;
                    })(),
                    sampleAnswer,
                    sampleDiagramUrl,
                };
            })
        );
        const displayQuestions = session.type === "behavioural" ? [] : reportQuestions;

        // If the report has denormalized questions (new flow), use those directly
        // and skip the session_questions reconstruction entirely
        const denormalizedQuestions = Array.isArray((report as any).questions) && (report as any).questions.length > 0
            ? ((report as any).questions as Array<{
                id: string;
                questionId: string | null;
                title: string;
                category: string;
                difficulty: string | null;
                finalCode: string | null;
                score: number | null;
                aiNotes: string | null;
                timeSpent: number | null;
                askedAt: string | null;
                sampleAnswer: string | null;
                sampleDiagramUrl?: string | null;
                conversationExchange: Array<{ role: string; content: string }> | null;
                userTranscript: string | null;
              }>).map((q) => ({
                ...q,
                // Prefer conversationExchange (full JSON with both roles) over
                // userTranscript (candidate-only plain text) for the frontend renderer
                userTranscript: q.conversationExchange && q.conversationExchange.length > 0
                    ? JSON.stringify(q.conversationExchange)
                    : q.userTranscript,
              }))
            : null;

        let finalQuestions = session.type === "behavioural"
            ? []
            : denormalizedQuestions ?? displayQuestions;

        // Hydrate PM case/strategy titles for older reports that stored generic
        // labels such as "Product Case Study" or "Product Strategy".
        if (session.type === "pm_role" && finalQuestions.length > 0) {
            await Promise.all(finalQuestions.map(async (q: any) => {
                if (q.category !== "pm_case" && q.category !== "pm_strategy") return;
                if (!q.questionId) return;
                try {
                    const doc = q.category === "pm_case"
                        ? await PMCaseQuestion.findById(q.questionId).select("scenario title").lean() as any
                        : await PMStrategyQuestion.findById(q.questionId).select("scenario title").lean() as any;
                    const scenario = doc?.scenario || doc?.title;
                    if (scenario) q.title = String(scenario);
                } catch { /* non-fatal */ }
            }));
        }

        // Backfill sampleDiagramUrl for system_design reports where it wasn't stored
        // (reports generated before this field was added to the report generator)
        if (session.type === "system_design" && finalQuestions.length > 0) {
            await Promise.all(finalQuestions.map(async (q: any) => {
                if (q.sampleDiagramUrl != null) return; // already present
                const qId = q.questionId;
                if (!qId) return;
                try {
                    const sdDoc = await SystemDesignQuestion.findById(qId)
                        .select("sampleDiagramUrl")
                        .lean() as any;
                    q.sampleDiagramUrl = sdDoc?.sampleDiagramUrl || null;
                } catch { /* non-fatal */ }
            }));
        }

        console.log(`[Report] Questions source: ${denormalizedQuestions ? "denormalized (report.questions)" : "session_questions"}, count: ${finalQuestions.length}`);



        // ── Competency trend: delta vs previous report ────────────────────────
        // Compare each competency score in this report against the last report
        // for the same user to surface "↑ 2 pts" / "↓ 3 pts" / null (new) in B2C UI.
        const previousReport = await prisma.evaluationReport.findFirst({
            where: {
                userId,
                id: { not: report.id },
                generatedAt: { lt: report.generatedAt },
            },
            orderBy: { generatedAt: "desc" },
            select: { competencyScores: true },
        });

        const competencyTrend: Record<string, number | null> = {};
        const currentCompetencies = normalizeStudentCompetencies((report as any).competencyScores ?? []);
        const prevCompetencies = normalizeStudentCompetencies(previousReport?.competencyScores ?? []);
        for (const comp of currentCompetencies) {
            const prev = prevCompetencies.find((p) => p.id === comp.id);
            competencyTrend[comp.id] = prev != null ? comp.score - prev.score : null;
        }

        return {
            id: report.id,
            sessionId: report.sessionId,
            userId: report.userId,
            overallScore: Number(report.overallScore),
            rubricScores: report.rubricScores,
            sectionFeedback: report.sectionFeedback,
            strengths: report.strengths,
            improvements: report.improvements,
            competencyScores: (report as any).competencyScores ?? null,
            competencyTrend,
            benchmark: report.benchmark,
            generatedAt: report.generatedAt,
            session: {
                id: session.id,
                type: session.type,
                role: session.role,
                level: session.level,
                createdAt: session.createdAt,
                completedAt: session.completedAt,
                questions: finalQuestions,
                questionBreakdownMode: session.type === "behavioural" || session.type === "resume_round" ? "section" : "question",
            },
            _debug: {
                totalSessionQuestions: session.sessionQuestions.length,
                reportedQuestions: reportQuestions.length,
                totalMessages: sessionMessages.length,
                messageRoles: sessionMessages.reduce((acc, m) => {
                    acc[m.role] = (acc[m.role] || 0) + 1;
                    return acc;
                }, {} as Record<string, number>),
                messageStages: sessionMessages.reduce((acc, m) => {
                    acc[m.stage] = (acc[m.stage] || 0) + 1;
                    return acc;
                }, {} as Record<string, number>),
            },
        };
    });

    // ─── Delete Report ──────────────────────────────────────────
    // Deletes only the evaluation report, preserving the session data.
    // Cleans up in-flight generation state to allow regeneration.
    fastify.delete("/users/me/reports/:id", async (request, reply) => {
        const userId = request.user!.id;
        const { id } = request.params as { id: string };

        // Find the report by report ID or session ID (same pattern as GET)
        const report = await prisma.evaluationReport.findFirst({
            where: {
                userId,
                OR: [{ id }, { sessionId: id }],
            },
            select: { id: true, sessionId: true },
        });

        if (!report) {
            return reply.status(404).send({
                error: "Not Found",
                message: "Report not found",
            });
        }

        // Delete only the report, preserving the session data
        await prisma.evaluationReport.delete({
            where: { id: report.id },
        });

        // Clear in-flight state to allow regeneration if needed
        inFlightReportGenerations.delete(report.sessionId);
        lastReportGenerationAttemptAt.delete(report.sessionId);

        return reply.status(204).send();
    });

    // ─── Question Sheets (AI-Generated Practice) ─────────────
    // POST /users/me/sheets/generate
    // Generate a new question sheet from a report, or return existing sheet if one already exists
    fastify.post<{ Body: { reportId: string; questions?: any[] } }>("/users/me/sheets/generate", async (request, reply) => {
        const userId = request.user!.id;

        // Rate limit: 5 sheet generations per 10 min
        const rl = checkRateLimit(`sheet-generate:${userId}`, 5, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ error: "Too Many Requests", message: `Sheet generation limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.` });
        }

        const { reportId, questions: payloadQuestions } = request.body;

        if (!reportId) {
            return reply.status(400).send({ error: "reportId is required" });
        }

        // Check if report exists and belongs to user
        const report = await prisma.evaluationReport.findFirst({
            where: { id: reportId, userId },
            include: { session: true },
        });

        if (!report) {
            return reply.status(404).send({ error: "Report not found" });
        }

        // Check if sheet already exists for this report
        const existingSheet = await prisma.questionSheet.findFirst({
            where: { reportId },
        });

        if (existingSheet) {
            // Return existing sheet without regenerating
            return {
                sheetId: existingSheet.id,
                reportId: existingSheet.reportId,
                label: existingSheet.label,
                generatedAt: existingSheet.generatedAt,
                questions: existingSheet.questions,
                progress: existingSheet.progress,
                alreadyExisted: true,
            };
        }

        // Generate new sheet from report weak areas + rubric low scores.
        const improvements = (report.improvements as any[]) || [];
        const rubricScores = Array.isArray(report.rubricScores)
            ? (report.rubricScores as any[])
                  .map((x) => ({ category: String(x?.category || ""), score: Number(x?.score) || 0 }))
                  .filter((x) => x.category)
            : [];

        const weakAreasFromRubric = rubricScores
            .sort((a, b) => a.score - b.score)
            .slice(0, 3)
            .map((x) => x.category);

        const weakAreas = Array.from(
            new Set([
                ...improvements.slice(0, 8).map((imp) => toWeakAreaLabel(imp)),
                ...weakAreasFromRubric,
            ])
        ).filter(Boolean);

        // Build label: "Type · Date · Level"
        // Use user's timezone from request header so the date reflects their local time, not server UTC
        const userTimezone = (request.headers["x-user-timezone"] as string) || "UTC";
        const dateStr = report.generatedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: userTimezone });
        const label = `${report.session.type.replace(/_/g, " ")} · ${dateStr} · ${report.session.level}`;

        let tutorQuestions: SheetQuestion[] = [];

        if (payloadQuestions && payloadQuestions.length > 0) {
            // Use exact questions generated by the AI tutor session passed from frontend
            tutorQuestions = payloadQuestions.map((q) => ({
                id: String(q.id || `q-${Math.random().toString(36).substring(2, 9)}`),
                question: String(q.prompt || q.question || "Question"),
                whatWeAreLookingFor: String(q.whatWeAreLookingFor || ""),
                category: String(q.category || "coding"),
                difficulty: String(q.difficulty || "medium"),
            }));
        } else {
            // Fallback: Curate questions from MongoDB collections based on weak areas + interview type.
            tutorQuestions = await buildDbBackedSheetQuestions({
                sessionType: report.session.type,
                weakAreas,
                level: report.session.level,
                limit: 8,
            });

            // DB-only fallback attempt using broad matching.
            if (!tutorQuestions.length) {
                tutorQuestions = await buildDbBackedSheetQuestions({
                    sessionType: report.session.type,
                    weakAreas: [],
                    level: report.session.level,
                    limit: 8,
                });
            }
        }

        // Create progress tracker (all questions start as "unattempted")
        const progressTracker: Record<string, any> = {};
        tutorQuestions.forEach((q) => {
            progressTracker[q.id] = {
                status: "unattempted", // unattempted | attempted | completed
                attempts: 0,
                lastAnswer: null,
                feedback: null,
            };
        });

        // Save to database
        const newSheet = await prisma.questionSheet.create({
            data: {
                userId,
                reportId,
                sessionId: report.sessionId,
                label,
                questions: tutorQuestions,
                progress: progressTracker,
            },
        });

        return {
            sheetId: newSheet.id,
            reportId: newSheet.reportId,
            label: newSheet.label,
            generatedAt: newSheet.generatedAt,
            questions: newSheet.questions,
            progress: newSheet.progress,
            alreadyExisted: false,
        };
    });

    // GET /users/me/sheets
    // List all question sheets for the user
    fastify.get("/users/me/sheets", async (request, reply) => {
        const userId = request.user!.id;

        console.log("[GET /users/me/sheets] Request received for userId:", userId);

        // Rate limit: 30 list calls per 10 min
        const rl = checkRateLimit(`sheet-list:${userId}`, 30, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ error: "Too Many Requests" });
        }

        const sheets = await prisma.questionSheet.findMany({
            where: { userId },
            orderBy: { generatedAt: "desc" },
            include: {
                report: {
                    select: {
                        session: {
                            select: { type: true, level: true },
                        },
                    },
                },
            },
        });

        console.log("[GET /users/me/sheets] Found sheets:", {
            count: sheets.length,
            sheetIds: sheets.map(s => s.id),
            labels: sheets.map(s => s.label),
        });

        reply.cacheControl("USER_SHORT");
        return {
            sheets: sheets.map((sheet) => {
                const progress = sheet.progress as Record<string, any>;
                const questions = sheet.questions as any[];
                const completedCount = Object.values(progress).filter(
                    (p: any) => p.status === "completed"
                ).length;

                const weakAreas = Array.isArray(questions)
                    ? questions.slice(0, 3).map((q) => toWeakAreaLabel((q as any).category || (q as any).id))
                    : [];

                return {
                    sheetId: sheet.id,
                    reportId: sheet.reportId,
                    label: sheet.label,
                    generatedAt: sheet.generatedAt,
                    totalQuestions: Array.isArray(questions) ? questions.length : 0,
                    completedQuestions: completedCount,
                    weakAreas,
                };
            }),
        };
    });

    // GET /users/me/sheets/by-report/:reportId
    // Check if sheet exists for a specific report (read-only, no generation)
    fastify.get<{ Params: { reportId: string } }>("/users/me/sheets/by-report/:reportId", async (request, reply) => {
        const userId = request.user!.id;

        // Rate limit: 30 lookups per 10 min
        const rl = checkRateLimit(`sheet-by-report:${userId}`, 30, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ error: "Too Many Requests" });
        }

        const { reportId } = request.params;

        const sheet = await prisma.questionSheet.findFirst({
            where: { reportId },
        });

        if (!sheet || sheet.userId !== userId) {
            return { sheet: null };
        }

        const progress = sheet.progress as Record<string, any>;
        const questions = sheet.questions as any[];
        const completedCount = Object.values(progress).filter(
            (p: any) => p.status === "completed"
        ).length;

        return {
            sheet: {
                sheetId: sheet.id,
                reportId: sheet.reportId,
                label: sheet.label,
                generatedAt: sheet.generatedAt,
                totalQuestions: Array.isArray(questions) ? questions.length : 0,
                completedQuestions: completedCount,
            },
        };
    });

    // GET /users/me/sheets/:sheetId
    // Get full sheet with all questions and progress
    fastify.get<{ Params: { sheetId: string } }>("/users/me/sheets/:sheetId", async (request, reply) => {
        const userId = request.user!.id;

        // Rate limit: 30 sheet detail calls per 10 min
        const rlCheck = checkRateLimit(`sheet-detail:${userId}`, 30, 600_000);
        if (!rlCheck.allowed) {
            return reply.status(429).send({ error: "Too Many Requests" });
        }

        const { sheetId } = request.params;

        const sheet = await prisma.questionSheet.findUnique({
            where: { id: sheetId },
        });

        if (!sheet || sheet.userId !== userId) {
            return reply.status(404).send({ error: "Sheet not found" });
        }

        return {
            sheetId: sheet.id,
            reportId: sheet.reportId,
            sessionId: sheet.sessionId,
            label: sheet.label,
            generatedAt: sheet.generatedAt,
            questions: sheet.questions,
            progress: sheet.progress,
        };
    });

    // PATCH /users/me/sheets/:sheetId
    // Rename a question sheet
    fastify.patch<{ Params: { sheetId: string }; Body: { label: string } }>(
        "/users/me/sheets/:sheetId",
        async (request, reply) => {
            const userId = request.user!.id;

            // Rate limit: 20 rename calls per 10 min
            const rl = checkRateLimit(`sheet-rename:${userId}`, 20, 600_000);
            if (!rl.allowed) {
                return reply.status(429).send({ error: "Too Many Requests" });
            }

            const { sheetId } = request.params;
            const parsed = renameSheetSchema.safeParse(request.body ?? {});

            if (!parsed.success) {
                return reply.status(400).send({ error: "Invalid input", details: parsed.error.flatten() });
            }

            const existingSheet = await prisma.questionSheet.findUnique({
                where: { id: sheetId },
                select: { id: true, userId: true },
            });

            if (!existingSheet) {
                return reply.status(404).send({ error: "Sheet not found" });
            }

            if (existingSheet.userId !== userId) {
                return reply.status(403).send({ error: "Unauthorized" });
            }

            const updatedSheet = await prisma.questionSheet.update({
                where: { id: sheetId },
                data: { label: parsed.data.label },
                select: { id: true, label: true },
            });

            return {
                sheetId: updatedSheet.id,
                label: updatedSheet.label,
            };
        }
    );

    // PATCH /users/me/sheets/:sheetId/progress
    // Update progress for a specific question
    fastify.patch<{ Params: { sheetId: string }; Body: { questionId: string; status: string; userAnswer?: string; feedback?: string } }>(
        "/users/me/sheets/:sheetId/progress",
        async (request, reply) => {
            const userId = request.user!.id;

            // Rate limit: 60 progress updates per 10 min
            const rl = checkRateLimit(`sheet-progress:${userId}`, 60, 600_000);
            if (!rl.allowed) {
                return reply.status(429).send({ error: "Too Many Requests" });
            }

            const { sheetId } = request.params;
            const { questionId, status, userAnswer, feedback } = request.body;

            const sheet = await prisma.questionSheet.findUnique({
                where: { id: sheetId },
            });

            if (!sheet || sheet.userId !== userId) {
                return reply.status(404).send({ error: "Sheet not found" });
            }

            const progress = sheet.progress as Record<string, any>;
            if (!progress[questionId]) {
                return reply.status(400).send({ error: "Question not found in this sheet" });
            }

            // Update progress for this question
            progress[questionId] = {
                ...progress[questionId],
                status,
                attempts: (progress[questionId].attempts || 0) + 1,
                lastAnswer: userAnswer || progress[questionId].lastAnswer,
                feedback: feedback || progress[questionId].feedback,
            };

            const updatedSheet = await prisma.questionSheet.update({
                where: { id: sheetId },
                data: { progress },
            });

            return {
                sheetId: updatedSheet.id,
                progress: updatedSheet.progress,
            };
        }
    );

    // POST /users/me/sheets/:sheetId/review-answer
    // AI review of a user's answer to a question
    fastify.post<{ Params: { sheetId: string }; Body: { questionId: string; question: string; whatWeAreLookingFor: string; userAnswer: string } }>(
        "/users/me/sheets/:sheetId/review-answer",
        async (request, reply) => {
            const userId = request.user!.id;

            // Rate limit: 20 review-answer calls per 10 min
            const rl = checkRateLimit(`sheet-review:${userId}`, 20, 600_000);
            if (!rl.allowed) {
                return reply.status(429).send({ error: "Too Many Requests" });
            }

            const { sheetId } = request.params;
            const { questionId, question, whatWeAreLookingFor, userAnswer } = request.body;

            const sheet = await prisma.questionSheet.findUnique({
                where: { id: sheetId },
            });

            if (!sheet || sheet.userId !== userId) {
                return reply.status(404).send({ error: "Sheet not found" });
            }

            // TODO: Call AI service to review answer
            // For now, return a mock response
            const mockFeedback = {
                strengths: [
                    "Good structure and clarity",
                    "Relevant example provided",
                ],
                gaps: [
                    "Missing quantifiable metrics",
                    "Could elaborate on learnings",
                ],
                improvedExample: `A better answer might include: [Your example], which demonstrates [key learnings].`,
                score: 6,
            };

            return mockFeedback;
        }
    );

    // DELETE /users/me/sheets/:sheetId
    // Delete a question sheet permanently
    fastify.delete<{ Params: { sheetId: string } }>(
        "/users/me/sheets/:sheetId",
        async (request, reply) => {
            const userId = request.user!.id;

            // Rate limit: 5 deletes per 10 min
            const rl = checkRateLimit(`sheet-delete:${userId}`, 5, 600_000);
            if (!rl.allowed) {
                return reply.status(429).send({ error: "Too Many Requests" });
            }

            const { sheetId } = request.params;

            if (!sheetId) {
                return reply.status(400).send({ error: "sheetId is required" });
            }

            // Verify sheet exists and belongs to user
            const sheet = await prisma.questionSheet.findUnique({
                where: { id: sheetId },
                select: { userId: true },
            });

            if (!sheet) {
                return reply.status(404).send({ error: "Sheet not found" });
            }

            if (sheet.userId !== userId) {
                return reply.status(403).send({ error: "Unauthorized" });
            }

            // Delete the sheet
            await prisma.questionSheet.delete({
                where: { id: sheetId },
            });

            return reply.status(204).send();
        }
    );

    // ─── Question Progress Endpoints ─────────────────────────
    
    // GET /users/me/progress?questionId=cs-123
    // Get progress for a specific question
    fastify.get("/users/me/progress", async (request, reply) => {
        const userId = request.user!.id;
        const query = request.query as { questionId?: string };
        
        if (!query.questionId) {
            return reply.status(400).send({ error: "questionId is required" });
        }

        try {
            const progress = await prisma.userQuestionProgress.findUnique({
                where: {
                    userId_questionId: {
                        userId,
                        questionId: query.questionId,
                    },
                },
            });

            return progress || { status: "unattempted" };
        } catch (err) {
            fastify.log.error(err, "GET /users/me/progress failed");
            return reply.status(500).send({ error: "Failed to fetch progress" });
        }
    });

    // GET /users/me/progress/bulk?questionIds=cs-123,dsa-456
    // Get progress for multiple questions
    fastify.get("/users/me/progress/bulk", async (request, reply) => {
        const userId = request.user!.id;
        const query = request.query as { questionIds?: string };
        
        if (!query.questionIds) {
            return reply.status(400).send({ error: "questionIds is required" });
        }

        const questionIds = query.questionIds.split(',').filter(Boolean);
        if (questionIds.length === 0) {
            return {};
        }

        try {
            const progressList = await prisma.userQuestionProgress.findMany({
                where: {
                    userId,
                    questionId: { in: questionIds },
                },
            });

            const progressMap: Record<string, { status: string }> = {};
            progressList.forEach((p) => {
                progressMap[p.questionId] = { status: p.status };
            });

            return progressMap;
        } catch (err) {
            fastify.log.error(err, "GET /users/me/progress/bulk failed");
            return reply.status(500).send({ error: "Failed to fetch progress" });
        }
    });

    // POST /users/me/progress
    // Update progress for a question
    fastify.post("/users/me/progress", async (request, reply) => {
        const userId = request.user!.id;
        const body = request.body as { questionId: string; status: string };
        
        if (!body.questionId || !body.status) {
            return reply.status(400).send({ error: "questionId and status are required" });
        }

        if (!["attempted", "solved"].includes(body.status)) {
            return reply.status(400).send({ error: "status must be 'attempted' or 'solved'" });
        }

        try {
            const progress = await prisma.userQuestionProgress.upsert({
                where: {
                    userId_questionId: {
                        userId,
                        questionId: body.questionId,
                    },
                },
                update: {
                    status: body.status,
                    solvedAt: body.status === "solved" ? new Date() : undefined,
                    attemptCount: { increment: 1 },
                },
                create: {
                    userId,
                    questionId: body.questionId,
                    status: body.status,
                    solvedAt: body.status === "solved" ? new Date() : undefined,
                    attemptCount: 1,
                },
            });

            return { success: true, progress };
        } catch (err) {
            fastify.log.error(err, "POST /users/me/progress failed");
            return reply.status(500).send({ error: "Failed to update progress" });
        }
    });

    // ─── Delete Account ────────────────────────────────────────
    // Permanently wipes all user data: R2 files, Postgres rows (via cascade),
    // and the Supabase auth identity.
    //
    // Flow:
    //   1. Collect every R2 object key belonging to this user (resumes + recordings)
    //   2. Delete R2 objects in parallel (best-effort — don't block on failure)
    //   3. Delete the Supabase auth user — triggers the full Postgres onDelete:Cascade chain
    //   4. Bust all Redis cache keys for this user
    //
    // Rate-limited to 1 call per 10 min to prevent accidental double-deletion.
    fastify.delete("/users/me", async (request, reply) => {
        const userId = request.user!.id;

        // Single deletion per user in any 10-min window
        const rl = checkRateLimit(`account-delete:${userId}`, 1, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: "Account deletion already in progress. Please wait before retrying.",
            });
        }

        fastify.log.warn({ userId }, "[AccountDeletion] Initiating account deletion");

        // 1. Collect all R2 object keys for this user
        const [resumes, recordings] = await Promise.all([
            prisma.resume.findMany({
                where: { userId },
                select: { fileUrl: true },
            }),
            prisma.interviewRecording.findMany({
                where: { userId },
                select: { r2Key: true },
            }),
        ]);

        // Extract object keys from R2 URLs (strip bucket-name prefix segment)
        const r2Keys: string[] = [
            ...resumes
                .map((r) => {
                    try {
                        if (!r.fileUrl || r.fileUrl.startsWith("/uploads/")) return null;
                        const segments = new URL(r.fileUrl).pathname.replace(/^\//, "").split("/");
                        return segments.slice(1).join("/"); // drop bucket name
                    } catch { return null; }
                })
                .filter((k): k is string => Boolean(k)),
            ...recordings.map((r) => r.r2Key).filter(Boolean),
        ];

        // 2. Delete R2 objects — best-effort; don't fail the deletion if R2 is unreachable
        if (r2Keys.length > 0) {
            const r2Results = await Promise.allSettled(
                r2Keys.map((key) => deleteFromR2(key))
            );
            const failed = r2Results.filter((r) => r.status === "rejected").length;
            if (failed > 0) {
                fastify.log.warn(
                    { userId, total: r2Keys.length, failed },
                    "[AccountDeletion] Some R2 objects could not be deleted"
                );
            }
        }

        // 3. Delete Supabase auth user — triggers Postgres cascade
        try {
            const { createClient } = await import("@supabase/supabase-js");
            const supabaseAdmin = createClient(
                process.env.SUPABASE_URL!,
                process.env.SUPABASE_SERVICE_ROLE_KEY!,
                { auth: { autoRefreshToken: false, persistSession: false } }
            );
            const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
            if (error) {
                fastify.log.error({ userId, error }, "[AccountDeletion] Supabase user deletion failed");
                return reply.status(500).send({
                    error: "Internal Server Error",
                    message: "Failed to delete account. Please contact support.",
                });
            }
        } catch (err) {
            fastify.log.error({ userId, err }, "[AccountDeletion] Supabase deletion threw exception");
            return reply.status(500).send({
                error: "Internal Server Error",
                message: "Failed to delete account. Please contact support.",
            });
        }

        // 4. Bust all Redis cache keys for this user
        await cacheDel([
            `api:users:${userId}:profile`,
            `api:users:${userId}:stats`,
        ]).catch((err) => {
            fastify.log.warn({ userId, err }, "[AccountDeletion] Redis cache bust failed (non-fatal)");
        });

        fastify.log.info({ userId }, "[AccountDeletion] Account deletion completed successfully");

        return reply.status(204).send();
    });
}

