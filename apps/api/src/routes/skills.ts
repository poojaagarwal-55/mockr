import { FastifyInstance } from "fastify";
import { z } from "zod";
import { DEFAULT_SKILLS, normalizeSkillName } from "@interviewforge/shared";
import { prisma } from "../lib/prisma.js";
import { checkRateLimit } from "../lib/rate-limiter.js";

type SkillRow = {
    id: string;
    name: string;
    normalizedName: string;
    source: string;
    usageCount: number;
};

const skillNameSchema = z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9 .+#/&()_-]+$/, "Use letters, numbers, spaces, and common skill symbols only.");

const searchSchema = z.object({
    q: z.string().trim().max(80).optional().default(""),
    limit: z.coerce.number().int().min(1).max(25).optional().default(12),
});

let seedAttempted = false;

async function ensureDefaultSkillsSeeded() {
    if (seedAttempted) return;

    const countRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM public.skill_suggestions
    `;
    if (Number(countRows[0]?.count ?? 0) > 0) {
        seedAttempted = true;
        return;
    }

    for (const skill of DEFAULT_SKILLS) {
        await prisma.$executeRaw`
            INSERT INTO public.skill_suggestions (name, normalized_name, source)
            VALUES (${skill}, ${normalizeSkillName(skill)}, 'seed')
            ON CONFLICT (normalized_name) DO NOTHING
        `;
    }

    seedAttempted = true;
}

function fallbackSkills(q: string, limit: number) {
    const normalized = normalizeSkillName(q);
    const filtered = DEFAULT_SKILLS
        .filter((skill) => !normalized || normalizeSkillName(skill).includes(normalized))
        .slice(0, limit);

    return filtered.map((skill) => ({
        id: normalizeSkillName(skill),
        name: skill,
        normalizedName: normalizeSkillName(skill),
        source: "seed",
        usageCount: 0,
    }));
}

export default async function skillRoutes(fastify: FastifyInstance) {
    fastify.addHook("preHandler", fastify.authenticate);

    fastify.get("/skills", async (request, reply) => {
        const parsed = searchSchema.safeParse(request.query);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { q, limit } = parsed.data;
        const normalized = normalizeSkillName(q);
        const contains = `%${normalized}%`;
        const prefix = `${normalized}%`;

        try {
            await ensureDefaultSkillsSeeded();

            const rows = normalized
                ? await prisma.$queryRaw<SkillRow[]>`
                    SELECT
                        id,
                        name,
                        normalized_name AS "normalizedName",
                        source,
                        usage_count AS "usageCount"
                    FROM public.skill_suggestions
                    WHERE normalized_name LIKE ${contains}
                    ORDER BY
                        CASE
                            WHEN normalized_name = ${normalized} THEN 0
                            WHEN normalized_name LIKE ${prefix} THEN 1
                            ELSE 2
                        END,
                        usage_count DESC,
                        name ASC
                    LIMIT ${limit}
                `
                : await prisma.$queryRaw<SkillRow[]>`
                    SELECT
                        id,
                        name,
                        normalized_name AS "normalizedName",
                        source,
                        usage_count AS "usageCount"
                    FROM public.skill_suggestions
                    ORDER BY usage_count DESC, name ASC
                    LIMIT ${limit}
                `;

            return { skills: rows };
        } catch (err) {
            fastify.log.warn(err, "Skill suggestions table unavailable, returning default in-memory skills");
            return { skills: fallbackSkills(q, limit), degraded: true };
        }
    });

    fastify.post("/skills", async (request, reply) => {
        const parsed = z.object({ name: skillNameSchema }).safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const userId = request.user!.id;
        const rl = checkRateLimit(`skills:add:${userId}`, 30, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Skill add limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const name = parsed.data.name.replace(/\s+/g, " ").trim();
        const normalizedName = normalizeSkillName(name);

        try {
            const rows = await prisma.$queryRaw<SkillRow[]>`
                INSERT INTO public.skill_suggestions (name, normalized_name, source, usage_count, created_by_user_id)
                VALUES (${name}, ${normalizedName}, 'user', 1, ${userId})
                ON CONFLICT (normalized_name)
                DO UPDATE SET
                    usage_count = public.skill_suggestions.usage_count + 1,
                    updated_at = now()
                RETURNING
                    id,
                    name,
                    normalized_name AS "normalizedName",
                    source,
                    usage_count AS "usageCount"
            `;

            return reply.status(201).send({ skill: rows[0] });
        } catch (err) {
            fastify.log.error(err, "Failed to persist skill suggestion");
            return reply.status(500).send({
                error: "Skill Save Failed",
                message: "Could not save this skill for suggestions yet.",
            });
        }
    });
}
