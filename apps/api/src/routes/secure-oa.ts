import { gzipSync } from "node:zlib";
import crypto from "node:crypto";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import secureOaSessionRoutes from "./secure-oa/sessions.js";

const DEFAULT_DURATION_MINUTES = 75;
const MAX_DURATION_MINUTES = 600;
const TOKEN_TTL_MS = 60 * 60 * 1000;

const createSessionSchema = z.object({
    assessmentId: z.string().min(1).max(120).default("secure-oa-smoke-test"),
    jobId: z.string().min(1).max(120).default("test-job"),
    companyId: z.string().min(1).max(120).default("test-company"),
    durationMinutes: z
        .number()
        .int()
        .min(1)
        .max(MAX_DURATION_MINUTES)
        .default(DEFAULT_DURATION_MINUTES),
});

const telemetrySchema = z.object({
    type: z.enum([
        "exam_started",
        "face_verified",
        "no_face_detected",
        "multiple_faces_detected",
        "tab_switch_attempt",
        "clipboard_activity",
        "usb_inserted",
        "forbidden_process_detected",
        "remote_desktop_detected",
        "vm_detected",
        "confidence_score_update",
        "exam_submitted",
    ]),
    occurredAt: z.string().datetime().optional(),
    metadata: z.record(z.unknown()).optional().default({}),
});

type SecureOaSession = {
    sessionId: string;
    userId: string;
    candidateId: string;
    companyId: string;
    jobId: string;
    assessmentId: string;
    roundCandidateId?: string | null;
    durationMinutes: number;
    assessment?: Record<string, unknown> | null;
    allowedDomains: string[];
    expiresAt: number;
    createdAt: number;
};

const sessions = new Map<string, SecureOaSession>();
const jobRoundCandidate = (prisma as any).jobRoundCandidate;
const telemetryEvents: Array<{
    sessionId: string;
    userId: string;
    type: z.infer<typeof telemetrySchema>["type"];
    occurredAt: string;
    metadata: Record<string, unknown>;
}> = [];

function base64Url(input: string): string {
    return Buffer.from(input).toString("base64url");
}

function getSigningSecret(): string {
    return process.env.SECURE_OA_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "dev-only-secure-oa-secret";
}

function signPayload(payload: Record<string, unknown>): string {
    const body = base64Url(JSON.stringify(payload));
    const signature = crypto
        .createHmac("sha256", getSigningSecret())
        .update(body)
        .digest("base64url");
    return `${body}.${signature}`;
}

function verifyPayload(token: string): Record<string, any> | null {
    const [body, signature] = token.split(".");
    if (!body || !signature) return null;

    const expected = crypto
        .createHmac("sha256", getSigningSecret())
        .update(body)
        .digest("base64url");

    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (
        signatureBuffer.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
        return null;
    }

    try {
        return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    } catch {
        return null;
    }
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function createSebExamFile(config: {
    startUrl: string;
    quitUrl: string;
    durationMinutes: number;
}): Buffer {
    const adminHash = "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9";
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>startURL</key>
  <string>${escapeXml(config.startUrl)}</string>
  <key>quitURL</key>
  <string>${escapeXml(config.quitUrl)}</string>
  <key>examDurationMinutes</key>
  <integer>${config.durationMinutes}</integer>
  <key>hashedAdminPassword</key>
  <string>${adminHash}</string>
  <key>hashedQuitPassword</key>
  <string>${adminHash}</string>
</dict>
</plist>`;

    return gzipSync(Buffer.from(plist, "utf8"));
}

function getWebOrigin(request: any): string {
    const configured = process.env.FRONTEND_URL?.trim();
    if (configured) return configured.replace(/\/$/, "");

    const origin = request.headers.origin;
    if (typeof origin === "string" && origin) return origin.replace(/\/$/, "");

    return "http://localhost:3000";
}

function assertSessionOwner(sessionId: string, userId: string) {
    const session = sessions.get(sessionId);
    if (!session || session.userId !== userId || session.expiresAt <= Date.now()) {
        return null;
    }
    return session;
}

function toRecord(value: unknown): Record<string, any> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function isSmokeAssessment(assessmentId: string) {
    return assessmentId === "secure-oa-smoke-test";
}

function publicAssessmentConfig(round: any) {
    const config = toRecord(toRecord(round.config).onlineAssessment);
    const questions = Array.isArray(config.questions) ? config.questions : [];
    if (!questions.length) return null;

    return {
        title: config.title || round.title || "Online assessment",
        startAt: config.startAt || round.opensAt?.toISOString?.() || null,
        endAt: config.endAt || round.closesAt?.toISOString?.() || null,
        durationMinutes: Number(config.durationMinutes || 0) || DEFAULT_DURATION_MINUTES,
        instructions: config.instructions || "",
        questionCount: Number(config.questionCount || questions.length || 0),
        questions: questions.map((question: any, index: number) => ({
            id: question.id || `${round.id}-${index}`,
            questionId: question.questionId || String(question.id || "").split(":").pop() || null,
            text: question.text || "Assessment question",
            type: question.type || null,
            difficulty: question.difficulty || null,
            timeLimitMinutes: Number(question.timeLimitMinutes || 0) || null,
            aiInterviewEnabled: Boolean(question.aiInterviewEnabled),
            orderIndex: Number(question.orderIndex ?? index),
        })),
        allowLateStart: Boolean(config.allowLateStart),
    };
}

async function resolveCompanyAssessment(input: z.infer<typeof createSessionSchema>, userId: string, sessionId: string) {
    if (isSmokeAssessment(input.assessmentId)) {
        return {
            companyId: input.companyId,
            jobId: input.jobId,
            durationMinutes: input.durationMinutes,
            expiresAt: Date.now() + TOKEN_TTL_MS,
            assessment: null,
            roundCandidateId: null,
        };
    }

    const candidateRound = await jobRoundCandidate.findFirst({
        where: {
            userId,
            roundId: input.assessmentId,
            round: { roundType: "mock_oa" },
        },
        include: {
            round: {
                select: {
                    id: true,
                    companyId: true,
                    jobId: true,
                    title: true,
                    status: true,
                    opensAt: true,
                    closesAt: true,
                    config: true,
                },
            },
        },
    });

    if (!candidateRound?.round) {
        return { error: "Online assessment not found for this account.", statusCode: 404 as const };
    }
    if (candidateRound.submittedAt || candidateRound.status === "submitted" || candidateRound.status === "evaluated") {
        return { error: "This online assessment has already been submitted.", statusCode: 409 as const };
    }

    const assessment = publicAssessmentConfig(candidateRound.round);
    if (!assessment) {
        return { error: "This online assessment is not published yet.", statusCode: 409 as const };
    }

    const now = Date.now();
    const startAt = assessment.startAt ? new Date(String(assessment.startAt)).getTime() : 0;
    const endAt = assessment.endAt ? new Date(String(assessment.endAt)).getTime() : 0;
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
        return { error: "This online assessment schedule is invalid.", statusCode: 409 as const };
    }
    if (now < startAt) {
        return { error: "This online assessment has not opened yet.", statusCode: 403 as const };
    }
    if (now >= endAt) {
        return { error: "This online assessment window has closed.", statusCode: 403 as const };
    }

    const durationMinutes = Math.max(1, Math.min(MAX_DURATION_MINUTES, Number(assessment.durationMinutes || DEFAULT_DURATION_MINUTES)));
    const requestedExpiry = now + durationMinutes * 60_000;
    if (!assessment.allowLateStart && requestedExpiry > endAt) {
        return { error: "There is not enough time left to start this online assessment.", statusCode: 403 as const };
    }

    const expiresAt = Math.min(requestedExpiry, endAt);
    const metadata = toRecord(candidateRound.metadata);
    await jobRoundCandidate.update({
        where: { id: candidateRound.id },
        data: {
            status: "in_progress",
            metadata: {
                ...metadata,
                oaSessionId: sessionId,
                oaStartedAt: new Date(now).toISOString(),
            },
        },
    });

    return {
        companyId: candidateRound.round.companyId,
        jobId: candidateRound.round.jobId,
        durationMinutes,
        expiresAt,
        assessment,
        roundCandidateId: candidateRound.id,
    };
}

export default async function secureOaRoutes(fastify: FastifyInstance) {
    await secureOaSessionRoutes(fastify);

    fastify.post(
        "/secure-oa/sessions",
        { preHandler: [fastify.authenticate] },
        async (request, reply) => {
            const validation = createSessionSchema.safeParse(request.body ?? {});
            if (!validation.success) {
                return reply.status(400).send({
                    error: "Validation Error",
                    details: validation.error.flatten().fieldErrors,
                });
            }

            const userId = request.user!.id;
            const sessionId = crypto.randomUUID();
            const webOrigin = getWebOrigin(request);
            const allowedDomains = [new URL(webOrigin).host];

            const {
                assessmentId,
            } = validation.data;

            const resolved = await resolveCompanyAssessment(validation.data, userId, sessionId);
            if ("error" in resolved) {
                return reply.status(resolved.statusCode).send({
                    error: "Online Assessment Unavailable",
                    message: resolved.error,
                });
            }

            const session: SecureOaSession = {
                assessmentId,
                jobId: resolved.jobId,
                companyId: resolved.companyId,
                durationMinutes: resolved.durationMinutes,
                sessionId,
                userId,
                candidateId: userId,
                roundCandidateId: resolved.roundCandidateId,
                assessment: resolved.assessment,
                allowedDomains,
                expiresAt: resolved.expiresAt,
                createdAt: Date.now(),
            };

            sessions.set(sessionId, session);

            const launchToken = signPayload({
                sessionId,
                candidateId: session.candidateId,
                companyId: session.companyId,
                jobId: session.jobId,
                assessmentId: session.assessmentId,
                allowedDomains,
                exp: session.expiresAt,
            });

            return reply.send({
                sessionId,
                expiresAt: new Date(session.expiresAt).toISOString(),
                launchUrl: `${webOrigin}/secure-oa/session/${sessionId}?token=${encodeURIComponent(launchToken)}`,
                protocolUrl: `interviewforge://start?token=${encodeURIComponent(launchToken)}`,
                configUrl: `/secure-oa/sessions/${sessionId}/config`,
            });
        }
    );

    fastify.get(
        "/secure-oa/sessions/:sessionId/config",
        { preHandler: [fastify.authenticate] },
        async (request, reply) => {
            const { sessionId } = request.params as { sessionId: string };
            const session = assertSessionOwner(sessionId, request.user!.id);

            if (!session) {
                return reply.status(404).send({
                    error: "Not Found",
                    message: "Secure OA session not found or expired",
                });
            }

            const webOrigin = getWebOrigin(request);
            const launchToken = signPayload({
                sessionId,
                candidateId: session.candidateId,
                companyId: session.companyId,
                jobId: session.jobId,
                assessmentId: session.assessmentId,
                allowedDomains: session.allowedDomains,
                exp: session.expiresAt,
            });
            const startUrl = `${webOrigin}/secure-oa/session/${sessionId}?token=${encodeURIComponent(launchToken)}`;
            const config = createSebExamFile({
                startUrl,
                quitUrl: `${webOrigin}/secure-oa/session/${sessionId}/complete`,
                durationMinutes: session.durationMinutes,
            });

            return reply
                .header("Content-Type", "application/x-sebexam")
                .header("Content-Disposition", `attachment; filename="interviewforge-${sessionId}.sebexam"`)
                .send(config);
        }
    );

    fastify.post(
        "/secure-oa/sessions/:sessionId/telemetry",
        { preHandler: [fastify.authenticate] },
        async (request, reply) => {
            const { sessionId } = request.params as { sessionId: string };
            const session = assertSessionOwner(sessionId, request.user!.id);

            if (!session) {
                return reply.status(404).send({
                    error: "Not Found",
                    message: "Secure OA session not found or expired",
                });
            }

            const validation = telemetrySchema.safeParse(request.body);
            if (!validation.success) {
                return reply.status(400).send({
                    error: "Validation Error",
                    details: validation.error.flatten().fieldErrors,
                });
            }

            telemetryEvents.push({
                sessionId,
                userId: request.user!.id,
                type: validation.data.type,
                occurredAt: validation.data.occurredAt ?? new Date().toISOString(),
                metadata: validation.data.metadata,
            });

            if (session.roundCandidateId && (validation.data.type === "exam_started" || validation.data.type === "exam_submitted")) {
                const existing = await jobRoundCandidate.findUnique({
                    where: { id: session.roundCandidateId },
                    select: { metadata: true },
                }).catch(() => null);
                const metadata = toRecord(existing?.metadata);
                const occurredAt = validation.data.occurredAt ?? new Date().toISOString();
                await jobRoundCandidate.update({
                    where: { id: session.roundCandidateId },
                    data: validation.data.type === "exam_submitted"
                        ? {
                            status: "submitted",
                            submittedAt: new Date(occurredAt),
                            metadata: { ...metadata, oaSubmittedAt: occurredAt },
                        }
                        : {
                            status: "in_progress",
                            metadata: { ...metadata, oaStartedAt: metadata.oaStartedAt || occurredAt },
                        },
                }).catch(() => null);
            }

            return reply.status(202).send({ success: true });
        }
    );

    fastify.get(
        "/secure-oa/sessions/:sessionId/validate",
        async (request, reply) => {
            const { sessionId } = request.params as { sessionId: string };
            const { token } = request.query as { token?: string };
            if (!token) {
                return reply.status(401).send({ error: "Unauthorized" });
            }

            const payload = verifyPayload(token);
            const session = sessions.get(sessionId);
            if (
                !payload ||
                !session ||
                payload.sessionId !== sessionId ||
                payload.exp <= Date.now() ||
                session.expiresAt <= Date.now()
            ) {
                return reply.status(401).send({ error: "Unauthorized" });
            }

            return reply.send({
                sessionId,
                assessmentId: session.assessmentId,
                durationMinutes: session.durationMinutes,
                assessment: session.assessment,
                allowedDomains: session.allowedDomains,
                expiresAt: new Date(session.expiresAt).toISOString(),
            });
        }
    );
}
