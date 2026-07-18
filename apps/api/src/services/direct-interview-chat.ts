import { prisma } from "../lib/prisma.js";
import { findCompanyWorkspaceAccess } from "../companies/access.js";

const directInterview = (prisma as any).directInterview;
const directInterviewMessage = (prisma as any).directInterviewMessage;
const jobRoundCandidate = (prisma as any).jobRoundCandidate;

export type DirectInterviewActorType = "company" | "candidate";

export type DirectInterviewActor = {
    type: DirectInterviewActorType;
    userId: string;
    email?: string | null;
    name: string;
    companyId: string;
    role?: string | null;
    companyTeamMemberId?: string | null;
};

export type DirectInterviewMessage = {
    id: string;
    senderType: DirectInterviewActorType;
    senderId: string;
    senderName: string;
    content: string;
    createdAt: string;
    readByCompanyAt?: string | null;
    readByCandidateAt?: string | null;
};

export const DIRECT_INTERVIEW_ROOM_PREFIX = "direct_interview:";

export function directInterviewRoom(roundCandidateId: string) {
    return `${DIRECT_INTERVIEW_ROOM_PREFIX}${roundCandidateId}`;
}

export function toRecord(value: unknown): Record<string, any> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function directInterviewMetadata(metadata: unknown) {
    return toRecord(toRecord(metadata).directInterview);
}

function fullNameFromUserMetadata(userMeta: Record<string, unknown> | undefined, fallback: string) {
    if (typeof userMeta?.full_name === "string" && userMeta.full_name.trim()) return userMeta.full_name.trim();
    if (typeof userMeta?.name === "string" && userMeta.name.trim()) return userMeta.name.trim();
    return fallback;
}

function selectedFromCandidate(candidate: any) {
    const metadata = toRecord(candidate.metadata);
    const roundConfig = toRecord(candidate.round?.config);
    if (metadata.sourceAssignmentId) return "technical_assignment";
    return typeof roundConfig.source === "string" && roundConfig.source.trim()
        ? roundConfig.source.trim()
        : "application_review";
}

function statusFromCandidate(candidate: any) {
    const direct = directInterviewMetadata(candidate.metadata);
    if (direct.schedule?.scheduledAt) return "scheduled";
    return "shortlisted";
}

export function toDirectInterviewMessage(row: any): DirectInterviewMessage {
    const readAt = row.readAt?.toISOString?.() || null;
    return {
        id: row.id,
        senderType: row.senderType === "candidate" ? "candidate" : "company",
        senderId: row.senderCompanyMemberId || row.senderUserId || "",
        senderName: row.senderName || "Practers",
        content: row.body || "",
        createdAt: row.createdAt?.toISOString?.() || new Date().toISOString(),
        readByCompanyAt: row.senderType === "candidate" ? readAt : row.createdAt?.toISOString?.() || null,
        readByCandidateAt: row.senderType === "company" ? readAt : row.createdAt?.toISOString?.() || null,
    };
}

export function unreadDirectInterviewCount(messages: any[] | undefined, actorType: DirectInterviewActorType) {
    return (messages || []).filter((message) => {
        if (actorType === "company") return message.senderType === "candidate" && !message.readAt;
        return message.senderType === "company" && !message.readAt;
    }).length;
}

export async function ensureDirectInterviewForRoundCandidate(roundCandidateId: string) {
    const existing = await directInterview.findFirst({
        where: {
            jobRoundCandidateId: roundCandidateId,
            round: { roundType: "final_interview" },
        },
        include: directInterviewInclude(),
    });
    if (existing) return existing;

    const candidate = await jobRoundCandidate.findFirst({
        where: {
            id: roundCandidateId,
            round: { roundType: "final_interview" },
        },
        include: {
            round: {
                select: {
                    id: true,
                    companyId: true,
                    jobId: true,
                    config: true,
                },
            },
        },
    });
    if (!candidate?.round) return null;

    return directInterview.create({
        data: {
            jobRoundCandidateId: candidate.id,
            companyId: candidate.round.companyId,
            jobId: candidate.round.jobId,
            applicationId: candidate.applicationId,
            roundId: candidate.round.id,
            candidateUserId: candidate.userId,
            status: statusFromCandidate(candidate),
            selectedFrom: selectedFromCandidate(candidate),
            score: Math.max(0, Math.min(100, Number(candidate.score || 0))),
        },
        include: directInterviewInclude(),
    });
}

export async function ensureDirectInterviewRowsForCompany(companyId: string) {
    const candidates = await jobRoundCandidate.findMany({
        where: {
            round: {
                companyId,
                roundType: "final_interview",
            },
            directInterview: null,
        },
        select: {
            id: true,
            applicationId: true,
            userId: true,
            status: true,
            score: true,
            metadata: true,
            round: {
                select: {
                    id: true,
                    companyId: true,
                    jobId: true,
                    config: true,
                },
            },
        },
    });

    if (!candidates.length) return;

    const rows = candidates
        .filter((candidate: any) => candidate.round)
        .map((candidate: any) => ({
            jobRoundCandidateId: candidate.id,
            companyId: candidate.round.companyId,
            jobId: candidate.round.jobId,
            applicationId: candidate.applicationId,
            roundId: candidate.round.id,
            candidateUserId: candidate.userId,
            status: statusFromCandidate(candidate),
            selectedFrom: selectedFromCandidate(candidate),
            score: Math.max(0, Math.min(100, Number(candidate.score || 0))),
        }));

    if (!rows.length) return;

    await directInterview.createMany({
        data: rows,
        skipDuplicates: true,
    });
}

export function directInterviewInclude() {
    return {
        interviewer: {
            select: {
                id: true,
                companyAccountId: true,
                role: true,
                account: {
                    select: {
                        fullName: true,
                        email: true,
                    },
                },
            },
        },
        jobRoundCandidate: {
            select: {
                id: true,
                userId: true,
                roundId: true,
                applicationId: true,
                status: true,
                score: true,
                metadata: true,
                user: {
                    select: {
                        id: true,
                        email: true,
                        fullName: true,
                    },
                },
            },
        },
    };
}

async function findDirectInterview(roundCandidateId: string) {
    return ensureDirectInterviewForRoundCandidate(roundCandidateId);
}

function canUseCompanyDirectInterviewChat(company: any, interview: any) {
    if (!company || company.id !== interview.companyId || company.role === "viewer") return false;
    return company.role === "owner" || company.role === "admin" || company.role === "member";
}

export async function authorizeDirectInterviewParticipant({
    roundCandidateId,
    userId,
    userEmail,
    userMetadata,
}: {
    roundCandidateId: string;
    userId: string;
    userEmail?: string | null;
    userMetadata?: Record<string, unknown>;
}): Promise<{ interview: any; actor: DirectInterviewActor } | null> {
    const interview = await findDirectInterview(roundCandidateId);
    if (!interview) return null;

    if (interview.candidateUserId === userId) {
        return {
            interview,
            actor: {
                type: "candidate",
                userId,
                email: interview.jobRoundCandidate?.user?.email || userEmail || null,
                name: interview.jobRoundCandidate?.user?.fullName || fullNameFromUserMetadata(userMetadata, "Candidate"),
                companyId: interview.companyId,
                role: "candidate",
            },
        };
    }

    const company = await findCompanyWorkspaceAccess({
        userId,
        userEmail,
        fullNameHint: fullNameFromUserMetadata(userMetadata, userEmail || "Team member"),
    });

    if (!canUseCompanyDirectInterviewChat(company, interview)) return null;

    return {
        interview,
        actor: {
            type: "company",
            userId,
            email: userEmail || null,
            name: fullNameFromUserMetadata(userMetadata, company!.name),
            companyId: company!.id,
            role: company!.role,
            companyTeamMemberId: company!.membershipId || null,
        },
    };
}

export async function appendDirectInterviewMessage({
    interview,
    actor,
    content,
}: {
    interview: any;
    actor: DirectInterviewActor;
    content: string;
}) {
    const message = await directInterviewMessage.create({
        data: {
            directInterviewId: interview.id,
            senderType: actor.type,
            senderCompanyMemberId: actor.type === "company" ? actor.companyTeamMemberId || null : null,
            senderUserId: actor.type === "candidate" ? actor.userId : null,
            senderName: actor.name,
            body: content.trim(),
            readAt: null,
        },
    });

    return toDirectInterviewMessage(message);
}

export async function markDirectInterviewMessagesRead({
    interview,
    actor,
}: {
    interview: any;
    actor: DirectInterviewActor;
}) {
    await directInterviewMessage.updateMany({
        where: {
            directInterviewId: interview.id,
            senderType: actor.type === "company" ? "candidate" : "company",
            readAt: null,
        },
        data: { readAt: new Date() },
    });

    const messages = await directInterviewMessage.findMany({
        where: { directInterviewId: interview.id },
        orderBy: { createdAt: "asc" },
    });

    return messages.map(toDirectInterviewMessage);
}
