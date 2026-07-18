// ============================================
// Admin Routes
// ============================================
// All routes here require:
//   1. a verified Supabase JWT (fastify.authenticate)
//   2. the verified email matches ADMIN_EMAILS
//
// The admin check is on EVERY request via a preHandler hook — there is no
// way to reach these handlers without passing both gates.
// Non-admin callers receive a 404 so the existence of the admin surface
// isn't leaked.
// ============================================

import { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "crypto";
import { prisma } from "../lib/prisma.js";
import { isAdminEmail } from "../lib/admin.js";
import { cacheDel } from "../lib/redis.js";
import { checkRateLimit } from "../lib/rate-limiter.js";
import { USER_ROLE, isValidPlacementEmailDomain, normalizePlacementEmailDomain } from "../lib/user-roles.js";
import { PLANS, PlanKey } from "@interviewforge/shared";
import { ensureWallet } from "../services/entitlements.js";
import { getCacheStatistics, invalidateUserPlanCache } from "../services/cache.js";
import { 
    enhancedAdminAuth, 
    adminCouponRevokeAuth, 
    adminBulkOperationAuth,
    revokeAccessSchema,
    bulkRevokeSchema,
    AdminErrorTracker
} from "../middleware/enhanced-admin-auth.js";
import { broadcastCouponRevocation, PlanUpdateBroadcaster } from "../services/plan-update-broadcaster.js";

function notFound(reply: any) {
    return reply.status(404).send({ error: "Not Found" });
}

// Strong, readable codes: 12 chars from 32-symbol alphabet (no ambiguous chars).
function generateCouponCode(): string {
    const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // drop 0/O/1/I
    const bytes = crypto.randomBytes(12);
    let out = "";
    for (let i = 0; i < 12; i++) {
        out += ALPHABET[bytes[i] % ALPHABET.length];
    }
    return out;
}

const adminListQuerySchema = z.object({
    search: z.string().trim().max(120).optional().default(""),
    query: z.string().trim().max(120).optional().default(""),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
});

const adminUserIdParamsSchema = z.object({
    userId: z.string().uuid(),
});

const assignPlacementCoordinatorSchema = z.object({
    collegeEmailDomain: z.string().trim().min(4).max(120).transform(normalizePlacementEmailDomain),
}).refine((data) => isValidPlacementEmailDomain(data.collegeEmailDomain), {
    path: ["collegeEmailDomain"],
    message: "Use a valid college email ending like @lnmiit.ac.in",
});

const emptyBodySchema = z.object({}).strict();

function publicAdminUser(user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    placementCollegeEmailDomain: string | null;
    createdAt?: Date;
}) {
    return {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        placementCollegeEmailDomain: user.placementCollegeEmailDomain,
        createdAt: user.createdAt,
    };
}

const adminExpertSearchSchema = z.object({
    search: z.string().trim().max(120).optional(),
    expertsOnly: z.coerce.boolean().optional().default(false),
});

const adminExpertRoleSchema = z.object({
    email: z.string().email().transform((value) => value.trim().toLowerCase()),
    isExpert: z.boolean(),
});

export default async function adminRoutes(fastify: FastifyInstance) {
    // Auth + admin gate for every route in this plugin.
    fastify.addHook("preHandler", fastify.authenticate);
    fastify.addHook("preHandler", async (request, reply) => {
        const email = request.user?.email;
        if (!isAdminEmail(email)) {
            fastify.log.warn(
                { path: request.url, userId: request.user?.id?.slice(0, 8) },
                "Non-admin attempted admin route"
            );
            return notFound(reply);
        }
    });

    // ── Admin identity check (used by frontend to gate UI) ──────
    fastify.get("/admin/check", async (request) => {
        return { isAdmin: true, email: request.user!.email };
    });

    fastify.get("/admin/users/search", async (request, reply) => {
        const parsed = adminListQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const rl = checkRateLimit(`admin:user-search:${request.user!.id}`, 120, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ error: "Too Many Requests" });
        }

        const search = (parsed.data.query || parsed.data.search).trim();
        if (search.length < 2) {
            return reply.send({ users: [], total: 0, limit: parsed.data.limit, offset: parsed.data.offset });
        }

        const where = {
            OR: [
                { email: { contains: search, mode: "insensitive" as const } },
                { fullName: { contains: search, mode: "insensitive" as const } },
            ],
        };

        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where,
                orderBy: { createdAt: "desc" },
                take: parsed.data.limit,
                skip: parsed.data.offset,
                select: {
                    id: true,
                    email: true,
                    fullName: true,
                    role: true,
                    placementCollegeEmailDomain: true,
                    createdAt: true,
                },
            }),
            prisma.user.count({ where }),
        ]);

        return reply.send({
            users: users.map(publicAdminUser),
            total,
            limit: parsed.data.limit,
            offset: parsed.data.offset,
        });
    });

    fastify.get("/admin/placement-coordinators", async (request, reply) => {
        const parsed = adminListQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const rl = checkRateLimit(`admin:placement-coordinator-list:${request.user!.id}`, 120, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ error: "Too Many Requests" });
        }

        const search = (parsed.data.query || parsed.data.search).trim();
        const where = {
            role: USER_ROLE.PLACEMENT_COORDINATOR,
            ...(search
                ? {
                      OR: [
                          { email: { contains: search, mode: "insensitive" as const } },
                          { fullName: { contains: search, mode: "insensitive" as const } },
                          { placementCollegeEmailDomain: { contains: search, mode: "insensitive" as const } },
                      ],
                  }
                : {}),
        };

        const [coordinators, total] = await Promise.all([
            prisma.user.findMany({
                where,
                orderBy: { updatedAt: "desc" },
                take: parsed.data.limit,
                skip: parsed.data.offset,
                select: {
                    id: true,
                    email: true,
                    fullName: true,
                    role: true,
                    placementCollegeEmailDomain: true,
                    createdAt: true,
                },
            }),
            prisma.user.count({ where }),
        ]);

        return reply.send({
            coordinators: coordinators.map(publicAdminUser),
            total,
            limit: parsed.data.limit,
            offset: parsed.data.offset,
        });
    });

    fastify.patch("/admin/users/:userId/placement-coordinator", async (request, reply) => {
        const params = adminUserIdParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: params.error.flatten().fieldErrors,
            });
        }

        const body = assignPlacementCoordinatorSchema.safeParse(request.body);
        if (!body.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: body.error.flatten().fieldErrors,
            });
        }

        const rl = checkRateLimit(`admin:placement-coordinator-assign:${request.user!.id}`, 60, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ error: "Too Many Requests" });
        }

        const existing = await prisma.user.findUnique({
            where: { id: params.data.userId },
            select: { id: true },
        });

        if (!existing) {
            return reply.status(404).send({ error: "User not found" });
        }

        const updated = await prisma.user.update({
            where: { id: params.data.userId },
            data: {
                role: USER_ROLE.PLACEMENT_COORDINATOR,
                placementCollegeEmailDomain: body.data.collegeEmailDomain,
            },
            select: {
                id: true,
                email: true,
                fullName: true,
                role: true,
                placementCollegeEmailDomain: true,
                createdAt: true,
            },
        });

        await cacheDel([`api:users:${updated.id}:profile`]);
        fastify.log.info(
            {
                adminEmail: request.user!.email,
                targetUserId: updated.id.slice(0, 8),
                collegeEmailDomain: updated.placementCollegeEmailDomain,
            },
            "Admin assigned placement coordinator role"
        );

        return reply.send({ coordinator: publicAdminUser(updated) });
    });

    fastify.delete("/admin/users/:userId/placement-coordinator", async (request, reply) => {
        const params = adminUserIdParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: params.error.flatten().fieldErrors,
            });
        }

        const rl = checkRateLimit(`admin:placement-coordinator-remove:${request.user!.id}`, 60, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ error: "Too Many Requests" });
        }

        const existing = await prisma.user.findUnique({
            where: { id: params.data.userId },
            select: { id: true },
        });

        if (!existing) {
            return reply.status(404).send({ error: "User not found" });
        }

        const updated = await prisma.user.update({
            where: { id: params.data.userId },
            data: {
                role: USER_ROLE.USER,
                placementCollegeEmailDomain: null,
            },
            select: {
                id: true,
                email: true,
                fullName: true,
                role: true,
                placementCollegeEmailDomain: true,
                createdAt: true,
            },
        });

        await cacheDel([`api:users:${updated.id}:profile`]);
        fastify.log.info(
            {
                adminEmail: request.user!.email,
                targetUserId: updated.id.slice(0, 8),
            },
            "Admin removed placement coordinator role"
        );

        return reply.send({ user: publicAdminUser(updated) });
    });

    // ── Expert role assignment ─────────────────────────────────
    fastify.get("/admin/experts", async (request, reply) => {
        const rl = checkRateLimit(`admin:experts:list:${request.user!.id}`, 120, 60_000);
        if (!rl.allowed) {
            return reply.status(429).send({ error: "Too Many Requests" });
        }

        const parsed = adminExpertSearchSchema.safeParse(request.query);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const search = parsed.data.search?.trim();
        const users = await prisma.user.findMany({
            where: {
                ...(parsed.data.expertsOnly ? { isExpert: true } : {}),
                ...(search
                    ? {
                          OR: [
                              { email: { contains: search, mode: "insensitive" } },
                              { fullName: { contains: search, mode: "insensitive" } },
                          ],
                      }
                    : {}),
            },
            select: {
                id: true,
                email: true,
                fullName: true,
                avatarUrl: true,
                isExpert: true,
                createdAt: true,
                expertProfile: {
                    select: {
                        expertise_tags: true,
                        years_experience: true,
                        accepting_bookings: true,
                        sessions_completed: true,
                    },
                },
            },
            orderBy: search ? { createdAt: "desc" } : { updatedAt: "desc" },
            take: 50,
        });

        return {
            users: users.map((user) => ({
                id: user.id,
                email: user.email,
                fullName: user.fullName,
                avatarUrl: user.avatarUrl,
                isExpert: user.isExpert,
                createdAt: user.createdAt,
                profile: user.expertProfile
                    ? {
                          expertiseTags: user.expertProfile.expertise_tags,
                          yearsExperience: user.expertProfile.years_experience,
                          acceptingBookings: user.expertProfile.accepting_bookings,
                          sessionsCompleted: user.expertProfile.sessions_completed,
                      }
                    : null,
            })),
        };
    });

    fastify.patch("/admin/experts/role", async (request, reply) => {
        const rl = checkRateLimit(`admin:experts:role:${request.user!.id}`, 30, 60_000);
        if (!rl.allowed) {
            return reply.status(429).send({ error: "Too Many Requests" });
        }

        const parsed = adminExpertRoleSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const user = await prisma.user.findUnique({
            where: { email: parsed.data.email },
            select: { id: true, email: true, fullName: true },
        });
        if (!user) {
            return reply.status(404).send({ error: "User not found" });
        }

        const updated = await prisma.$transaction(async (tx) => {
            const result = await tx.user.update({
                where: { id: user.id },
                data: { isExpert: parsed.data.isExpert },
                select: {
                    id: true,
                    email: true,
                    fullName: true,
                    avatarUrl: true,
                    isExpert: true,
                },
            });

            if (!parsed.data.isExpert) {
                await tx.expert_profiles.updateMany({
                    where: { user_id: user.id },
                    data: { accepting_bookings: false },
                });
            }

            return result;
        });

        fastify.log.info(
            {
                targetUserId: updated.id.slice(0, 8),
                adminUserId: request.user!.id.slice(0, 8),
                isExpert: updated.isExpert,
            },
            "Admin updated expert role"
        );

        return { user: updated };
    });

    fastify.get("/admin/contest-creators", async (request, reply) => {
        const parsed = adminListQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const rl = checkRateLimit(`admin:contest-creator-list:${request.user!.id}`, 120, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ error: "Too Many Requests" });
        }

        const search = (parsed.data.query || parsed.data.search).trim();
        const where = {
            role: USER_ROLE.CONTEST_CREATOR,
            ...(search
                ? {
                      OR: [
                          { email: { contains: search, mode: "insensitive" as const } },
                          { fullName: { contains: search, mode: "insensitive" as const } },
                      ],
                  }
                : {}),
        };

        const [creators, total] = await Promise.all([
            prisma.user.findMany({
                where,
                orderBy: { updatedAt: "desc" },
                take: parsed.data.limit,
                skip: parsed.data.offset,
                select: {
                    id: true,
                    email: true,
                    fullName: true,
                    role: true,
                    placementCollegeEmailDomain: true,
                    createdAt: true,
                },
            }),
            prisma.user.count({ where }),
        ]);

        return reply.send({
            creators: creators.map(publicAdminUser),
            total,
            limit: parsed.data.limit,
            offset: parsed.data.offset,
        });
    });

    fastify.patch("/admin/users/:userId/contest-creator", async (request, reply) => {
        const params = adminUserIdParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: params.error.flatten().fieldErrors,
            });
        }

        const body = emptyBodySchema.safeParse(request.body ?? {});
        if (!body.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: body.error.flatten().fieldErrors,
            });
        }

        const rl = checkRateLimit(`admin:contest-creator-assign:${request.user!.id}`, 60, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ error: "Too Many Requests" });
        }

        const existing = await prisma.user.findUnique({
            where: { id: params.data.userId },
            select: { id: true },
        });

        if (!existing) {
            return reply.status(404).send({ error: "User not found" });
        }

        const updated = await prisma.user.update({
            where: { id: params.data.userId },
            data: {
                role: USER_ROLE.CONTEST_CREATOR,
                placementCollegeEmailDomain: null,
            },
            select: {
                id: true,
                email: true,
                fullName: true,
                role: true,
                placementCollegeEmailDomain: true,
                createdAt: true,
            },
        });

        await cacheDel([`api:users:${updated.id}:profile`]);
        fastify.log.info(
            {
                adminEmail: request.user!.email,
                targetUserId: updated.id.slice(0, 8),
            },
            "Admin assigned contest creator role"
        );

        return reply.send({ creator: publicAdminUser(updated) });
    });

    fastify.delete("/admin/users/:userId/contest-creator", async (request, reply) => {
        const params = adminUserIdParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: params.error.flatten().fieldErrors,
            });
        }

        const rl = checkRateLimit(`admin:contest-creator-remove:${request.user!.id}`, 60, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ error: "Too Many Requests" });
        }

        const existing = await prisma.user.findUnique({
            where: { id: params.data.userId },
            select: { id: true },
        });

        if (!existing) {
            return reply.status(404).send({ error: "User not found" });
        }

        const updated = await prisma.user.update({
            where: { id: params.data.userId },
            data: {
                role: USER_ROLE.USER,
                placementCollegeEmailDomain: null,
            },
            select: {
                id: true,
                email: true,
                fullName: true,
                role: true,
                placementCollegeEmailDomain: true,
                createdAt: true,
            },
        });

        await cacheDel([`api:users:${updated.id}:profile`]);
        fastify.log.info(
            {
                adminEmail: request.user!.email,
                targetUserId: updated.id.slice(0, 8),
            },
            "Admin removed contest creator role"
        );

        return reply.send({ user: publicAdminUser(updated) });
    });

    // ── List coupons with full redemption history ───────────────
    fastify.get("/admin/coupons", async (request, reply) => {
        const query = request.query as {
            limit?: string;
            offset?: string;
            status?: "active" | "inactive" | "all";
            search?: string;
        };
        const limit = Math.min(parseInt(query.limit || "50"), 200);
        const offset = parseInt(query.offset || "0");

        const where: any = {};
        if (query.status === "active") where.active = true;
        else if (query.status === "inactive") where.active = false;
        if (query.search) {
            where.code = { contains: query.search.toUpperCase() };
        }

        const [coupons, total] = await Promise.all([
            prisma.coupon.findMany({
                where,
                orderBy: { createdAt: "desc" },
                take: limit,
                skip: offset,
                include: {
                    redemptionList: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    email: true,
                                    fullName: true,
                                },
                            },
                        },
                        orderBy: { redeemedAt: "desc" },
                    },
                    revocations: {
                        select: {
                            userId: true,
                            revokedBy: true,
                            revokedAt: true,
                            reason: true,
                        },
                    },
                },
            }),
            prisma.coupon.count({ where }),
        ]);

        const now = new Date();
        return reply.send({
            coupons: coupons.map((c) => {
                const isExhausted =
                    c.maxRedemptions !== null &&
                    c.maxRedemptions !== undefined &&
                    c.redemptions >= c.maxRedemptions;
                const isExpired = c.expiresAt !== null && c.expiresAt < now;
                
                // Create revocation map for quick lookup
                const revocationMap = new Map(
                    c.revocations.map(r => [r.userId, r])
                );
                
                return {
                    id: c.id,
                    code: c.code,
                    type: c.type,
                    plan: c.plan,
                    durationDays: c.durationDays,
                    discountPercent: c.discountPercent,
                    maxRedemptions: c.maxRedemptions,
                    redemptions: c.redemptions,
                    perUserLimit: c.perUserLimit,
                    allowedEmail: c.allowedEmail,
                    expiresAt: c.expiresAt,
                    active: c.active,
                    status: !c.active
                        ? "DISABLED"
                        : isExpired
                        ? "EXPIRED"
                        : isExhausted
                        ? "EXHAUSTED"
                        : "ACTIVE",
                    notes: c.notes,
                    createdBy: c.createdBy,
                    createdAt: c.createdAt,
                    updatedAt: c.updatedAt,
                    redemptions_log: c.redemptionList.map((r) => {
                        const revocation = revocationMap.get(r.userId);
                        return {
                            id: r.id,
                            userId: r.userId,
                            userEmail: r.user.email,
                            userName: r.user.fullName,
                            redeemedAt: r.redeemedAt,
                            isRevoked: !!revocation,
                            revokedAt: revocation?.revokedAt || null,
                            revokedBy: revocation?.revokedBy || null,
                            revocationReason: revocation?.reason || null,
                        };
                    }),
                };
            }),
            total,
            limit,
            offset,
        });
    });

    // ── Create a coupon ─────────────────────────────────────────
    const PRESETS = [7, 14, 30, 90, 180, 365] as const;
    const createCouponSchema = z
        .object({
            plan: z.enum(PLANS).refine((p) => p !== "FREE", {
                message: "Cannot grant FREE plan",
            }),
            durationPreset: z
                .enum(["7", "14", "30", "90", "180", "365", "indefinite", "custom"])
                .default("30"),
            customDurationDays: z.number().int().min(1).max(3650).optional(),
            maxRedemptions: z.number().int().min(1).max(10000).nullable().optional(),
            singleUse: z.boolean().default(false),
            allowedEmail: z
                .string()
                .email()
                .optional()
                .or(z.literal("")),
            code: z
                .string()
                .trim()
                .min(4)
                .max(32)
                .regex(/^[A-Z0-9_-]+$/i, "Code may only contain letters, digits, - and _")
                .optional(),
            notes: z.string().max(500).optional(),
        })
        .superRefine((val, ctx) => {
            if (val.durationPreset === "custom" && !val.customDurationDays) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["customDurationDays"],
                    message: "customDurationDays is required when durationPreset=custom",
                });
            }
        });

    fastify.post("/admin/coupons", async (request, reply) => {
        const rl = checkRateLimit(`admin:coupon:${request.user!.id}`, 60, 3_600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ error: "Too Many Requests" });
        }

        const parsed = createCouponSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }
        const {
            plan,
            durationPreset,
            customDurationDays,
            maxRedemptions,
            singleUse,
            allowedEmail,
            code: providedCode,
            notes,
        } = parsed.data;

        // Resolve durationDays. `indefinite` stores null.
        let durationDays: number | null;
        if (durationPreset === "indefinite") {
            durationDays = 365 * 100; // effectively 100 years — keeps schema NOT-NULL assumption
        } else if (durationPreset === "custom") {
            durationDays = customDurationDays!;
        } else {
            durationDays = parseInt(durationPreset, 10);
        }

        // Resolve maxRedemptions: singleUse forces 1, otherwise use provided (null = unlimited).
        const resolvedMax = singleUse ? 1 : maxRedemptions ?? null;

        // Code: either caller-provided (uppercased) or auto-generated. Retry on collision.
        let code = providedCode?.toUpperCase();
        let created;
        for (let attempt = 0; attempt < 5; attempt++) {
            const candidate = code ?? generateCouponCode();
            try {
                created = await prisma.coupon.create({
                    data: {
                        code: candidate,
                        type: "PLAN_GRANT",
                        plan: plan as PlanKey,
                        durationDays,
                        maxRedemptions: resolvedMax,
                        perUserLimit: 1,
                        allowedEmail: allowedEmail ? allowedEmail.toLowerCase() : null,
                        notes: notes ?? null,
                        active: true,
                        createdBy: request.user!.email,
                    },
                });
                break;
            } catch (err: any) {
                // P2002 = unique violation on code. Retry with a new auto-generated code,
                // or fail fast if the user provided one that collides.
                if (err?.code === "P2002" && !providedCode) {
                    continue;
                }
                if (err?.code === "P2002") {
                    return reply.status(409).send({ error: "Coupon code already exists" });
                }
                throw err;
            }
        }
        if (!created) {
            return reply.status(500).send({ error: "Failed to generate unique code" });
        }

        return reply.status(201).send({
            id: created.id,
            code: created.code,
            plan: created.plan,
            durationDays: created.durationDays,
            maxRedemptions: created.maxRedemptions,
            allowedEmail: created.allowedEmail,
            active: created.active,
            createdAt: created.createdAt,
        });
    });

    // ── Toggle / disable a coupon ───────────────────────────────
    const patchCouponSchema = z.object({
        active: z.boolean(),
    });

    fastify.patch("/admin/coupons/:id", async (request, reply) => {
        const { id } = request.params as { id: string };
        const parsed = patchCouponSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: "Validation Error" });
        }

        const existing = await prisma.coupon.findUnique({ where: { id } });
        if (!existing) return reply.status(404).send({ error: "Not found" });

        const updated = await prisma.coupon.update({
            where: { id },
            data: { active: parsed.data.active },
        });
        return reply.send({ id: updated.id, active: updated.active });
    });

    // ── Delete a coupon (only if never redeemed) ────────────────
    fastify.delete("/admin/coupons/:id", async (request, reply) => {
        const { id } = request.params as { id: string };
        const existing = await prisma.coupon.findUnique({
            where: { id },
            select: { id: true, redemptions: true },
        });
        if (!existing) return reply.status(404).send({ error: "Not found" });
        if (existing.redemptions > 0) {
            return reply.status(409).send({
                error: "Cannot delete a coupon that has been redeemed — disable it instead",
            });
        }
        await prisma.coupon.delete({ where: { id } });
        return reply.send({ success: true });
    });

    // ── Aggregate stats for dashboard ───────────────────────────
    fastify.get("/admin/coupons/stats", async (_request, reply) => {
        const [total, active, totalRedemptions, byPlan] = await Promise.all([
            prisma.coupon.count(),
            prisma.coupon.count({ where: { active: true } }),
            prisma.couponRedemption.count(),
            prisma.coupon.groupBy({
                by: ["plan"],
                _count: { _all: true },
            }),
        ]);
        return reply.send({
            totalCoupons: total,
            activeCoupons: active,
            totalRedemptions,
            byPlan: byPlan.map((g) => ({
                plan: g.plan,
                count: g._count._all,
            })),
        });
    });

    // ── Admin minute grant (direct, no coupon) ──────────────────
    const grantMinutesSchema = z.object({
        email: z.string().email(),
        amount: z.number().int().min(1).max(10000),
        notes: z.string().max(500).optional(),
    });

    fastify.post("/admin/credits/grant", async (request, reply) => {
        const rl = checkRateLimit(`admin:credits:${request.user!.id}`, 30, 3_600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ error: "Too Many Requests" });
        }

        const parsed = grantMinutesSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { email, amount, notes } = parsed.data;

        const targetUser = await prisma.user.findUnique({
            where: { email: email.toLowerCase() },
            select: { id: true, email: true, fullName: true },
        });
        if (!targetUser) {
            return reply.status(404).send({ error: "User not found with that email" });
        }

        // Ensure wallet exists before granting
        const wallet = await ensureWallet(targetUser.id);

        // Atomic: increment purchased balance + ledger entry
        const updated = await prisma.$transaction(async (tx) => {
            const w = await tx.creditWallet.update({
                where: { userId: targetUser.id },
                data: { purchasedBalance: { increment: amount } },
            });
            await tx.creditLedger.create({
                data: {
                    userId: targetUser.id,
                    walletId: wallet.id,
                    bucket: "PURCHASED",
                    delta: amount,
                    reason: "admin_minute_adjust",
                    refType: "admin_minute_grant",
                    refId: request.user!.id,
                    balanceAfter: {
                        free: w.freeCreditsRemaining,
                        monthly: w.monthlyBalance,
                        purchased: w.purchasedBalance,
                    },
                },
            });
            return w;
        });

        // Invalidate cache and broadcast update
        console.log(`[Admin] Invalidating cache for user ${targetUser.id.slice(0, 8)} after granting ${amount} minutes`);
        await invalidateUserPlanCache(targetUser.id);
        
        // Broadcast plan update via WebSocket
        console.log(`[Admin] Broadcasting plan update for user ${targetUser.id.slice(0, 8)}`);
        const broadcaster = new PlanUpdateBroadcaster();
        await broadcaster.broadcastUserPlanUpdate(targetUser.id, {
            reason: 'ADMIN_MODIFICATION',
            source: 'credit_grant',
            adminId: request.user!.id,
            metadata: { amount, notes }
        });
        console.log(`[Admin] Plan update broadcast completed for user ${targetUser.id.slice(0, 8)}`);

        fastify.log.info(
            {
                adminEmail: request.user!.email,
                targetUserId: targetUser.id.slice(0, 8),
                amount,
            },
            "Admin granted interview minutes"
        );

        return reply.status(201).send({
            success: true,
            user: {
                id: targetUser.id,
                email: targetUser.email,
                fullName: targetUser.fullName,
            },
            minutesGranted: amount,
            newPurchasedBalance: updated.purchasedBalance,
            notes: notes ?? null,
        });
    });

    // ── Admin minute removal ──────────────────
    const removeMinutesSchema = z.object({
        email: z.string().email(),
        amount: z.number().int().min(1).max(10000),
        notes: z.string().max(500).optional(),
    });

    fastify.post("/admin/credits/remove", async (request, reply) => {
        const rl = checkRateLimit(`admin:credits:${request.user!.id}`, 30, 3_600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ error: "Too Many Requests" });
        }

        const parsed = removeMinutesSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { email, amount, notes } = parsed.data;

        const targetUser = await prisma.user.findUnique({
            where: { email: email.toLowerCase() },
            select: { id: true, email: true, fullName: true },
        });
        if (!targetUser) {
            return reply.status(404).send({ error: "User not found with that email" });
        }

        // Ensure wallet exists
        const wallet = await ensureWallet(targetUser.id);

        // Get current wallet state
        const currentWallet = await prisma.creditWallet.findUnique({
            where: { userId: targetUser.id },
            select: {
                freeCreditsRemaining: true,
                monthlyBalance: true,
                purchasedBalance: true,
            },
        });

        if (!currentWallet) {
            return reply.status(404).send({ error: "User wallet not found" });
        }

        const totalMinutes = 
            currentWallet.freeCreditsRemaining + 
            currentWallet.monthlyBalance + 
            currentWallet.purchasedBalance;

        // Determine how much to actually remove
        const amountToRemove = Math.min(amount, totalMinutes);

        if (amountToRemove === 0) {
            return reply.status(400).send({ 
                error: "User has no minutes to remove" 
            });
        }

        // Remove minutes in priority order: purchased -> monthly -> free
        let remaining = amountToRemove;
        let purchasedRemoved = 0;
        let monthlyRemoved = 0;
        let freeRemoved = 0;

        if (remaining > 0 && currentWallet.purchasedBalance > 0) {
            purchasedRemoved = Math.min(remaining, currentWallet.purchasedBalance);
            remaining -= purchasedRemoved;
        }

        if (remaining > 0 && currentWallet.monthlyBalance > 0) {
            monthlyRemoved = Math.min(remaining, currentWallet.monthlyBalance);
            remaining -= monthlyRemoved;
        }

        if (remaining > 0 && currentWallet.freeCreditsRemaining > 0) {
            freeRemoved = Math.min(remaining, currentWallet.freeCreditsRemaining);
            remaining -= freeRemoved;
        }

        // Atomic: decrement balances + ledger entries
        const updated = await prisma.$transaction(async (tx) => {
            const w = await tx.creditWallet.update({
                where: { userId: targetUser.id },
                data: {
                    purchasedBalance: { decrement: purchasedRemoved },
                    monthlyBalance: { decrement: monthlyRemoved },
                    freeCreditsRemaining: { decrement: freeRemoved },
                },
            });

            // Create ledger entries for each bucket that was decremented
            if (purchasedRemoved > 0) {
                await tx.creditLedger.create({
                    data: {
                        userId: targetUser.id,
                        walletId: wallet.id,
                        bucket: "PURCHASED",
                        delta: -purchasedRemoved,
                        reason: "admin_minute_remove",
                        refType: "admin_minute_remove",
                        refId: request.user!.id,
                        balanceAfter: {
                            free: w.freeCreditsRemaining,
                            monthly: w.monthlyBalance,
                            purchased: w.purchasedBalance,
                        },
                    },
                });
            }

            if (monthlyRemoved > 0) {
                await tx.creditLedger.create({
                    data: {
                        userId: targetUser.id,
                        walletId: wallet.id,
                        bucket: "MONTHLY",
                        delta: -monthlyRemoved,
                        reason: "admin_minute_remove",
                        refType: "admin_minute_remove",
                        refId: request.user!.id,
                        balanceAfter: {
                            free: w.freeCreditsRemaining,
                            monthly: w.monthlyBalance,
                            purchased: w.purchasedBalance,
                        },
                    },
                });
            }

            if (freeRemoved > 0) {
                await tx.creditLedger.create({
                    data: {
                        userId: targetUser.id,
                        walletId: wallet.id,
                        bucket: "FREE",
                        delta: -freeRemoved,
                        reason: "admin_minute_remove",
                        refType: "admin_minute_remove",
                        refId: request.user!.id,
                        balanceAfter: {
                            free: w.freeCreditsRemaining,
                            monthly: w.monthlyBalance,
                            purchased: w.purchasedBalance,
                        },
                    },
                });
            }

            return w;
        });

        // Invalidate cache after removing minutes
        await invalidateUserPlanCache(targetUser.id);
        
        // Broadcast plan update via WebSocket
        const broadcaster = new PlanUpdateBroadcaster();
        await broadcaster.broadcastUserPlanUpdate(targetUser.id, {
            reason: 'ADMIN_MODIFICATION',
            source: 'credit_removal',
            adminId: request.user!.id,
            metadata: { 
                amountRequested: amount, 
                amountRemoved: amountToRemove,
                breakdown: { purchased: purchasedRemoved, monthly: monthlyRemoved, free: freeRemoved },
                notes 
            }
        });

        fastify.log.info(
            {
                adminEmail: request.user!.email,
                targetUserId: targetUser.id.slice(0, 8),
                amountRequested: amount,
                amountRemoved: amountToRemove,
                breakdown: {
                    purchased: purchasedRemoved,
                    monthly: monthlyRemoved,
                    free: freeRemoved,
                },
            },
            "Admin removed interview minutes"
        );

        return reply.status(200).send({
            success: true,
            user: {
                id: targetUser.id,
                email: targetUser.email,
                fullName: targetUser.fullName,
            },
            minutesRemoved: amountToRemove,
            breakdown: {
                purchased: purchasedRemoved,
                monthly: monthlyRemoved,
                free: freeRemoved,
            },
            newBalances: {
                purchased: updated.purchasedBalance,
                monthly: updated.monthlyBalance,
                free: updated.freeCreditsRemaining,
                total: updated.purchasedBalance + updated.monthlyBalance + updated.freeCreditsRemaining,
            },
            notes: notes ?? null,
        });
    });

    // ── Lookup user wallet (admin only) ─────────────────────────
    fastify.get("/admin/users/lookup", async (request, reply) => {
        const { email } = request.query as { email?: string };
        if (!email) {
            return reply.status(400).send({ error: "email query param required" });
        }

        const user = await prisma.user.findUnique({
            where: { email: email.toLowerCase() },
            select: {
                id: true,
                email: true,
                fullName: true,
                creditWallet: {
                    select: {
                        freeCreditsRemaining: true,
                        monthlyBalance: true,
                        purchasedBalance: true,
                    },
                },
            },
        });
        if (!user) {
            return reply.status(404).send({ error: "User not found" });
        }

        const w = user.creditWallet;
        return reply.send({
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            wallet: w
                ? {
                      free: w.freeCreditsRemaining,
                      monthly: w.monthlyBalance,
                      purchased: w.purchasedBalance,
                      total:
                          w.freeCreditsRemaining +
                          w.monthlyBalance +
                          w.purchasedBalance,
                  }
                : null,
        });
    });

    // ── Cache statistics (admin monitoring) ─────────────────────
    fastify.get("/admin/cache/stats", async (request, reply) => {
        const stats = await getCacheStatistics();
        return reply.send({
            ...stats,
            timestamp: new Date(),
        });
    });

    // ============================================
    // Coupon Revocation Endpoints
    // ============================================

    // ── Revoke coupon access for a single user ──────────────────
    fastify.post("/admin/coupons/:id/revoke-access", {
        preHandler: adminCouponRevokeAuth
    }, async (request, reply) => {
        const { id: couponId } = request.params as { id: string };
        
        try {
            const parsed = revokeAccessSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.status(400).send({
                    error: "Validation Error",
                    details: parsed.error.flatten().fieldErrors,
                });
            }

            const { userId, reason } = parsed.data;

            // Verify coupon exists
            const coupon = await prisma.coupon.findUnique({
                where: { id: couponId },
                select: { id: true, code: true, active: true }
            });

            if (!coupon) {
                return reply.status(404).send({ error: "Coupon not found" });
            }

            // Check if user has redeemed this coupon
            const redemption = await prisma.couponRedemption.findFirst({
                where: {
                    couponId,
                    userId
                },
                select: { id: true, userId: true }
            });

            if (!redemption) {
                return reply.status(404).send({ 
                    error: "User has not redeemed this coupon" 
                });
            }

            // Check if already revoked
            const existingRevocation = await prisma.couponRevocation.findUnique({
                where: {
                    couponId_userId: {
                        couponId,
                        userId
                    }
                }
            });

            if (existingRevocation) {
                return reply.status(409).send({
                    error: "Access already revoked for this user"
                });
            }

            // Create revocation record
            const revocation = await prisma.couponRevocation.create({
                data: {
                    couponId,
                    userId,
                    revokedBy: request.user!.email,
                    reason: reason || null
                }
            });

            // Broadcast plan update to affected user
            await broadcastCouponRevocation([userId], request.user!.id, coupon.code);

            fastify.log.info({
                adminEmail: request.user!.email,
                couponId: couponId.slice(0, 8) + '***',
                userId: userId.slice(0, 8) + '***',
                reason
            }, "Coupon access revoked");

            return reply.status(201).send({
                success: true,
                revocation: {
                    id: revocation.id,
                    couponId,
                    userId: userId.slice(0, 8) + '***', // Masked for security
                    revokedBy: request.user!.email,
                    revokedAt: revocation.revokedAt,
                    reason: revocation.reason
                }
            });

        } catch (error: any) {
            const errorId = AdminErrorTracker.track(error, {
                operation: 'revoke_coupon_access',
                component: 'admin_coupon_management',
                severity: 'medium',
                metadata: { couponId }
            }, request);

            return reply.status(500).send({
                error: "Internal Server Error",
                errorId,
                message: process.env.NODE_ENV === "production" 
                    ? "Failed to revoke coupon access" 
                    : error.message
            });
        }
    });

    // ── Get coupon redemption history with revocation status ────
    fastify.get("/admin/coupons/:id/redemptions", {
        preHandler: enhancedAdminAuth
    }, async (request, reply) => {
        const { id: couponId } = request.params as { id: string };
        
        try {
            // Verify coupon exists
            const coupon = await prisma.coupon.findUnique({
                where: { id: couponId },
                select: { 
                    id: true, 
                    code: true, 
                    active: true,
                    redemptions: true,
                    maxRedemptions: true
                }
            });

            if (!coupon) {
                return reply.status(404).send({ error: "Coupon not found" });
            }

            // Get redemptions with revocation status
            const redemptions = await prisma.couponRedemption.findMany({
                where: { couponId },
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            fullName: true
                        }
                    },
                    coupon: {
                        include: {
                            revocations: {
                                where: { userId: { in: [] } } // Will be populated below
                            }
                        }
                    }
                },
                orderBy: { redeemedAt: 'desc' }
            });

            // Get all revocations for this coupon
            const revocations = await prisma.couponRevocation.findMany({
                where: { couponId },
                select: {
                    userId: true,
                    revokedBy: true,
                    revokedAt: true,
                    reason: true
                }
            });

            const revocationMap = new Map(
                revocations.map(r => [r.userId, r])
            );

            const redemptionsWithStatus = redemptions.map(redemption => {
                const revocation = revocationMap.get(redemption.userId);
                return {
                    id: redemption.id,
                    userId: redemption.userId.slice(0, 8) + '***', // Masked for security
                    userEmail: redemption.user.email,
                    userName: redemption.user.fullName,
                    redeemedAt: redemption.redeemedAt,
                    isRevoked: !!revocation,
                    revokedAt: revocation?.revokedAt || null,
                    revokedBy: revocation?.revokedBy || null,
                    revocationReason: revocation?.reason || null
                };
            });

            const activeRedemptions = redemptionsWithStatus.filter(r => !r.isRevoked).length;
            const revokedRedemptions = redemptionsWithStatus.filter(r => r.isRevoked).length;

            return reply.send({
                coupon: {
                    id: coupon.id,
                    code: coupon.code,
                    active: coupon.active,
                    totalRedemptions: coupon.redemptions,
                    maxRedemptions: coupon.maxRedemptions,
                    activeRedemptions,
                    revokedRedemptions
                },
                redemptions: redemptionsWithStatus,
                total: redemptionsWithStatus.length
            });

        } catch (error: any) {
            const errorId = AdminErrorTracker.track(error, {
                operation: 'get_coupon_redemptions',
                component: 'admin_coupon_management',
                severity: 'low',
                metadata: { couponId }
            }, request);

            return reply.status(500).send({
                error: "Internal Server Error",
                errorId,
                message: process.env.NODE_ENV === "production" 
                    ? "Failed to fetch redemption history" 
                    : error.message
            });
        }
    });

    // ── Bulk revoke coupon access for multiple users ────────────
    fastify.post("/admin/coupons/:id/bulk-revoke", {
        preHandler: adminBulkOperationAuth
    }, async (request, reply) => {
        const { id: couponId } = request.params as { id: string };
        
        try {
            const parsed = bulkRevokeSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.status(400).send({
                    error: "Validation Error",
                    details: parsed.error.flatten().fieldErrors,
                });
            }

            const { userIds, reason } = parsed.data;

            // Verify coupon exists
            const coupon = await prisma.coupon.findUnique({
                where: { id: couponId },
                select: { id: true, code: true, active: true }
            });

            if (!coupon) {
                return reply.status(404).send({ error: "Coupon not found" });
            }

            // Get existing redemptions for these users
            const redemptions = await prisma.couponRedemption.findMany({
                where: {
                    couponId,
                    userId: { in: userIds }
                },
                select: { userId: true }
            });

            const redeemedUserIds = redemptions.map(r => r.userId);
            const notRedeemedUserIds = userIds.filter(id => !redeemedUserIds.includes(id));

            // Get existing revocations
            const existingRevocations = await prisma.couponRevocation.findMany({
                where: {
                    couponId,
                    userId: { in: redeemedUserIds }
                },
                select: { userId: true }
            });

            const alreadyRevokedUserIds = existingRevocations.map(r => r.userId);
            const toRevokeUserIds = redeemedUserIds.filter(id => !alreadyRevokedUserIds.includes(id));

            if (toRevokeUserIds.length === 0) {
                return reply.status(400).send({
                    error: "No valid users to revoke access for",
                    details: {
                        notRedeemed: notRedeemedUserIds.length,
                        alreadyRevoked: alreadyRevokedUserIds.length,
                        total: userIds.length
                    }
                });
            }

            // Create revocation records in batch
            const revocations = await prisma.couponRevocation.createMany({
                data: toRevokeUserIds.map(userId => ({
                    couponId,
                    userId,
                    revokedBy: request.user!.email,
                    reason: reason || null
                }))
            });

            // Broadcast plan updates to affected users
            await broadcastCouponRevocation(toRevokeUserIds, request.user!.id, coupon.code);

            fastify.log.info({
                adminEmail: request.user!.email,
                couponId: couponId.slice(0, 8) + '***',
                revokedCount: toRevokeUserIds.length,
                totalRequested: userIds.length,
                reason
            }, "Bulk coupon access revoked");

            return reply.status(201).send({
                success: true,
                result: {
                    revoked: toRevokeUserIds.length,
                    alreadyRevoked: alreadyRevokedUserIds.length,
                    notRedeemed: notRedeemedUserIds.length,
                    total: userIds.length
                },
                revokedUserIds: toRevokeUserIds.map(id => id.slice(0, 8) + '***'), // Masked for security
                reason: reason || null
            });

        } catch (error: any) {
            const errorId = AdminErrorTracker.track(error, {
                operation: 'bulk_revoke_coupon_access',
                component: 'admin_coupon_management',
                severity: 'high',
                metadata: { couponId, userCount: (request.body as any)?.userIds?.length }
            }, request);

            return reply.status(500).send({
                error: "Internal Server Error",
                errorId,
                message: process.env.NODE_ENV === "production" 
                    ? "Failed to bulk revoke coupon access" 
                    : error.message
            });
        }
    });
}
