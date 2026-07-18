import { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { checkRateLimit } from "../lib/rate-limiter.js";
import { sanitizeForLog } from "../lib/log-utils.js";
import {
    isCompanyAdminRole,
    requireCompanyWorkspaceAccess,
    type CompanyWorkspaceAccess,
} from "./access.js";
import {
    createInvitationToken,
    hashInvitationToken,
    invitationExpiryDate,
    linkPendingTeamInvitationsForCompanyAccount,
    normalizeTeamEmail,
    sendTeamAddedEmail,
    sendTeamInvitationEmail,
} from "../services/team-invitations.js";

const companyTeam = (prisma as any).companyTeam;
const companyTeamInvitation = (prisma as any).companyTeamInvitation;

const roleSchema = z.enum(["admin", "member", "viewer"]);
const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
    z.preprocess(
        (value) => (typeof value === "string" && value.trim() === "" ? null : value),
        z.string().trim().max(max).optional().nullable()
    );

const memberInputSchema = z.object({
    email: z.string().email().transform(normalizeTeamEmail),
    role: roleSchema.default("member"),
    nameHint: optionalText(120),
    message: optionalText(600),
});

const createTeamSchema = z.object({
    name: nonEmptyText(100),
    description: optionalText(600),
    avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
    initialMember: memberInputSchema.optional().nullable(),
});

const teamParamsSchema = z.object({
    id: z.string().uuid(),
});

const teamMemberParamsSchema = z.object({
    teamId: z.string().uuid(),
    memberId: z.string().uuid(),
});

const updateMemberRoleSchema = z.object({
    role: roleSchema,
});

const acceptInviteParamsSchema = z.object({
    token: z.string().min(32).max(256).regex(/^[A-Za-z0-9_-]+$/),
});

type QueuedTeamEmail =
    | {
        kind: "invitation";
        to: string;
        companyName: string;
        teamName: string;
        role: string;
        token: string;
        message?: string | null;
    }
    | {
        kind: "added";
        to: string;
        companyName: string;
        teamName: string;
        role: string;
        message?: string | null;
    };

class RouteError extends Error {
    constructor(
        public statusCode: number,
        public payload: Record<string, unknown>
    ) {
        super(String(payload.message || payload.error || "Request failed"));
    }
}

function validationPayload(error: z.ZodError) {
    const first = error.issues[0];
    return {
        error: "Validation Error",
        message: first ? `${first.path.join(".") || "body"}: ${first.message}` : "Fix the highlighted fields.",
        details: error.flatten().fieldErrors,
    };
}

function routeError(statusCode: number, error: string, message: string): RouteError {
    return new RouteError(statusCode, { error, message });
}

function canInviteTeamMembers(role: CompanyWorkspaceAccess["role"]): boolean {
    return isCompanyAdminRole(role) || role === "member";
}

function canAssignTeamRole(actorRole: CompanyWorkspaceAccess["role"], targetRole: z.infer<typeof roleSchema>): boolean {
    return isCompanyAdminRole(actorRole) || targetRole !== "admin";
}

async function resolveCompanyWideTeamRole({
    tx,
    companyId,
    email,
    companyAccountId,
}: {
    tx: any;
    companyId: string;
    email: string;
    companyAccountId?: string | null;
}): Promise<z.infer<typeof roleSchema> | null> {
    const memberOr: any[] = [{ email }];
    if (companyAccountId) memberOr.push({ companyAccountId });

    const activeMember = await tx.companyTeamMember.findFirst({
        where: {
            companyId,
            status: "active",
            OR: memberOr,
        },
        orderBy: [
            { joinedAt: "asc" },
            { createdAt: "asc" },
        ],
        select: { role: true },
    });
    if (activeMember?.role) return activeMember.role;

    const reservedMember = await tx.companyTeamMember.findFirst({
        where: {
            companyId,
            status: "pending_invite",
            OR: memberOr,
        },
        orderBy: { createdAt: "asc" },
        select: { role: true },
    });
    if (reservedMember?.role) return reservedMember.role;

    const pendingInvitation = await tx.companyTeamInvitation.findFirst({
        where: {
            companyId,
            email,
            status: "pending",
            expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "asc" },
        select: { role: true },
    });

    return pendingInvitation?.role || null;
}

async function syncCompanyWideTeamRole({
    tx,
    companyId,
    email,
    companyAccountId,
    role,
}: {
    tx: any;
    companyId: string;
    email: string;
    companyAccountId?: string | null;
    role: z.infer<typeof roleSchema>;
}) {
    const memberOr: any[] = [{ email }];
    if (companyAccountId) memberOr.push({ companyAccountId });

    await tx.companyTeamMember.updateMany({
        where: {
            companyId,
            status: { not: "removed" },
            OR: memberOr,
        },
        data: { role },
    });

    const invitationOr: any[] = [{ email }];
    if (companyAccountId) invitationOr.push({ acceptedByCompanyAccountId: companyAccountId });

    await tx.companyTeamInvitation.updateMany({
        where: {
            companyId,
            status: "pending",
            OR: invitationOr,
        },
        data: { role },
    });
}

function fullNameFromUserMetadata(userMeta: Record<string, unknown> | undefined, fallbackEmail: string): string {
    if (typeof userMeta?.full_name === "string" && userMeta.full_name.trim()) return userMeta.full_name.trim();
    if (typeof userMeta?.name === "string" && userMeta.name.trim()) return userMeta.name.trim();
    return fallbackEmail.split("@")[0] || "Team member";
}

function memberInclude() {
    return {
        account: {
            select: {
                id: true,
                email: true,
                fullName: true,
                avatarUrl: true,
            },
        },
        invitation: {
            select: {
                id: true,
                status: true,
                expiresAt: true,
                acceptedAt: true,
            },
        },
    };
}

function serializeMember(member: any) {
    return {
        id: member.id,
        companyAccountId: member.companyAccountId,
        invitationId: member.invitationId,
        email: member.email,
        name: member.account?.fullName || member.nameHint || member.email.split("@")[0],
        avatarUrl: member.account?.avatarUrl || null,
        role: member.role,
        status: member.status,
        joinedAt: member.joinedAt?.toISOString?.() || null,
        createdAt: member.createdAt?.toISOString?.() || null,
        invitation: member.invitation
            ? {
                id: member.invitation.id,
                status: member.invitation.status,
                expiresAt: member.invitation.expiresAt?.toISOString?.() || null,
                acceptedAt: member.invitation.acceptedAt?.toISOString?.() || null,
            }
            : null,
    };
}

function serializeTeam(team: any) {
    const members = (team.members || []).map(serializeMember);
    return {
        id: team.id,
        name: team.name,
        description: team.description,
        avatarColor: team.avatarColor,
        createdAt: team.createdAt?.toISOString?.() || null,
        updatedAt: team.updatedAt?.toISOString?.() || null,
        members,
        counts: {
            total: members.filter((member: any) => member.status !== "removed").length,
            active: members.filter((member: any) => member.status === "active").length,
            pending: members.filter((member: any) => member.status === "pending_invite").length,
        },
    };
}

async function addMemberInTransaction({
    tx,
    company,
    team,
    input,
}: {
    tx: any;
    company: CompanyWorkspaceAccess;
    team: any;
    input: z.infer<typeof memberInputSchema>;
}): Promise<{ member: any; delivery: "added" | "invited"; email: QueuedTeamEmail }> {
    const existingMember = await tx.companyTeamMember.findFirst({
        where: { teamId: team.id, email: input.email },
        include: memberInclude(),
    });

    if (existingMember && existingMember.status !== "removed") {
        throw routeError(409, "Member Already Exists", "This email is already on the selected team.");
    }

    const companyAccount = await tx.companyMemberAccount.findUnique({
        where: { email: input.email },
        select: { id: true, email: true, fullName: true, avatarUrl: true, emailVerified: true },
    });

    const existingCompanyRole = await resolveCompanyWideTeamRole({
        tx,
        companyId: company.id,
        email: input.email,
        companyAccountId: companyAccount?.id,
    });
    const assignedRole = existingCompanyRole || input.role;

    if (!existingCompanyRole && !canAssignTeamRole(company.role, assignedRole)) {
        throw routeError(403, "Forbidden", "Members can add teammates as member or viewer, but cannot assign admin access.");
    }

    if (companyAccount?.emailVerified) {
        const data = {
            companyId: company.id,
            teamId: team.id,
            companyAccountId: companyAccount.id,
            invitationId: null,
            email: input.email,
            nameHint: input.nameHint || null,
            role: assignedRole,
            status: "active",
            joinedAt: new Date(),
            addedById: company.id,
        };

        const member = existingMember
            ? await tx.companyTeamMember.update({
                where: { id: existingMember.id },
                data,
                include: memberInclude(),
            })
            : await tx.companyTeamMember.create({
                data,
                include: memberInclude(),
            });

        await syncCompanyWideTeamRole({
            tx,
            companyId: company.id,
            email: input.email,
            companyAccountId: companyAccount.id,
            role: assignedRole,
        });

        return {
            member,
            delivery: "added",
            email: {
                kind: "added",
                to: input.email,
                companyName: company.name,
                teamName: team.name,
                role: assignedRole,
                message: input.message,
            },
        };
    }

    const token = createInvitationToken();
    const invitation = await tx.companyTeamInvitation.create({
        data: {
            companyId: company.id,
            teamId: team.id,
            invitedById: company.id,
            email: input.email,
            tokenHash: hashInvitationToken(token),
            role: assignedRole,
            status: "pending",
            expiresAt: invitationExpiryDate(),
            metadata: {
                nameHint: input.nameHint || null,
                hasMessage: Boolean(input.message?.trim()),
            },
        },
    });

    const data = {
        companyId: company.id,
        teamId: team.id,
        companyAccountId: null,
        invitationId: invitation.id,
        email: input.email,
        nameHint: input.nameHint || null,
        role: assignedRole,
        status: "pending_invite",
        joinedAt: null,
        addedById: company.id,
    };

    const member = existingMember
        ? await tx.companyTeamMember.update({
            where: { id: existingMember.id },
            data,
            include: memberInclude(),
        })
        : await tx.companyTeamMember.create({
            data,
            include: memberInclude(),
        });

    await syncCompanyWideTeamRole({
        tx,
        companyId: company.id,
        email: input.email,
        companyAccountId: null,
        role: assignedRole,
    });

    return {
        member,
        delivery: "invited",
        email: {
            kind: "invitation",
            to: input.email,
            companyName: company.name,
            teamName: team.name,
            role: assignedRole,
            token,
            message: input.message,
        },
    };
}

async function sendQueuedEmail(email: QueuedTeamEmail, fastify: FastifyInstance) {
    try {
        if (email.kind === "invitation") {
            await sendTeamInvitationEmail(email);
        } else {
            await sendTeamAddedEmail(email);
        }
        return true;
    } catch (err) {
        fastify.log.warn(sanitizeForLog(err), "Failed to send team notification email");
        return false;
    }
}

function handleRouteError(err: unknown, reply: FastifyReply, fastify: FastifyInstance) {
    if (err instanceof RouteError) {
        return reply.status(err.statusCode).send(err.payload);
    }

    fastify.log.error(sanitizeForLog(err), "Company team route failed");
    return reply.status(500).send({
        error: "Internal Server Error",
        message: "Internal Server Error. Please check your connection and try again.",
    });
}

export default async function companyTeamRoutes(fastify: FastifyInstance) {
    const companyPreHandler = [fastify.authenticate, requireCompanyWorkspaceAccess];

    fastify.get("/companies/teams", { preHandler: companyPreHandler }, async (request, reply) => {
        const companyId = request.company!.id;
        const rl = checkRateLimit(`companies:teams:list:${companyId}`, 120, 60_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Too many requests. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const canManageTeams = isCompanyAdminRole(request.company!.role);
        const teams = await companyTeam.findMany({
            where: {
                companyId,
                isArchived: false,
                ...(canManageTeams ? {} : {
                    members: {
                        some: {
                            companyAccountId: request.user!.id,
                            status: "active",
                        },
                    },
                }),
            },
            orderBy: { createdAt: "asc" },
            include: {
                members: {
                    where: { status: { not: "removed" } },
                    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
                    include: memberInclude(),
                },
            },
        });

        return { teams: teams.map(serializeTeam) };
    });

    fastify.post("/companies/teams", { preHandler: companyPreHandler }, async (request, reply) => {
        const company = request.company!;
        if (!canInviteTeamMembers(company.role)) {
            return reply.status(403).send({
                error: "Forbidden",
                message: "Only company owners, admins, and members can create teams.",
            });
        }

        const rl = checkRateLimit(`companies:teams:create:${company.id}`, 30, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Team creation limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const parsed = createTeamSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send(validationPayload(parsed.error));
        }

        try {
            const queuedEmails: QueuedTeamEmail[] = [];
            const team = await prisma.$transaction(async (tx: any) => {
                const createdTeam = await tx.companyTeam.create({
                    data: {
                        companyId: company.id,
                        name: parsed.data.name,
                        description: parsed.data.description || null,
                        avatarColor: parsed.data.avatarColor || null,
                        createdById: company.id,
                    },
                });

                if (company.role === "member") {
                    const creatorEmail = normalizeTeamEmail(request.user!.email!);
                    await tx.companyTeamMember.create({
                        data: {
                            companyId: company.id,
                            teamId: createdTeam.id,
                            companyAccountId: request.user!.id,
                            invitationId: null,
                            email: creatorEmail,
                            nameHint: fullNameFromUserMetadata(request.user?.user_metadata, creatorEmail),
                            role: "member",
                            status: "active",
                            joinedAt: new Date(),
                            addedById: company.id,
                        },
                    });
                }

                if (parsed.data.initialMember) {
                    const result = await addMemberInTransaction({
                        tx,
                        company,
                        team: createdTeam,
                        input: parsed.data.initialMember,
                    });
                    queuedEmails.push(result.email);
                }

                return tx.companyTeam.findUnique({
                    where: { id: createdTeam.id },
                    include: {
                        members: {
                            where: { status: { not: "removed" } },
                            orderBy: [{ status: "asc" }, { createdAt: "asc" }],
                            include: memberInclude(),
                        },
                    },
                });
            });

            const emailResults = await Promise.all(queuedEmails.map((email) => sendQueuedEmail(email, fastify)));
            return reply.status(201).send({
                team: serializeTeam(team),
                emailQueued: emailResults.every(Boolean),
            });
        } catch (err) {
            return handleRouteError(err, reply, fastify);
        }
    });

    fastify.post("/companies/teams/:id/members", { preHandler: companyPreHandler }, async (request, reply) => {
        const company = request.company!;
        if (!canInviteTeamMembers(company.role)) {
            return reply.status(403).send({
                error: "Forbidden",
                message: "Only company owners, admins, and members can add team members.",
            });
        }

        const rl = checkRateLimit(`companies:teams:add-member:${company.id}`, 60, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Member invitation limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const params = teamParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send(validationPayload(params.error));
        }

        const parsed = memberInputSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send(validationPayload(parsed.error));
        }

        try {
            const result = await prisma.$transaction(async (tx: any) => {
                const team = await tx.companyTeam.findFirst({
                    where: {
                        id: params.data.id,
                        companyId: company.id,
                        isArchived: false,
                        ...(isCompanyAdminRole(company.role)
                            ? {}
                            : {
                                members: {
                                    some: {
                                        companyAccountId: request.user!.id,
                                        status: "active",
                                    },
                                },
                            }),
                    },
                });

                if (!team) {
                    throw routeError(404, "Team Not Found", "The selected team was not found.");
                }

                return addMemberInTransaction({
                    tx,
                    company,
                    team,
                    input: parsed.data,
                });
            });

            const emailQueued = await sendQueuedEmail(result.email, fastify);
            return reply.status(201).send({
                member: serializeMember(result.member),
                delivery: result.delivery,
                emailQueued,
            });
        } catch (err) {
            return handleRouteError(err, reply, fastify);
        }
    });

    fastify.patch("/companies/teams/:teamId/members/:memberId", { preHandler: companyPreHandler }, async (request, reply) => {
        const company = request.company!;
        if (!isCompanyAdminRole(company.role)) {
            return reply.status(403).send({
                error: "Forbidden",
                message: "Only company owners and admins can change member roles.",
            });
        }

        const rl = checkRateLimit(`companies:teams:update-role:${company.id}`, 120, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Role update limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const params = teamMemberParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send(validationPayload(params.error));
        }

        const parsed = updateMemberRoleSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send(validationPayload(parsed.error));
        }

        try {
            const member = await prisma.$transaction(async (tx: any) => {
                const existingMember = await tx.companyTeamMember.findFirst({
                    where: {
                        id: params.data.memberId,
                        teamId: params.data.teamId,
                        companyId: company.id,
                        status: { not: "removed" },
                        team: { isArchived: false },
                    },
                    include: memberInclude(),
                });

                if (!existingMember) {
                    throw routeError(404, "Member Not Found", "The selected team member was not found.");
                }

                await syncCompanyWideTeamRole({
                    tx,
                    companyId: company.id,
                    email: existingMember.email,
                    companyAccountId: existingMember.companyAccountId,
                    role: parsed.data.role,
                });

                return tx.companyTeamMember.findUnique({
                    where: { id: existingMember.id },
                    include: memberInclude(),
                });
            });

            return { member: serializeMember(member) };
        } catch (err) {
            return handleRouteError(err, reply, fastify);
        }
    });

    fastify.post("/team-invitations/:token/accept", { preHandler: fastify.authenticate }, async (request, reply) => {
        const companyAccountId = request.user!.id;
        const userEmail = request.user!.email;

        const rl = checkRateLimit(`team-invitations:accept:${companyAccountId}`, 20, 900_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Too many attempts. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const params = acceptInviteParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send(validationPayload(params.error));
        }

        const tokenHash = hashInvitationToken(params.data.token);
        const invitation = await companyTeamInvitation.findUnique({
            where: { tokenHash },
            select: {
                id: true,
                email: true,
                status: true,
                expiresAt: true,
                acceptedByCompanyAccountId: true,
                team: {
                    select: { id: true, name: true },
                },
            },
        });

        if (!invitation) {
            return reply.status(400).send({ error: "Invalid Invitation", message: "This invitation is invalid or expired." });
        }

        let companyAccount = await (prisma as any).companyMemberAccount.findUnique({
            where: { id: companyAccountId },
            select: { id: true, email: true },
        });

        if (companyAccount && invitation.status === "accepted" && invitation.acceptedByCompanyAccountId === companyAccount.id) {
            return {
                success: true,
                linkedCount: 0,
                teams: invitation.team ? [invitation.team] : [],
            };
        }

        if (invitation.status !== "pending" || invitation.expiresAt.getTime() <= Date.now()) {
            return reply.status(400).send({ error: "Invalid Invitation", message: "This invitation is invalid or expired." });
        }

        if (!companyAccount) {
            const userMeta = request.user?.user_metadata || {};
            const fullName =
                typeof userMeta.full_name === "string"
                    ? userMeta.full_name
                    : typeof userMeta.name === "string"
                        ? userMeta.name
                        : userEmail?.split("@")[0] || invitation.email.split("@")[0] || "Team member";

            companyAccount = await (prisma as any).companyMemberAccount.create({
                data: {
                    id: companyAccountId,
                    email: normalizeTeamEmail(userEmail || invitation.email),
                    fullName,
                    emailVerified: true,
                    emailVerifiedAt: new Date(),
                },
                select: { id: true, email: true },
            });
        }

        const result = await linkPendingTeamInvitationsForCompanyAccount({
            companyAccountId: companyAccount.id,
            email: companyAccount.email || userEmail,
            token: params.data.token,
        });

        return {
            success: true,
            linkedCount: result.linkedCount,
            teams: result.teams,
        };
    });
}
