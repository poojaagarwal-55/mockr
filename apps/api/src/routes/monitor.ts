import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { checkRateLimit } from "../lib/rate-limiter.js";
import { USER_ROLE } from "../lib/user-roles.js";

const contestParamsSchema = z.object({
    contestId: z.string().trim().min(1).max(140),
});

const userProfileParamsSchema = z.object({
    userId: z.string().uuid(),
});

type CoordinatorContext = {
    userId: string;
    email: string;
    domain: string;
};

type DomainUser = {
    id: string;
    email: string;
    fullName: string;
    username: string | null;
    avatarUrl: string | null;
    jobApplyProfile: { id: string } | null;
};

type LeaderboardParticipant = {
    userId: string;
    totalScore: number;
    registeredAt: Date;
    submittedAt?: Date | null;
    isSubmitted?: boolean;
    submissionType?: string | null;
};

type SolvedSubmission = {
    userId: string;
    questionId: string;
    contestId?: string;
    submittedAt: Date;
};

type RankedParticipant = LeaderboardParticipant & {
    normalizedScore: number;
    solvedCount: number;
    lastSolvedAt: Date | null;
    contestRank: number;
};

async function getCoordinatorContext(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<CoordinatorContext | null> {
    const user = await prisma.user.findUnique({
        where: { id: request.user!.id },
        select: {
            id: true,
            email: true,
            role: true,
            placementCollegeEmailDomain: true,
        },
    });

    if (!user) {
        reply.status(404).send({ error: "User not found" });
        return null;
    }

    if (user.role !== USER_ROLE.PLACEMENT_COORDINATOR) {
        reply.status(403).send({ error: "Placement coordinator access required" });
        return null;
    }

    if (!user.placementCollegeEmailDomain) {
        reply.status(403).send({ error: "College email domain is not assigned" });
        return null;
    }

    return {
        userId: user.id,
        email: user.email,
        domain: user.placementCollegeEmailDomain.toLowerCase(),
    };
}

async function getDomainUsers(domain: string): Promise<DomainUser[]> {
    return prisma.user.findMany({
        where: {
            email: {
                endsWith: domain,
                mode: "insensitive",
            },
        },
        select: {
            id: true,
            email: true,
            fullName: true,
            username: true,
            avatarUrl: true,
            jobApplyProfile: {
                select: { id: true },
            },
        },
        orderBy: { fullName: "asc" },
    });
}

function contestSummary(contest: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    startTime: Date;
    endTime: Date;
    _count?: { questions?: number; participants?: number };
}) {
    return {
        id: contest.id,
        title: contest.title,
        description: contest.description,
        status: contest.status,
        startTime: contest.startTime,
        endTime: contest.endTime,
        questionCount: contest._count?.questions ?? 0,
        participantCount: contest._count?.participants ?? 0,
        leaderboardAvailable: contest.status === "ENDED",
    };
}

function normalizeScore(score: number | null | undefined) {
    return Math.max(0, Number(score ?? 0));
}

function isCheatingSubmissionType(submissionType: string | null | undefined) {
    return Boolean(submissionType && submissionType !== "manual" && submissionType !== "auto_time");
}

function compareLastSolvedAt(a: Date | null, b: Date | null) {
    if (a && b) return a.getTime() - b.getTime();
    if (a && !b) return -1;
    if (!a && b) return 1;
    return 0;
}

function compareRankedParticipants(a: Omit<RankedParticipant, "contestRank">, b: Omit<RankedParticipant, "contestRank">) {
    if (b.normalizedScore !== a.normalizedScore) return b.normalizedScore - a.normalizedScore;
    if (b.solvedCount !== a.solvedCount) return b.solvedCount - a.solvedCount;

    const solvedTimeDiff = compareLastSolvedAt(a.lastSolvedAt, b.lastSolvedAt);
    if (solvedTimeDiff !== 0) return solvedTimeDiff;

    const registrationDiff = a.registeredAt.getTime() - b.registeredAt.getTime();
    if (registrationDiff !== 0) return registrationDiff;

    return a.userId.localeCompare(b.userId);
}

function buildSolvedStats(submissions: SolvedSubmission[]) {
    const earliestSolveByUserQuestion = new Map<string, Map<string, Date>>();

    for (const submission of submissions) {
        const questionKey = submission.contestId
            ? `${submission.contestId}:${submission.questionId}`
            : submission.questionId;
        const userSolves = earliestSolveByUserQuestion.get(submission.userId) ?? new Map<string, Date>();
        const previous = userSolves.get(questionKey);
        if (!previous || submission.submittedAt < previous) {
            userSolves.set(questionKey, submission.submittedAt);
        }
        earliestSolveByUserQuestion.set(submission.userId, userSolves);
    }

    const stats = new Map<string, { solvedCount: number; lastSolvedAt: Date | null }>();

    for (const [userId, solvedQuestions] of earliestSolveByUserQuestion.entries()) {
        const solvedTimes = Array.from(solvedQuestions.values());
        const lastSolvedAt = solvedTimes.reduce<Date | null>((latest, solvedAt) => {
            if (!latest || solvedAt > latest) return solvedAt;
            return latest;
        }, null);

        stats.set(userId, {
            solvedCount: solvedQuestions.size,
            lastSolvedAt,
        });
    }

    return stats;
}

function rankContestParticipants(participants: LeaderboardParticipant[], solvedSubmissions: SolvedSubmission[]) {
    const solvedStats = buildSolvedStats(solvedSubmissions);

    return new Map(
        participants
            .map((participant) => {
                const stats = solvedStats.get(participant.userId);
                return {
                    ...participant,
                    normalizedScore: normalizeScore(participant.totalScore),
                    solvedCount: stats?.solvedCount ?? 0,
                    lastSolvedAt: stats?.lastSolvedAt ?? null,
                };
            })
            .sort(compareRankedParticipants)
            .map((participant, index) => [
                participant.userId,
                {
                    ...participant,
                    contestRank: index + 1,
                },
            ])
    );
}

function profileUser(user: {
    id: string;
    fullName: string;
    email: string;
    username: string | null;
    avatarUrl: string | null;
    location?: string | null;
    website?: string | null;
    githubUrl?: string | null;
    linkedinUrl?: string | null;
    skills?: string[];
    workExperience?: unknown;
    education?: unknown;
}) {
    return {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        username: user.username,
        avatarUrl: user.avatarUrl,
        location: user.location ?? null,
        website: user.website ?? null,
        githubUrl: user.githubUrl ?? null,
        linkedinUrl: user.linkedinUrl ?? null,
        skills: user.skills ?? [],
        workExperience: user.workExperience ?? null,
        education: user.education ?? null,
    };
}

export default async function monitorRoutes(fastify: FastifyInstance) {
    fastify.addHook("preHandler", fastify.authenticate);

    fastify.get("/monitor/contests", async (request, reply) => {
        const rl = checkRateLimit(`monitor:contests:${request.user!.id}`, 120, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ error: "Too Many Requests" });
        }

        const coordinator = await getCoordinatorContext(request, reply);
        if (!coordinator) return;

        const domainUsers = await getDomainUsers(coordinator.domain);
        const domainUserIds = domainUsers.map((user) => user.id);

        const [contests, domainParticipantCounts] = await Promise.all([
            prisma.contest.findMany({
                orderBy: [{ startTime: "desc" }, { createdAt: "desc" }],
                include: {
                    _count: {
                        select: {
                            questions: true,
                            participants: true,
                        },
                    },
                },
            }),
            domainUserIds.length
                ? prisma.contestParticipant.groupBy({
                      by: ["contestId"],
                      where: { userId: { in: domainUserIds } },
                      _count: { userId: true },
                  })
                : Promise.resolve([]),
        ]);

        const domainCounts = new Map(
            domainParticipantCounts.map((row) => [row.contestId, row._count.userId])
        );

        return reply.send({
            coordinator: {
                email: coordinator.email,
                collegeEmailDomain: coordinator.domain,
                studentCount: domainUsers.length,
            },
            contests: contests.map((contest) => ({
                ...contestSummary(contest),
                collegeParticipantCount: domainCounts.get(contest.id) ?? 0,
            })),
        });
    });

    fastify.get("/monitor/contests/:contestId/leaderboard", async (request, reply) => {
        const params = contestParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: params.error.flatten().fieldErrors,
            });
        }

        const rl = checkRateLimit(`monitor:contest-leaderboard:${request.user!.id}`, 120, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ error: "Too Many Requests" });
        }

        const coordinator = await getCoordinatorContext(request, reply);
        if (!coordinator) return;

        const contest = await prisma.contest.findUnique({
            where: { id: params.data.contestId },
            include: {
                questions: {
                    orderBy: { order: "asc" },
                    select: {
                        questionId: true,
                        points: true,
                        difficulty: true,
                        order: true,
                    },
                },
                _count: {
                    select: {
                        questions: true,
                        participants: true,
                    },
                },
            },
        });

        if (!contest) {
            return reply.status(404).send({ error: "Contest not found" });
        }

        if (contest.status !== "ENDED") {
            return reply.send({
                available: false,
                message: "Leaderboard will be available soon after the contest.",
                contest: contestSummary(contest),
                questions: contest.questions.map((question, index) => ({
                    label: `Q${index + 1}`,
                    questionId: question.questionId,
                    points: question.points,
                    difficulty: question.difficulty,
                })),
                rows: [],
            });
        }

        const domainUsers = await getDomainUsers(coordinator.domain);
        const userById = new Map(domainUsers.map((user) => [user.id, user]));
        const userIds = domainUsers.map((user) => user.id);

        if (userIds.length === 0) {
            return reply.send({
                available: true,
                contest: contestSummary(contest),
                questions: contest.questions.map((question, index) => ({
                    label: `Q${index + 1}`,
                    questionId: question.questionId,
                    points: question.points,
                    difficulty: question.difficulty,
                })),
                rows: [],
            });
        }

        const [participants, acceptedSubmissions] = await Promise.all([
            prisma.contestParticipant.findMany({
                where: {
                    contestId: contest.id,
                },
                select: {
                    userId: true,
                    totalScore: true,
                    registeredAt: true,
                    submittedAt: true,
                    isSubmitted: true,
                    submissionType: true,
                },
            }),
            prisma.contestSubmission.findMany({
                where: {
                    contestId: contest.id,
                    OR: [
                        { status: "ACCEPTED" },
                        { pointsAwarded: { gt: 0 } },
                    ],
                },
                select: {
                    userId: true,
                    questionId: true,
                    submittedAt: true,
                },
            }),
        ]);

        const solved = new Set(
            acceptedSubmissions.map((submission) => `${submission.userId}:${submission.questionId}`)
        );
        const rankedByUser = rankContestParticipants(participants, acceptedSubmissions);
        const collegeParticipants = participants
            .filter((participant) => userById.has(participant.userId))
            .sort((a, b) => {
                const aRank = rankedByUser.get(a.userId)?.contestRank ?? Number.MAX_SAFE_INTEGER;
                const bRank = rankedByUser.get(b.userId)?.contestRank ?? Number.MAX_SAFE_INTEGER;
                if (aRank !== bRank) return aRank - bRank;
                return a.userId.localeCompare(b.userId);
            });

        const rows = collegeParticipants.map((participant, index) => {
            const user = userById.get(participant.userId);
            const ranked = rankedByUser.get(participant.userId);
            return {
                serialNumber: index + 1,
                rank: index + 1,
                contestRank: ranked?.contestRank ?? index + 1,
                userId: participant.userId,
                name: user?.fullName ?? "Unknown student",
                email: user?.email ?? "",
                totalScore: ranked?.normalizedScore ?? normalizeScore(participant.totalScore),
                solvedCount: ranked?.solvedCount ?? 0,
                lastSolvedAt: ranked?.lastSolvedAt ?? null,
                hasProfile: Boolean(user?.jobApplyProfile),
                submittedAt: participant.submittedAt,
                isSubmitted: participant.isSubmitted,
                submissionType: participant.submissionType,
                submittedDueToCheating: isCheatingSubmissionType(participant.submissionType),
                cheatingCount: isCheatingSubmissionType(participant.submissionType) ? 1 : 0,
                questions: contest.questions.map((question, questionIndex) => ({
                    label: `Q${questionIndex + 1}`,
                    questionId: question.questionId,
                    points: question.points,
                    difficulty: question.difficulty,
                    solved: solved.has(`${participant.userId}:${question.questionId}`),
                })),
            };
        });

        return reply.send({
            available: true,
            contest: contestSummary(contest),
            questions: contest.questions.map((question, index) => ({
                label: `Q${index + 1}`,
                questionId: question.questionId,
                points: question.points,
                difficulty: question.difficulty,
            })),
            rows,
        });
    });

    fastify.get("/monitor/complete-leaderboard", async (request, reply) => {
        const rl = checkRateLimit(`monitor:complete-leaderboard:${request.user!.id}`, 60, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ error: "Too Many Requests" });
        }

        const coordinator = await getCoordinatorContext(request, reply);
        if (!coordinator) return;

        const [domainUsers, contests] = await Promise.all([
            getDomainUsers(coordinator.domain),
            prisma.contest.findMany({
                where: { status: "ENDED" },
                orderBy: [{ startTime: "desc" }, { createdAt: "desc" }],
                include: {
                    _count: {
                        select: {
                            questions: true,
                            participants: true,
                        },
                    },
                },
            }),
        ]);

        const userById = new Map(domainUsers.map((user) => [user.id, user]));
        const userIds = domainUsers.map((user) => user.id);
        const contestIds = contests.map((contest) => contest.id);

        if (userIds.length === 0 || contestIds.length === 0) {
            return reply.send({
                coordinator: {
                    email: coordinator.email,
                    collegeEmailDomain: coordinator.domain,
                    studentCount: domainUsers.length,
                },
                contests: contests.map(contestSummary),
                rows: [],
            });
        }

        const [participants, acceptedSubmissions] = await Promise.all([
            prisma.contestParticipant.findMany({
                where: {
                    contestId: { in: contestIds },
                    userId: { in: userIds },
                },
                select: {
                    contestId: true,
                    userId: true,
                    totalScore: true,
                    registeredAt: true,
                    submissionType: true,
                },
            }),
            prisma.contestSubmission.findMany({
                where: {
                    contestId: { in: contestIds },
                    userId: { in: userIds },
                    OR: [
                        { status: "ACCEPTED" },
                        { pointsAwarded: { gt: 0 } },
                    ],
                },
                select: {
                    contestId: true,
                    userId: true,
                    questionId: true,
                    submittedAt: true,
                },
            }),
        ]);

        const solvedContest = new Set(
            acceptedSubmissions.map((submission) => `${submission.userId}:${submission.contestId}`)
        );
        const solvedStats = buildSolvedStats(acceptedSubmissions);
        const rowsByUser = new Map<string, {
            userId: string;
            name: string;
            email: string;
            totalScore: number;
            solvedCount: number;
            lastSolvedAt: Date | null;
            cheatingCount: number;
            hasProfile: boolean;
            contests: Record<string, { score: number; solved: boolean; participated: boolean; submittedDueToCheating: boolean }>;
            firstRegisteredAt: Date | null;
        }>();

        for (const participant of participants) {
            const user = userById.get(participant.userId);
            if (!user) continue;

            const existing = rowsByUser.get(participant.userId) ?? {
                userId: participant.userId,
                name: user.fullName,
                email: user.email,
                totalScore: 0,
                solvedCount: 0,
                lastSolvedAt: null,
                cheatingCount: 0,
                hasProfile: Boolean(user.jobApplyProfile),
                contests: {},
                firstRegisteredAt: null,
            };

            const contestScore = normalizeScore(participant.totalScore);
            const submittedDueToCheating = isCheatingSubmissionType(participant.submissionType);
            existing.totalScore += contestScore;
            if (submittedDueToCheating) existing.cheatingCount += 1;
            existing.contests[participant.contestId] = {
                score: contestScore,
                solved:
                    contestScore > 0 ||
                    solvedContest.has(`${participant.userId}:${participant.contestId}`),
                participated: true,
                submittedDueToCheating,
            };
            const stats = solvedStats.get(participant.userId);
            existing.solvedCount = stats?.solvedCount ?? 0;
            existing.lastSolvedAt = stats?.lastSolvedAt ?? null;
            if (!existing.firstRegisteredAt || participant.registeredAt < existing.firstRegisteredAt) {
                existing.firstRegisteredAt = participant.registeredAt;
            }
            rowsByUser.set(participant.userId, existing);
        }

        const rows = Array.from(rowsByUser.values())
            .map((row) => ({
                userId: row.userId,
                name: row.name,
                email: row.email,
                totalScore: row.totalScore,
                solvedCount: row.solvedCount,
                lastSolvedAt: row.lastSolvedAt,
                cheatingCount: row.cheatingCount,
                hasProfile: row.hasProfile,
                contests: Object.fromEntries(
                    contests.map((contest) => [
                        contest.id,
                        row.contests[contest.id] ?? {
                            score: 0,
                            solved: false,
                            participated: false,
                            submittedDueToCheating: false,
                        },
                    ])
                ),
                firstRegisteredAt: row.firstRegisteredAt,
            }))
            .sort((a, b) => {
                if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
                if (b.solvedCount !== a.solvedCount) return b.solvedCount - a.solvedCount;
                const solvedTimeDiff = compareLastSolvedAt(a.lastSolvedAt, b.lastSolvedAt);
                if (solvedTimeDiff !== 0) return solvedTimeDiff;
                return a.name.localeCompare(b.name);
            })
            .map((row, index) => ({
                rank: index + 1,
                ...row,
            }));

        return reply.send({
            coordinator: {
                email: coordinator.email,
                collegeEmailDomain: coordinator.domain,
                studentCount: domainUsers.length,
            },
            contests: contests.map(contestSummary),
            rows,
        });
    });

    fastify.get("/monitor/users/:userId/profile", async (request, reply) => {
        const params = userProfileParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: params.error.flatten().fieldErrors,
            });
        }

        const rl = checkRateLimit(`monitor:profile:${request.user!.id}`, 120, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ error: "Too Many Requests" });
        }

        const coordinator = await getCoordinatorContext(request, reply);
        if (!coordinator) return;

        const user = await prisma.user.findFirst({
            where: {
                id: params.data.userId,
                email: {
                    endsWith: coordinator.domain,
                    mode: "insensitive",
                },
            },
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
                skills: true,
                workExperience: true,
                education: true,
                jobApplyProfile: true,
            },
        });

        if (!user) {
            return reply.status(404).send({ error: "Student not found" });
        }

        if (!user.jobApplyProfile) {
            return reply.send({
                exists: false,
                user: profileUser(user),
                profile: null,
                resume: null,
            });
        }

        const resume = user.jobApplyProfile.selectedResumeId
            ? await prisma.resume.findFirst({
                  where: {
                      id: user.jobApplyProfile.selectedResumeId,
                      userId: user.id,
                  },
                  select: {
                      id: true,
                      fileName: true,
                      uploadedAt: true,
                  },
              })
            : null;

        return reply.send({
            exists: true,
            user: profileUser(user),
            profile: user.jobApplyProfile,
            resume: resume ? { ...resume, previewUrl: null } : null,
        });
    });
}
