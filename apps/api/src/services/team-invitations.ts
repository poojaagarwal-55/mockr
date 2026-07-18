import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { sendEmail } from "../lib/email.js";

const INVITATION_EXPIRY_DAYS = 7;

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function companyPortalBaseUrl(): string {
    const explicit =
        process.env.COMPANY_FRONTEND_URL ||
        process.env.NEXT_PUBLIC_COMPANY_URL;

    if (explicit) {
        return explicit.replace(/\/$/, "");
    }

    const fallback = (process.env.FRONTEND_URL || "http://localhost:3003").replace(/\/$/, "");
    return fallback.endsWith("/companies") ? fallback : `${fallback}/companies`;
}

export function normalizeTeamEmail(email: string): string {
    return email.trim().toLowerCase();
}

export function createInvitationToken(): string {
    return randomBytes(32).toString("base64url");
}

export function hashInvitationToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

export function invitationExpiryDate(now = new Date()): Date {
    return new Date(now.getTime() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

export async function sendTeamInvitationEmail({
    to,
    companyName,
    teamName,
    role,
    token,
    message,
}: {
    to: string;
    companyName: string;
    teamName: string;
    role: string;
    token: string;
    message?: string | null;
}) {
    const acceptUrl = `${companyPortalBaseUrl()}/invite/accept?token=${encodeURIComponent(token)}`;
    const safeCompany = escapeHtml(companyName);
    const safeTeam = escapeHtml(teamName);
    const safeRole = escapeHtml(role);
    const safeMessage = message?.trim() ? `<p style="margin:16px 0;color:#334155;">${escapeHtml(message.trim())}</p>` : "";

    await sendEmail({
        to,
        subject: `${companyName} invited you to ${teamName} on Practers`,
        isAuthEmail: true,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#0f172a;">
                <h2 style="color:#4A7CFF;margin-bottom:8px;">Join ${safeTeam}</h2>
                <p style="margin:0 0 16px;color:#334155;">${safeCompany} added you as a ${safeRole} on their Practers team.</p>
                ${safeMessage}
                <a href="${acceptUrl}" style="display:inline-block;background:#4A7CFF;color:#fff;text-decoration:none;border-radius:8px;padding:12px 18px;font-weight:700;">Accept invitation</a>
                <p style="margin-top:18px;color:#64748b;font-size:13px;">This invitation expires in ${INVITATION_EXPIRY_DAYS} days. If you did not expect this email, you can ignore it.</p>
            </div>
        `,
    });
}

export async function sendTeamAddedEmail({
    to,
    companyName,
    teamName,
    role,
    message,
}: {
    to: string;
    companyName: string;
    teamName: string;
    role: string;
    message?: string | null;
}) {
    const safeCompany = escapeHtml(companyName);
    const safeTeam = escapeHtml(teamName);
    const safeRole = escapeHtml(role);
    const safeMessage = message?.trim() ? `<p style="margin:16px 0;color:#334155;">${escapeHtml(message.trim())}</p>` : "";

    await sendEmail({
        to,
        subject: `You've been added to ${teamName} on Practers`,
        isAuthEmail: true,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#0f172a;">
                <h2 style="color:#4A7CFF;margin-bottom:8px;">You're in ${safeTeam}</h2>
                <p style="margin:0 0 16px;color:#334155;">${safeCompany} added you as a ${safeRole}. The team will appear in the company workspace the next time you sign in.</p>
                ${safeMessage}
                <a href="${companyPortalBaseUrl()}/login" style="display:inline-block;background:#4A7CFF;color:#fff;text-decoration:none;border-radius:8px;padding:12px 18px;font-weight:700;">Open company workspace</a>
            </div>
        `,
    });
}

export async function linkPendingTeamInvitationsForCompanyAccount({
    companyAccountId,
    email,
    token,
    prismaClient = prisma,
}: {
    companyAccountId: string;
    email?: string | null;
    token?: string | null;
    prismaClient?: any;
}) {
    const normalizedEmail = email ? normalizeTeamEmail(email) : null;
    const tokenHash = token ? hashInvitationToken(token) : null;
    const orFilters = [
        normalizedEmail ? { email: normalizedEmail } : null,
        tokenHash ? { tokenHash } : null,
    ].filter(Boolean);

    if (!orFilters.length) {
        return { linkedCount: 0, teams: [] as Array<{ id: string; name: string }> };
    }

    const now = new Date();

    return prismaClient.$transaction(async (tx: any) => {
        const invitations = await tx.companyTeamInvitation.findMany({
            where: {
                status: "pending",
                expiresAt: { gt: now },
                OR: orFilters,
            },
            include: {
                team: {
                    select: { id: true, name: true },
                },
            },
        });

        const linkedTeams: Array<{ id: string; name: string }> = [];

        for (const invitation of invitations) {
            const roleSource = await tx.companyTeamMember.findFirst({
                where: {
                    companyId: invitation.companyId,
                    status: "active",
                    OR: [
                        { companyAccountId },
                        { email: normalizedEmail || invitation.email },
                    ],
                },
                orderBy: [
                    { joinedAt: "asc" },
                    { createdAt: "asc" },
                ],
                select: { role: true },
            });
            const companyWideRole = roleSource?.role || invitation.role;

            const member = await tx.companyTeamMember.findFirst({
                where: { invitationId: invitation.id },
            });

            const existingActiveMember = await tx.companyTeamMember.findFirst({
                where: {
                    teamId: invitation.teamId,
                    companyAccountId,
                    status: { not: "removed" },
                },
            });

            if (existingActiveMember) {
                await tx.companyTeamInvitation.update({
                    where: { id: invitation.id },
                    data: {
                        status: "accepted",
                        acceptedAt: now,
                        acceptedByCompanyAccountId: companyAccountId,
                    },
                });
                await tx.companyTeamMember.updateMany({
                    where: {
                        companyId: invitation.companyId,
                        status: { not: "removed" },
                        OR: [
                            { companyAccountId },
                            { email: normalizedEmail || invitation.email },
                        ],
                    },
                    data: { role: companyWideRole },
                });
                await tx.companyTeamInvitation.updateMany({
                    where: {
                        companyId: invitation.companyId,
                        status: "pending",
                        email: normalizedEmail || invitation.email,
                    },
                    data: { role: companyWideRole },
                });
                continue;
            }

            if (member) {
                await tx.companyTeamMember.update({
                    where: { id: member.id },
                    data: {
                        companyAccountId,
                        role: companyWideRole,
                        status: "active",
                        joinedAt: member.joinedAt || now,
                    },
                });
            } else {
                await tx.companyTeamMember.create({
                    data: {
                        companyId: invitation.companyId,
                        teamId: invitation.teamId,
                        companyAccountId,
                        invitationId: invitation.id,
                        email: normalizedEmail || invitation.email,
                        role: companyWideRole,
                        status: "active",
                        joinedAt: now,
                        addedById: invitation.invitedById,
                    },
                });
            }

            await tx.companyTeamInvitation.update({
                where: { id: invitation.id },
                data: {
                    status: "accepted",
                    acceptedAt: now,
                    acceptedByCompanyAccountId: companyAccountId,
                },
            });

            await tx.companyTeamMember.updateMany({
                where: {
                    companyId: invitation.companyId,
                    status: { not: "removed" },
                    OR: [
                        { companyAccountId },
                        { email: normalizedEmail || invitation.email },
                    ],
                },
                data: { role: companyWideRole },
            });
            await tx.companyTeamInvitation.updateMany({
                where: {
                    companyId: invitation.companyId,
                    status: "pending",
                    email: normalizedEmail || invitation.email,
                },
                data: { role: companyWideRole },
            });

            linkedTeams.push(invitation.team);
        }

        return { linkedCount: linkedTeams.length, teams: linkedTeams };
    });
}
