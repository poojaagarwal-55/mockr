import { FastifyInstance, FastifyReply } from "fastify";
import mongoose from "mongoose";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { connectMongoDB } from "../lib/mongodb.js";
import { checkRateLimit } from "../lib/rate-limiter.js";
import { sanitizeForLog } from "../lib/log-utils.js";
import { isCompanyAdminRole, requireCompanyWorkspaceAccess } from "./access.js";
import { storedOrBuiltRecruiterReport } from "./jobs.js";
import {
    appendDirectInterviewMessage,
    ensureDirectInterviewForRoundCandidate,
    ensureDirectInterviewRowsForCompany,
    markDirectInterviewMessagesRead,
    toDirectInterviewMessage,
    toRecord,
    unreadDirectInterviewCount,
    type DirectInterviewActor,
} from "../services/direct-interview-chat.js";
import {
    COMPANY_QUESTION_BANK_MODELS,
    COMPANY_QUESTION_BANK_TYPES,
    CompanyQuestionSet,
    type CompanyQuestionBankType,
} from "../models/CompanyQuestionBank.js";

const directInterview = (prisma as any).directInterview;
const directInterviewMessage = (prisma as any).directInterviewMessage;
const jobRoundCandidate = (prisma as any).jobRoundCandidate;
const jobApplyProfile = (prisma as any).jobApplyProfile;
const companyTeamMember = (prisma as any).companyTeamMember;

const paramsSchema = z.object({
    candidateId: z.string().uuid(),
});
const optionalText = (max: number) =>
    z.preprocess(
        (value) => (typeof value === "string" && value.trim() === "" ? null : value),
        z.string().trim().max(max).optional().nullable()
    );
const optionalUrl = z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(2000).url().optional().nullable()
);
const scheduleSchema = z.object({
    scheduledAt: z.string().datetime(),
    timezone: z.string().trim().min(1).max(80).optional(),
    durationMinutes: z.coerce.number().int().min(15).max(480).default(45),
    mode: z.enum(["video", "phone", "onsite"]).default("video"),
    meetingLink: optionalUrl,
    location: optionalText(400),
    notes: optionalText(1000),
});
const interviewerSchema = z.object({
    interviewerMemberId: z.string().uuid(),
    questionSetIds: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
    questionIds: z.array(z.string().trim().min(1).max(120)).max(60).default([]),
    notes: optionalText(1000),
});
const messageSchema = z.object({
    content: z.string().trim().min(1).max(4000),
    clientMessageId: z.string().trim().min(1).max(120).optional(),
});

function validationPayload(error: z.ZodError) {
    const first = error.issues[0];
    return {
        error: "Validation Error",
        message: first ? `${first.path.join(".") || "body"}: ${first.message}` : "Fix the highlighted fields.",
        details: error.flatten().fieldErrors,
    };
}

async function requireDirectInterviewAccess(request: any, reply: FastifyReply) {
    if (request.company?.role === "viewer") {
        return reply.status(403).send({
            error: "Forbidden",
            message: "You don't have access to Direct Interviews. Ask a company owner or admin to change your team role.",
        });
    }
}

function actorFromCompanyRequest(request: any): DirectInterviewActor {
    const userMeta = request.user?.user_metadata || {};
    const fullName =
        typeof userMeta.full_name === "string" && userMeta.full_name.trim()
            ? userMeta.full_name.trim()
            : typeof userMeta.name === "string" && userMeta.name.trim()
                ? userMeta.name.trim()
                : request.company!.name;

    return {
        type: "company",
        userId: request.user!.id,
        email: request.user!.email || null,
        name: fullName,
        companyId: request.company!.id,
        role: request.company!.role,
        companyTeamMemberId: request.company!.membershipId || null,
    };
}

function directInterviewFullInclude() {
    return {
        job: {
            select: {
                id: true,
                title: true,
                companyName: true,
                companyLogoUrl: true,
                location: true,
                status: true,
                skills: true,
                responsibilities: true,
                requirements: true,
                scoringConfig: true,
            },
        },
        round: {
            select: {
                id: true,
                roundNumber: true,
                roundType: true,
                title: true,
                status: true,
                createdAt: true,
                config: true,
            },
        },
        interviewer: {
            include: {
                account: { select: { fullName: true, email: true, avatarUrl: true } },
                team: { select: { id: true, name: true } },
            },
        },
        candidate: {
            select: {
                id: true,
                fullName: true,
                email: true,
                username: true,
                avatarUrl: true,
                location: true,
                website: true,
                githubUrl: true,
                linkedinUrl: true,
            },
        },
        jobRoundCandidate: {
            include: {
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        username: true,
                        avatarUrl: true,
                        location: true,
                        website: true,
                        githubUrl: true,
                        linkedinUrl: true,
                    },
                },
                application: {
                    select: {
                        id: true,
                        status: true,
                        submittedAt: true,
                        nextRoundType: true,
                        nextRoundMovedAt: true,
                        recruiterReport: true,
                    },
                },
                report: {
                    select: {
                        id: true,
                        roundType: true,
                        overallScore: true,
                        evidenceSnapshot: true,
                        rubricBreakdown: true,
                        aiSummary: true,
                        report: true,
                        evaluatedAt: true,
                    },
                },
            },
        },
        questions: {
            include: {
                interviewQuestion: {
                    include: {
                        questionSet: true,
                    },
                },
            },
            orderBy: { createdAt: "asc" },
        },
        messages: {
            orderBy: { createdAt: "asc" },
            select: {
                id: true,
                senderType: true,
                senderCompanyMemberId: true,
                senderUserId: true,
                senderName: true,
                body: true,
                readAt: true,
                createdAt: true,
            },
        },
    };
}

function directInterviewSummaryInclude() {
    return {
        job: {
            select: {
                id: true,
                title: true,
                companyName: true,
                companyLogoUrl: true,
                location: true,
                status: true,
                workMode: true,
                employmentType: true,
                roleType: true,
                profession: true,
                discipline: true,
                travel: true,
                openings: true,
                experienceLevel: true,
                compensationType: true,
                compensation: true,
                duration: true,
                timeCommitment: true,
                applicationDeadline: true,
                skills: true,
                companyOverview: true,
                aboutRole: true,
                responsibilities: true,
                requirements: true,
                benefits: true,
                applicationNote: true,
            },
        },
        round: {
            select: {
                id: true,
                roundNumber: true,
                roundType: true,
                title: true,
                status: true,
                createdAt: true,
            },
        },
        interviewer: {
            include: {
                account: { select: { fullName: true, email: true, avatarUrl: true } },
                team: { select: { id: true, name: true } },
            },
        },
        candidate: {
            select: {
                id: true,
                fullName: true,
                email: true,
                username: true,
                avatarUrl: true,
                location: true,
                website: true,
                githubUrl: true,
                linkedinUrl: true,
            },
        },
        jobRoundCandidate: {
            include: {
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        username: true,
                        avatarUrl: true,
                        location: true,
                        website: true,
                        githubUrl: true,
                        linkedinUrl: true,
                    },
                },
                application: {
                    select: {
                        id: true,
                        status: true,
                        submittedAt: true,
                        nextRoundType: true,
                        nextRoundMovedAt: true,
                    },
                },
                report: {
                    select: {
                        id: true,
                        roundType: true,
                        overallScore: true,
                        evaluatedAt: true,
                    },
                },
            },
        },
    };
}

async function findCompanyDirectInterview(roundCandidateId: string, companyId: string) {
    const existing = await directInterview.findFirst({
        where: {
            jobRoundCandidateId: roundCandidateId,
            companyId,
            round: { roundType: "final_interview" },
        },
        include: directInterviewFullInclude(),
    });
    if (existing) return existing;

    await ensureDirectInterviewForRoundCandidate(roundCandidateId);
    return directInterview.findFirst({
        where: {
            jobRoundCandidateId: roundCandidateId,
            companyId,
            round: { roundType: "final_interview" },
        },
        include: directInterviewFullInclude(),
    });
}

async function findCompanyDirectInterviewForChat(roundCandidateId: string, companyId: string) {
    const existing = await directInterview.findFirst({
        where: {
            jobRoundCandidateId: roundCandidateId,
            companyId,
            round: { roundType: "final_interview" },
        },
        include: {
            interviewer: { select: { id: true, companyAccountId: true } },
        },
    });
    if (existing) return existing;

    await ensureDirectInterviewForRoundCandidate(roundCandidateId);
    return directInterview.findFirst({
        where: {
            jobRoundCandidateId: roundCandidateId,
            companyId,
            round: { roundType: "final_interview" },
        },
        include: {
            interviewer: { select: { id: true, companyAccountId: true } },
        },
    });
}

function assertCanManageInterview(request: any, interview: any, reply: FastifyReply) {
    if (isCompanyAdminRole(request.company!.role)) return true;

    reply.status(403).send({
        error: "Forbidden",
        message: "You don't have access to it. Reach out to your company owner or admin.",
    });
    return false;
}

function assertCanUseInterviewChat(request: any, interview: any, reply: FastifyReply) {
    if (isCompanyAdminRole(request.company!.role) || request.company!.role === "member") return true;

    reply.status(403).send({
        error: "Forbidden",
        message: "You don't have access to it. Reach out to your company owner or admin.",
    });
    return false;
}

function serializeProfile(profile: any) {
    if (!profile) return null;
    return {
        profileLanguage: profile.profileLanguage || "English",
        pronouns: profile.pronouns || "",
        headline: profile.headline || "",
        industry: profile.industry || "",
        city: profile.city || "",
        country: profile.country || "",
        postalCode: profile.postalCode || "",
        location: [profile.city, profile.country].filter(Boolean).join(", "),
        about: profile.about || "",
        openTo: profile.openTo || "",
        coverImageUrl: profile.coverImageUrl || "",
        selectedResumeId: profile.selectedResumeId || null,
        leetcodeUrl: profile.leetcodeUrl || "",
        geeksforgeeksUrl: profile.geeksforgeeksUrl || "",
        codeforcesUrl: profile.codeforcesUrl || "",
        codechefUrl: profile.codechefUrl || "",
        skills: Array.isArray(profile.skills) ? profile.skills : [],
        featured: Array.isArray(profile.featured) ? profile.featured : [],
        experiences: Array.isArray(profile.experiences) ? profile.experiences : [],
        education: Array.isArray(profile.education) ? profile.education : [],
        projects: Array.isArray(profile.projects) ? profile.projects : [],
        isPublished: Boolean(profile.isPublished),
    };
}

function hasRichRecruiterReport(data: Record<string, any>) {
    return Boolean(data.agentSummary || data.projectSlots || data.charts || data.scoringConfig);
}

function serializeReport(report: any, fallbackReport?: any) {
    const stored = toRecord(report?.report);
    const fallback = toRecord(fallbackReport);
    const data = hasRichRecruiterReport(fallback) && !hasRichRecruiterReport(stored)
        ? fallback
        : Object.keys(stored).length
            ? stored
            : fallback;

    if (!report && !Object.keys(data).length) return null;

    return {
        id: report?.id || null,
        roundType: report?.roundType || data.roundType || "",
        overallScore: report?.overallScore ?? data.overallScore ?? 0,
        aiSummary: report?.aiSummary || data.summary || data.headline || data.profileSummary || "",
        recommendation: data.recommendation || "",
        strengths: Array.isArray(data.strengths) ? data.strengths : [],
        risks: Array.isArray(data.risks) ? data.risks : [],
        detail: data,
        evidenceSnapshot: toRecord(report?.evidenceSnapshot),
        rubricBreakdown: report?.rubricBreakdown || null,
        evaluatedAt: report?.evaluatedAt?.toISOString?.() || null,
    };
}

function richRecruiterReport(job: any, row: any, profile: any) {
    const application = row?.application;
    if (!application) return null;

    const roundType = row?.round?.roundType || row?.report?.roundType || "";
    if (roundType !== "application_review") return null;

    try {
        return storedOrBuiltRecruiterReport(job, { ...application, user: row.user }, profile);
    } catch {
        return application.recruiterReport || null;
    }
}

function serializeJourney(rows: any[], job?: any, profile?: any) {
    return rows.map((row) => ({
        id: row.id,
        roundNumber: row.round?.roundNumber || null,
        roundType: row.round?.roundType || "round",
        title: row.round?.title || "Hiring round",
        status: row.status,
        advanced: Boolean(row.advanced),
        score: row.score || 0,
        submittedAt: row.submittedAt?.toISOString?.() || null,
        evaluatedAt: row.evaluatedAt?.toISOString?.() || null,
        advancedAt: row.advancedAt?.toISOString?.() || null,
        report: serializeReport(row.report, richRecruiterReport(job, row, profile)),
        submissions: Array.isArray(row.technicalAssignmentSubmissions)
            ? row.technicalAssignmentSubmissions.map((submission: any) => ({
                id: submission.id,
                title: submission.assignment?.title || "Technical assignment",
                status: submission.status,
                score: submission.score || 0,
                repoUrl: submission.repoUrl,
                submittedAt: submission.submittedAt?.toISOString?.() || null,
                report: toRecord(submission.report),
            }))
            : [],
    }));
}

function serializeInterviewer(member: any) {
    if (!member) return null;
    return {
        id: member.id,
        memberId: member.id,
        name: member.account?.fullName || member.nameHint || member.email.split("@")[0],
        email: member.account?.email || member.email,
        avatarUrl: member.account?.avatarUrl || null,
        role: member.role,
        teamId: member.team?.id || null,
        teamName: member.team?.name || "Team",
    };
}

function serializeQuestionSelection(interview: any) {
    const questionPlan = toRecord(interview.questionPlan);
    if (Array.isArray(questionPlan.questions) && questionPlan.questions.length) {
        return {
            setIds: Array.isArray(questionPlan.setIds) ? questionPlan.setIds : [],
            questions: questionPlan.questions.map((question: any) => ({
                id: question.id,
                text: question.text,
                setId: question.setId || null,
                setTitle: question.setTitle || "",
                type: question.type || null,
                difficulty: question.difficulty || null,
            })),
            notes: interview.interviewerNotes || questionPlan.notes || null,
        };
    }

    const questions = (interview.questions || []).map((item: any) => ({
        id: item.interviewQuestion.id,
        text: item.interviewQuestion.prompt,
        setId: item.interviewQuestion.questionSetId,
        setTitle: item.interviewQuestion.questionSet?.title || "",
    }));

    return questions.length
        ? {
            setIds: Array.from(new Set(questions.map((question: any) => question.setId))),
            questions,
            notes: interview.interviewerNotes || null,
        }
        : null;
}

function candidateProfileUrl(username?: string | null) {
    if (!username) return null;
    const baseUrl = (
        process.env.CLIENT_URL ||
        process.env.WEB_APP_URL ||
        process.env.NEXT_PUBLIC_WEB_URL ||
        process.env.NEXT_PUBLIC_API_URL?.replace("3001", "3000") ||
        ""
    ).replace(/\/$/, "");
    return baseUrl ? `${baseUrl}/profile/${username}` : `/profile/${username}`;
}

function serializeCandidate(interview: any, profile: any, journey: any[]) {
    const candidate = interview.jobRoundCandidate;
    const candidateUser = candidate?.user || interview.candidate || null;
    const messages = Array.isArray(interview.messages) ? interview.messages.map(toDirectInterviewMessage) : [];
    const messageStats = toRecord(interview.messageStats);
    const messageStatsLastAt = messageStats.lastMessageAt;
    const fallbackLastMessageAt = interview.messages?.length ? interview.messages[interview.messages.length - 1].createdAt : null;
    const lastMessageAt = messageStatsLastAt || fallbackLastMessageAt;

    return {
        id: interview.jobRoundCandidateId,
        directInterviewId: interview.id,
        roundId: interview.roundId,
        applicationId: interview.applicationId,
        userId: interview.candidateUserId,
        status: interview.status,
        sourceStatus: candidate?.status,
        score: interview.score || candidate?.score || candidate?.report?.overallScore || 0,
        selectedAt: interview.createdAt?.toISOString?.() || null,
        selectedFrom: interview.selectedFrom,
        unreadMessageCount: typeof messageStats.unreadCount === "number"
            ? messageStats.unreadCount
            : unreadDirectInterviewCount(interview.messages, "company"),
        lastMessageAt: lastMessageAt?.toISOString?.() || lastMessageAt || null,
        messages,
        schedule: interview.scheduledAt
            ? {
                scheduledAt: interview.scheduledAt.toISOString(),
                timezone: interview.timezone || null,
                durationMinutes: interview.durationMinutes || null,
                mode: interview.interviewMode || "video",
                meetingLink: interview.meetingUrl || null,
                location: interview.location || null,
                notes: interview.scheduleNotes || null,
            }
            : null,
        interviewer: serializeInterviewer(interview.interviewer),
        questionSelection: serializeQuestionSelection(interview),
        candidate: {
            name: candidateUser?.fullName || candidateUser?.email?.split("@")[0] || "Candidate",
            email: candidateUser?.email || "",
            avatarUrl: candidateUser?.avatarUrl || null,
            username: candidateUser?.username || null,
            location: candidateUser?.location || null,
            website: candidateUser?.website || null,
            githubUrl: candidateUser?.githubUrl || null,
            linkedinUrl: candidateUser?.linkedinUrl || null,
            profileUrl: candidateProfileUrl(candidateUser?.username),
        },
        profile: serializeProfile(profile),
        journey: serializeJourney(journey, interview.job, profile),
        application: {
            id: candidate?.application?.id || interview.applicationId,
            status: candidate?.application?.status || "",
            submittedAt: candidate?.application?.submittedAt?.toISOString?.() || null,
            nextRoundType: candidate?.application?.nextRoundType || null,
            nextRoundMovedAt: candidate?.application?.nextRoundMovedAt?.toISOString?.() || null,
            recruiterReport: candidate?.application?.recruiterReport || null,
        },
        latestReport: serializeReport(candidate?.report),
    };
}

function groupJobs(interviews: any[], profileByUserId: Map<string, any>, journeyByApplicationId: Map<string, any[]>) {
    const jobs = new Map<string, any>();
    for (const interview of interviews) {
        const job = interview.job;
        if (!job) continue;

        const existing = jobs.get(job.id) || {
            id: job.id,
            title: job.title,
            companyName: job.companyName,
            companyLogoUrl: job.companyLogoUrl,
            location: job.location,
            status: job.status,
            workMode: job.workMode,
            employmentType: job.employmentType,
            roleType: job.roleType,
            profession: job.profession,
            discipline: job.discipline,
            travel: job.travel,
            openings: job.openings,
            experienceLevel: job.experienceLevel,
            compensationType: job.compensationType,
            compensation: job.compensation,
            duration: job.duration,
            timeCommitment: job.timeCommitment,
            applicationDeadline: job.applicationDeadline?.toISOString?.() || null,
            skills: Array.isArray(job.skills) ? job.skills : [],
            companyOverview: job.companyOverview || null,
            aboutRole: job.aboutRole || "",
            responsibilities: Array.isArray(job.responsibilities) ? job.responsibilities : [],
            requirements: Array.isArray(job.requirements) ? job.requirements : [],
            benefits: Array.isArray(job.benefits) ? job.benefits : [],
            applicationNote: job.applicationNote || null,
            roundCount: 0,
            candidateCount: 0,
            scheduledCount: 0,
            unreadMessageCount: 0,
            rounds: [],
            candidates: [],
        };

        const serializedCandidate = serializeCandidate(
            interview,
            profileByUserId.get(interview.candidateUserId),
            journeyByApplicationId.get(interview.applicationId) || []
        );
        const knownRound = existing.rounds.some((round: any) => round.id === interview.roundId);
        if (!knownRound) {
            existing.roundCount += 1;
            existing.rounds.push({
                id: interview.roundId,
                title: interview.round?.title || "Direct interview",
                roundNumber: interview.round?.roundNumber || null,
                status: interview.round?.status || "",
                createdAt: interview.round?.createdAt?.toISOString?.() || null,
                candidateCount: 0,
            });
        }

        existing.candidates.push(serializedCandidate);
        existing.candidateCount += 1;
        existing.scheduledCount += serializedCandidate.schedule?.scheduledAt ? 1 : 0;
        existing.unreadMessageCount += serializedCandidate.unreadMessageCount;
        const round = existing.rounds.find((item: any) => item.id === interview.roundId);
        if (round) round.candidateCount += 1;
        jobs.set(job.id, existing);
    }

    return Array.from(jobs.values()).sort((first, second) => second.candidateCount - first.candidateCount);
}

async function messageStatsForInterviews(interviewIds: string[]) {
    if (!interviewIds.length) return new Map<string, { unreadCount: number; lastMessageAt: Date | null }>();

    const [unreadRows, lastRows] = await Promise.all([
        directInterviewMessage.groupBy({
            by: ["directInterviewId"],
            where: {
                directInterviewId: { in: interviewIds },
                senderType: "candidate",
                readAt: null,
            },
            _count: { _all: true },
        }),
        directInterviewMessage.groupBy({
            by: ["directInterviewId"],
            where: {
                directInterviewId: { in: interviewIds },
            },
            _max: { createdAt: true },
        }),
    ]);

    const stats = new Map<string, { unreadCount: number; lastMessageAt: Date | null }>();
    for (const interviewId of interviewIds) {
        stats.set(interviewId, { unreadCount: 0, lastMessageAt: null });
    }
    for (const row of unreadRows) {
        stats.set(row.directInterviewId, {
            ...(stats.get(row.directInterviewId) || { unreadCount: 0, lastMessageAt: null }),
            unreadCount: row._count?._all || 0,
        });
    }
    for (const row of lastRows) {
        stats.set(row.directInterviewId, {
            ...(stats.get(row.directInterviewId) || { unreadCount: 0, lastMessageAt: null }),
            lastMessageAt: row._max?.createdAt || null,
        });
    }

    return stats;
}

function companyQuestionId(setId: string, type: CompanyQuestionBankType, questionId: string) {
    return `${setId}:${type}:${questionId}`;
}

function bankQuestionId(type: CompanyQuestionBankType, questionId: string) {
    return `bank:${type}:${questionId}`;
}

function legacyCompanyQuestionId(type: CompanyQuestionBankType, questionId: string) {
    return `${type}:${questionId}`;
}

const questionBankTypeLabels: Record<CompanyQuestionBankType, string> = {
    dsa: "DSA",
    sql: "SQL",
    system_design: "System Design",
    cs_fundamentals: "CS Fundamentals",
};

function isCompanyQuestionBankType(value: string): value is CompanyQuestionBankType {
    return (COMPANY_QUESTION_BANK_TYPES as readonly string[]).includes(value);
}

function parseBankQuestionInputId(id: string) {
    const parts = id.split(":");
    if (parts.length >= 3 && parts[0] === "bank" && isCompanyQuestionBankType(parts[1])) {
        return { type: parts[1], questionId: parts.slice(2).join(":") };
    }
    if (parts.length >= 2 && isCompanyQuestionBankType(parts[0])) {
        return { type: parts[0], questionId: parts.slice(1).join(":") };
    }
    return null;
}

function questionBankTitle(type: CompanyQuestionBankType, question: any) {
    if (type === "cs_fundamentals") return String(question.question || "CS fundamentals question");
    return String(question.title || "Untitled question");
}

function formatQuestionBankQuestion(type: CompanyQuestionBankType, question: any) {
    const questionId = String(question._id);
    return {
        id: bankQuestionId(type, questionId),
        text: questionBankTitle(type, question),
        setId: null,
        setTitle: "Question bank",
        type,
        questionId,
        difficulty: question.difficulty || null,
        expectedTopics: [],
    };
}

function formatCompanyQuestionSet(set: any) {
    return {
        id: String(set._id),
        title: set.title,
        focus: set.description || "",
        status: set.status,
        questions: (set.items || [])
            .slice()
            .sort((a: any, b: any) => (a.orderIndex || 0) - (b.orderIndex || 0))
            .map((item: any) => ({
                id: companyQuestionId(String(set._id), item.type, item.questionId),
                text: item.title,
                setId: String(set._id),
                setTitle: set.title,
                type: item.type,
                questionId: item.questionId,
                difficulty: item.difficulty || null,
                expectedTopics: [],
            })),
    };
}

async function questionSetsResponse(companyId: string) {
    await connectMongoDB();

    const sets = await CompanyQuestionSet.find({
        "company.id": companyId,
        status: { $ne: "archived" },
        items: { $ne: [] },
    }).sort({ updatedAt: -1 }).lean();

    return sets.map(formatCompanyQuestionSet);
}

async function ungroupedQuestionBankGroupsResponse(companyId: string) {
    await connectMongoDB();

    const sets = await CompanyQuestionSet.find({
        "company.id": companyId,
        status: { $ne: "archived" },
    }).select("items").lean();
    const groupedQuestionKeys = new Set<string>();
    for (const set of sets) {
        for (const item of set.items || []) {
            groupedQuestionKeys.add(`${item.type}:${item.questionId}`);
        }
    }

    const groups = await Promise.all(COMPANY_QUESTION_BANK_TYPES.map(async (type) => {
        const Model = COMPANY_QUESTION_BANK_MODELS[type] as any;
        const questions = await Model.find({
            "company.id": companyId,
            status: { $ne: "archived" },
        }).sort({ updatedAt: -1 }).lean();

        const ungroupedQuestions = questions
            .filter((question: any) => !groupedQuestionKeys.has(`${type}:${String(question._id)}`))
            .map((question: any) => formatQuestionBankQuestion(type, question));

        return {
            id: `bank-${type}`,
            title: `${questionBankTypeLabels[type]} questions not in sets`,
            focus: "Added to your company question bank but not attached to any interview set.",
            isQuestionBank: true,
            questions: ungroupedQuestions,
        };
    }));

    return groups.filter((group) => group.questions.length);
}

async function directInterviewResources(request: any) {
    const company = request.company!;
    const [teamMembers, questionSets, questionBankGroups] = await Promise.all([
        companyTeamMember.findMany({
            where: {
                companyId: company.id,
                status: "active",
                role: { in: ["admin", "member"] },
                team: { isArchived: false },
                companyAccountId: { not: null },
            },
            orderBy: [{ role: "asc" }, { createdAt: "asc" }],
            include: {
                account: { select: { fullName: true, email: true, avatarUrl: true } },
                team: { select: { id: true, name: true } },
            },
        }),
        questionSetsResponse(company.id),
        ungroupedQuestionBankGroupsResponse(company.id),
    ]);

    return {
        interviewers: teamMembers.map(serializeInterviewer).filter(Boolean),
        questionSets,
        questionBankGroups,
    };
}

async function directInterviewContext(request: any) {
    const company = request.company!;

    let rawInterviews = await directInterview.findMany({
        where: {
            companyId: company.id,
            round: { roundType: "final_interview" },
        },
        orderBy: [{ createdAt: "desc" }],
        include: directInterviewSummaryInclude(),
    });

    if (!rawInterviews.length) {
        const hasLegacyFinalRoundCandidate = await jobRoundCandidate.findFirst({
            where: {
                round: {
                    companyId: company.id,
                    roundType: "final_interview",
                },
            },
            select: { id: true },
        });

        if (hasLegacyFinalRoundCandidate) {
            await ensureDirectInterviewRowsForCompany(company.id);
            rawInterviews = await directInterview.findMany({
                where: {
                    companyId: company.id,
                    round: { roundType: "final_interview" },
                },
                orderBy: [{ createdAt: "desc" }],
                include: directInterviewSummaryInclude(),
            });
        }
    }

    const messageStats = await messageStatsForInterviews(rawInterviews.map((interview: any) => interview.id));
    const interviews = rawInterviews.map((interview: any) => ({
        ...interview,
        messageStats: messageStats.get(interview.id) || { unreadCount: 0, lastMessageAt: null },
    }));

    return {
        jobs: groupJobs(interviews, new Map(), new Map()),
        interviewers: [],
        questionSets: [],
        questionBankGroups: [],
    };
}

async function directInterviewCandidateDetail(interview: any) {
    const [profile, journeyRows] = await Promise.all([
        interview.candidateUserId
            ? jobApplyProfile.findFirst({
                where: { userId: interview.candidateUserId },
                select: {
                    userId: true,
                    profileLanguage: true,
                    pronouns: true,
                    headline: true,
                    industry: true,
                    city: true,
                    country: true,
                    postalCode: true,
                    about: true,
                    openTo: true,
                    coverImageUrl: true,
                    selectedResumeId: true,
                    leetcodeUrl: true,
                    geeksforgeeksUrl: true,
                    codeforcesUrl: true,
                    codechefUrl: true,
                    skills: true,
                    featured: true,
                    experiences: true,
                    education: true,
                    projects: true,
                    isPublished: true,
                },
            })
            : null,
        interview.applicationId
            ? jobRoundCandidate.findMany({
                where: { applicationId: interview.applicationId },
                orderBy: [{ createdAt: "asc" }],
                include: {
                    round: {
                        select: {
                            id: true,
                            roundNumber: true,
                            roundType: true,
                            title: true,
                            status: true,
                        },
                    },
                    report: {
                        select: {
                            id: true,
                            roundType: true,
                            overallScore: true,
                            evidenceSnapshot: true,
                            rubricBreakdown: true,
                            aiSummary: true,
                            report: true,
                            evaluatedAt: true,
                        },
                    },
                    application: {
                        select: {
                            id: true,
                            status: true,
                            selectedProjects: true,
                            githubProfileSnapshot: true,
                            githubAnalysis: true,
                            codingProfiles: true,
                            codingAnalysis: true,
                            evidencePack: true,
                            recruiterAnalysis: true,
                            recruiterReport: true,
                            nextRoundType: true,
                            nextRoundMovedAt: true,
                            submittedAt: true,
                        },
                    },
                    user: {
                        select: {
                            id: true,
                            fullName: true,
                            email: true,
                            username: true,
                            avatarUrl: true,
                        },
                    },
                    technicalAssignmentSubmissions: {
                        select: {
                            id: true,
                            status: true,
                            score: true,
                            repoUrl: true,
                            report: true,
                            submittedAt: true,
                            assignment: { select: { title: true } },
                        },
                    },
                },
            })
            : [],
    ]);

    return serializeCandidate(interview, profile, journeyRows);
}

async function selectedQuestionsFromInput(input: z.infer<typeof interviewerSchema>, companyId: string) {
    if (!input.questionSetIds.length && !input.questionIds.length) {
        return { error: "Choose at least one question set or one question." };
    }

    if (input.questionSetIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
        return { error: "Unknown question set id." };
    }

    await connectMongoDB();

    const setFilter: Record<string, any> = {
        "company.id": companyId,
        status: { $ne: "archived" },
    };
    if (input.questionSetIds.length) {
        setFilter._id = { $in: input.questionSetIds };
    }

    const sets = await CompanyQuestionSet.find(setFilter).sort({ updatedAt: -1 }).lean();
    const foundSetIds = new Set(sets.map((set: any) => String(set._id)));
    const missingSet = input.questionSetIds.find((setId) => !foundSetIds.has(setId));
    if (missingSet) return { error: `Unknown question set id: ${missingSet}` };

    const wantedQuestionIds = new Set(input.questionIds);
    const selectedQuestions: any[] = [];

    for (const set of sets) {
        const sortedItems = (set.items || [])
            .slice()
            .sort((a: any, b: any) => (a.orderIndex || 0) - (b.orderIndex || 0));

        for (const item of sortedItems) {
            const setId = String(set._id);
            const id = companyQuestionId(setId, item.type, item.questionId);
            const legacyId = legacyCompanyQuestionId(item.type, item.questionId);
            if (wantedQuestionIds.size && !wantedQuestionIds.has(id) && !wantedQuestionIds.has(legacyId)) continue;

            selectedQuestions.push({
                id,
                text: item.title,
                setId,
                setTitle: set.title,
                type: item.type,
                questionId: item.questionId,
                difficulty: item.difficulty || null,
            });
        }
    }

    const foundQuestionIds = new Set(selectedQuestions.map((question) => question.id));
    for (const question of selectedQuestions) {
        foundQuestionIds.add(legacyCompanyQuestionId(question.type, question.questionId));
    }

    const bankQuestionIdsByType = new Map<CompanyQuestionBankType, string[]>();
    for (const inputId of input.questionIds) {
        if (foundQuestionIds.has(inputId)) continue;
        const parsed = parseBankQuestionInputId(inputId);
        if (!parsed || !mongoose.Types.ObjectId.isValid(parsed.questionId)) continue;
        bankQuestionIdsByType.set(parsed.type, [
            ...(bankQuestionIdsByType.get(parsed.type) || []),
            parsed.questionId,
        ]);
    }

    for (const [type, ids] of bankQuestionIdsByType.entries()) {
        const Model = COMPANY_QUESTION_BANK_MODELS[type] as any;
        const docs = await Model.find({
            "company.id": companyId,
            status: { $ne: "archived" },
            _id: { $in: Array.from(new Set(ids)) },
        }).lean();

        for (const doc of docs) {
            const question = formatQuestionBankQuestion(type, doc);
            selectedQuestions.push(question);
            foundQuestionIds.add(question.id);
            foundQuestionIds.add(legacyCompanyQuestionId(type, question.questionId));
        }
    }

    const missingQuestion = input.questionIds.find((questionId) => !foundQuestionIds.has(questionId));
    if (missingQuestion) return { error: `Unknown question id: ${missingQuestion}` };

    const dedupedQuestions: any[] = [];
    const seenQuestionKeys = new Set<string>();
    for (const question of selectedQuestions) {
        const key = `${question.type}:${question.questionId}`;
        if (seenQuestionKeys.has(key)) continue;
        seenQuestionKeys.add(key);
        dedupedQuestions.push(question);
    }

    if (!dedupedQuestions.length) return { error: "Choose at least one question set or one question." };

    return {
        questionPlan: {
            setIds: Array.from(new Set(dedupedQuestions.map((question) => question.setId).filter(Boolean))),
            questions: dedupedQuestions,
            notes: input.notes || null,
        },
    };
}

async function handleRouteError(err: unknown, reply: FastifyReply, fastify: FastifyInstance) {
    fastify.log.error(sanitizeForLog(err), "Company direct interview route failed");
    return reply.status(500).send({
        error: "Internal Server Error",
        message: "Internal Server Error. Please check your connection and try again.",
    });
}

export default async function companyDirectInterviewRoutes(fastify: FastifyInstance) {
    const companyPreHandler = [fastify.authenticate, requireCompanyWorkspaceAccess, requireDirectInterviewAccess];

    fastify.get("/companies/direct-interviews", { preHandler: companyPreHandler }, async (request, reply) => {
        const companyId = request.company!.id;
        const rl = checkRateLimit(`companies:direct-interviews:list:${companyId}`, 120, 60_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Too many requests. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        try {
            return await directInterviewContext(request);
        } catch (err) {
            return handleRouteError(err, reply, fastify);
        }
    });

    fastify.get("/companies/direct-interviews/resources", { preHandler: companyPreHandler }, async (request, reply) => {
        if (!isCompanyAdminRole(request.company!.role)) {
            return reply.status(403).send({
                error: "Forbidden",
                message: "You don't have access to it. Reach out to your company owner or admin.",
            });
        }

        const companyId = request.company!.id;
        const rl = checkRateLimit(`companies:direct-interviews:resources:${companyId}`, 120, 60_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Too many requests. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        try {
            return await directInterviewResources(request);
        } catch (err) {
            return handleRouteError(err, reply, fastify);
        }
    });

    fastify.patch("/companies/direct-interviews/:candidateId/schedule", { preHandler: companyPreHandler }, async (request, reply) => {
        const params = paramsSchema.safeParse(request.params);
        const parsed = scheduleSchema.safeParse(request.body);
        if (!params.success || !parsed.success) {
            return reply.status(400).send(validationPayload(params.success ? parsed.error! : params.error));
        }

        const companyId = request.company!.id;
        const rl = checkRateLimit(`companies:direct-interviews:schedule:${companyId}`, 60, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Interview scheduling limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const interview = await findCompanyDirectInterview(params.data.candidateId, companyId);
        if (!interview) {
            return reply.status(404).send({ error: "Not Found", message: "Direct interview candidate not found." });
        }
        if (!assertCanManageInterview(request, interview, reply)) return reply;

        const scheduledAt = new Date(parsed.data.scheduledAt);
        const updated = await directInterview.update({
            where: { id: interview.id },
            data: {
                status: "scheduled",
                scheduledAt,
                timezone: parsed.data.timezone || request.company!.defaultTimezone || "Asia/Kolkata",
                durationMinutes: parsed.data.durationMinutes,
                interviewMode: parsed.data.mode,
                meetingUrl: parsed.data.meetingLink || null,
                location: parsed.data.location || null,
                scheduleNotes: parsed.data.notes || null,
                assignedById: request.user!.id,
            },
        });

        await (prisma as any).userNotification.create({
            data: {
                userId: interview.candidateUserId,
                type: "direct_interview_scheduled",
                title: "Direct interview scheduled",
                message: `Your interview for ${interview.job?.title || "the role"} has been scheduled.`,
                href: "/scheduled",
                metadata: {
                    jobId: interview.jobId,
                    roundCandidateId: interview.jobRoundCandidateId,
                    directInterviewId: interview.id,
                    scheduledAt: scheduledAt.toISOString(),
                },
            },
        }).catch(() => null);

        return {
            interview: {
                id: updated.jobRoundCandidateId,
                status: updated.status,
                schedule: {
                    scheduledAt: updated.scheduledAt?.toISOString?.() || null,
                    timezone: updated.timezone,
                    durationMinutes: updated.durationMinutes,
                    mode: updated.interviewMode,
                    meetingLink: updated.meetingUrl,
                    location: updated.location,
                    notes: updated.scheduleNotes,
                },
            },
        };
    });

    fastify.patch("/companies/direct-interviews/:candidateId/interviewer", { preHandler: companyPreHandler }, async (request, reply) => {
        const params = paramsSchema.safeParse(request.params);
        const parsed = interviewerSchema.safeParse(request.body);
        if (!params.success || !parsed.success) {
            return reply.status(400).send(validationPayload(params.success ? parsed.error! : params.error));
        }

        const companyId = request.company!.id;
        const rl = checkRateLimit(`companies:direct-interviews:interviewer:${companyId}`, 60, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Interviewer assignment limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const interview = await findCompanyDirectInterview(params.data.candidateId, companyId);
        if (!interview) {
            return reply.status(404).send({ error: "Not Found", message: "Direct interview candidate not found." });
        }
        if (!assertCanManageInterview(request, interview, reply)) return reply;

        const interviewer = await companyTeamMember.findFirst({
            where: {
                id: parsed.data.interviewerMemberId,
                companyId,
                status: "active",
                role: { in: ["admin", "member"] },
                team: { isArchived: false },
                companyAccountId: { not: null },
            },
            include: {
                account: { select: { fullName: true, email: true, avatarUrl: true } },
                team: { select: { id: true, name: true } },
            },
        });
        if (!interviewer) {
            return reply.status(404).send({
                error: "Not Found",
                message: "Choose an active admin or member from your company team.",
            });
        }

        const selected = await selectedQuestionsFromInput(parsed.data, companyId);
        if ("error" in selected) {
            return reply.status(400).send({ error: "Validation Error", message: selected.error });
        }

        await prisma.$transaction(async (tx: any) => {
            await tx.directInterview.update({
                where: { id: interview.id },
                data: {
                    interviewerMemberId: interviewer.id,
                    interviewerNotes: parsed.data.notes || null,
                    questionPlan: selected.questionPlan,
                    status: interview.status === "scheduled" ? "scheduled" : "shortlisted",
                },
            });
        });

        const updated = await directInterview.findUnique({
            where: { id: interview.id },
            include: directInterviewFullInclude(),
        });

        return {
            interview: {
                id: updated.jobRoundCandidateId,
                status: updated.status,
                interviewer: serializeInterviewer(updated.interviewer),
                questionSelection: serializeQuestionSelection(updated),
            },
        };
    });

    fastify.get("/companies/direct-interviews/:candidateId/context", { preHandler: companyPreHandler }, async (request, reply) => {
        const params = paramsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send(validationPayload(params.error));
        }

        const interview = await findCompanyDirectInterview(params.data.candidateId, request.company!.id);
        if (!interview) {
            return reply.status(404).send({ error: "Not Found", message: "Direct interview candidate not found." });
        }

        try {
            return {
                candidate: await directInterviewCandidateDetail(interview),
            };
        } catch (err) {
            return handleRouteError(err, reply, fastify);
        }
    });

    fastify.get("/companies/direct-interviews/:candidateId/messages", { preHandler: companyPreHandler }, async (request, reply) => {
        const params = paramsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send(validationPayload(params.error));
        }

        const interview = await findCompanyDirectInterview(params.data.candidateId, request.company!.id);
        if (!interview) {
            return reply.status(404).send({ error: "Not Found", message: "Direct interview candidate not found." });
        }
        if (!assertCanUseInterviewChat(request, interview, reply)) return reply;

        const actor = actorFromCompanyRequest(request);
        const messages = await markDirectInterviewMessagesRead({ interview, actor });
        return { messages };
    });

    fastify.post("/companies/direct-interviews/:candidateId/messages", { preHandler: companyPreHandler }, async (request, reply) => {
        const params = paramsSchema.safeParse(request.params);
        const parsed = messageSchema.safeParse(request.body);
        if (!params.success || !parsed.success) {
            return reply.status(400).send(validationPayload(params.success ? parsed.error! : params.error));
        }

        const companyId = request.company!.id;
        const rl = checkRateLimit(`companies:direct-interviews:message:${companyId}:${request.user!.id}`, 30, 60_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Too many messages. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const interview = await findCompanyDirectInterviewForChat(params.data.candidateId, companyId);
        if (!interview) {
            return reply.status(404).send({ error: "Not Found", message: "Direct interview candidate not found." });
        }
        if (!assertCanUseInterviewChat(request, interview, reply)) return reply;

        const actor = actorFromCompanyRequest(request);
        const message = await appendDirectInterviewMessage({
            interview,
            actor,
            content: parsed.data.content,
        });

        return reply.status(201).send({
            message: {
                ...message,
                clientMessageId: parsed.data.clientMessageId || null,
            },
        });
    });
}
