import { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../lib/prisma.js";
import { linkPendingTeamInvitationsForCompanyAccount, normalizeTeamEmail } from "../services/team-invitations.js";

export type CompanyWorkspaceRole = "owner" | "admin" | "member" | "viewer";
export type CompanyWorkspaceAccessType = "owner" | "team_member";

export type CompanyWorkspaceAccess = {
    id: string;
    email: string;
    name: string;
    domain: string;
    contactName?: string | null;
    websiteUrl?: string | null;
    logoUrl?: string | null;
    industry?: string | null;
    companySize?: string | null;
    headquarters?: string | null;
    defaultTimezone?: string;
    defaultWorkMode?: string;
    defaultEmploymentType?: string;
    defaultCurrency?: string;
    defaultAssessmentDeadlineDays?: number;
    notifyNewApplications?: boolean;
    notifyAssessmentSubmissions?: boolean;
    notifyWeeklyDigest?: boolean;
    notifyTeamChanges?: boolean;
    emailVerified?: boolean;
    role: CompanyWorkspaceRole;
    accessType: CompanyWorkspaceAccessType;
    membershipId?: string;
    teamId?: string;
};

declare module "fastify" {
    interface FastifyRequest {
        company: CompanyWorkspaceAccess | null;
    }
}

function isCompanyOwnerSession(userEmail: string | undefined, companyEmail: string): boolean {
    return Boolean(userEmail && companyEmail.toLowerCase() === userEmail.toLowerCase());
}

const companyAccessSelect = {
    id: true,
    email: true,
    name: true,
    domain: true,
    contactName: true,
    websiteUrl: true,
    logoUrl: true,
    industry: true,
    companySize: true,
    headquarters: true,
    defaultTimezone: true,
    defaultWorkMode: true,
    defaultEmploymentType: true,
    defaultCurrency: true,
    defaultAssessmentDeadlineDays: true,
    notifyNewApplications: true,
    notifyAssessmentSubmissions: true,
    notifyWeeklyDigest: true,
    notifyTeamChanges: true,
    emailVerified: true,
};

function companyAccessFields(company: any) {
    return {
        id: company.id,
        email: company.email,
        name: company.name,
        domain: company.domain,
        contactName: company.contactName,
        websiteUrl: company.websiteUrl,
        logoUrl: company.logoUrl,
        industry: company.industry,
        companySize: company.companySize,
        headquarters: company.headquarters,
        defaultTimezone: company.defaultTimezone,
        defaultWorkMode: company.defaultWorkMode,
        defaultEmploymentType: company.defaultEmploymentType,
        defaultCurrency: company.defaultCurrency,
        defaultAssessmentDeadlineDays: company.defaultAssessmentDeadlineDays,
        notifyNewApplications: company.notifyNewApplications,
        notifyAssessmentSubmissions: company.notifyAssessmentSubmissions,
        notifyWeeklyDigest: company.notifyWeeklyDigest,
        notifyTeamChanges: company.notifyTeamChanges,
        emailVerified: company.emailVerified,
    };
}

export async function findCompanyWorkspaceAccess({
    userId,
    userEmail,
    fullNameHint,
}: {
    userId: string;
    userEmail?: string | null;
    fullNameHint?: string | null;
}): Promise<CompanyWorkspaceAccess | null> {
    const normalizedEmail = userEmail?.toLowerCase();

    const ownerCompany = await (prisma as any).company.findUnique({
        where: { id: userId },
        select: companyAccessSelect,
    });

    if (ownerCompany && ownerCompany.emailVerified && isCompanyOwnerSession(normalizedEmail, ownerCompany.email)) {
        return {
            ...companyAccessFields(ownerCompany),
            role: "owner",
            accessType: "owner",
        };
    }

    let companyAccount = await (prisma as any).companyMemberAccount.findUnique({
        where: { id: userId },
        select: { id: true, email: true, fullName: true, emailVerified: true },
    });

    if (!companyAccount && normalizedEmail) {
        const pendingInvite = await (prisma as any).companyTeamInvitation.findFirst({
            where: {
                email: normalizeTeamEmail(normalizedEmail),
                status: "pending",
                expiresAt: { gt: new Date() },
            },
            select: { id: true },
        });

        if (pendingInvite) {
            companyAccount = await (prisma as any).companyMemberAccount.create({
                data: {
                    id: userId,
                    email: normalizeTeamEmail(normalizedEmail),
                    fullName: fullNameHint?.trim() || normalizedEmail.split("@")[0] || "Team member",
                    emailVerified: true,
                    emailVerifiedAt: new Date(),
                },
                select: { id: true, email: true, fullName: true, emailVerified: true },
            });

            await linkPendingTeamInvitationsForCompanyAccount({
                companyAccountId: companyAccount.id,
                email: companyAccount.email,
            });
        }
    }

    if (!companyAccount?.emailVerified) return null;

    const teamMember = await (prisma as any).companyTeamMember.findFirst({
        where: {
            companyAccountId: companyAccount.id,
            status: "active",
            team: {
                isArchived: false,
            },
            company: {
                emailVerified: true,
            },
        },
        orderBy: [
            { joinedAt: "asc" },
            { createdAt: "asc" },
        ],
        include: {
            company: {
                select: companyAccessSelect,
            },
            team: {
                select: {
                    id: true,
                },
            },
        },
    });

    if (!teamMember?.company) return null;

    return {
        ...companyAccessFields(teamMember.company),
        role: teamMember.role,
        accessType: "team_member",
        membershipId: teamMember.id,
        teamId: teamMember.team?.id,
    };
}

export async function requireCompanyWorkspaceAccess(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user?.id;
    const userEmail = request.user?.email?.toLowerCase();

    if (!userId || !userEmail) {
        return reply.status(401).send({ error: "Unauthorized", message: "Company workspace authentication required." });
    }

    const userMeta = request.user?.user_metadata || {};
    const fullNameHint =
        typeof userMeta.full_name === "string"
            ? userMeta.full_name
            : typeof userMeta.name === "string"
                ? userMeta.name
                : null;
    const access = await findCompanyWorkspaceAccess({ userId, userEmail, fullNameHint });

    if (!access) {
        return reply.status(403).send({
            error: "Company Access Required",
            message: "No active company workspace access was found for this account.",
        });
    }

    request.company = access;
}

export function isCompanyAdminRole(role: CompanyWorkspaceRole): boolean {
    return role === "owner" || role === "admin";
}
