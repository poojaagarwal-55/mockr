import { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { sendQuestionReportEmail } from "../lib/email.js";
import { checkRateLimit } from "../lib/rate-limiter.js";

const VALID_REASONS = [
    "wrong_answer",
    "typo",
    "broken_test_case",
    "misleading",
    "other",
] as const;

const VALID_TYPES = [
    "dsa",
    "sql",
    "cs_fundamentals",
    "system_design",
] as const;

export default async function questionReportRoutes(fastify: FastifyInstance) {
    fastify.addHook("preHandler", fastify.authenticate);

    // POST /question-reports — submit a bug report for a question
    fastify.post("/question-reports", async (request, reply) => {
        const userId = request.user!.id;

        // Rate limit: 10 reports per hour per user (prevents email spam)
        const rl = checkRateLimit(`question-reports:${userId}`, 10, 3_600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Report limit reached. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s before submitting another report.`,
            });
        }

        const {
            questionId,
            questionType,
            questionTitle,
            reason,
            description,
            sessionId,
        } = request.body as {
            questionId:    string;
            questionType:  string;
            questionTitle?: string;
            reason:        string;
            description?:  string;
            sessionId?:    string;
        };

        // ── Validation ──────────────────────────────────────
        if (!questionId?.trim()) {
            return reply.status(400).send({ error: "questionId is required" });
        }
        if (!VALID_TYPES.includes(questionType as any)) {
            return reply.status(400).send({
                error: `questionType must be one of: ${VALID_TYPES.join(", ")}`,
            });
        }
        if (!VALID_REASONS.includes(reason as any)) {
            return reply.status(400).send({
                error: `reason must be one of: ${VALID_REASONS.join(", ")}`,
            });
        }

        // ── Persist ─────────────────────────────────────────
        const report = await prisma.questionReport.create({
            data: {
                userId,
                questionId:    questionId.trim(),
                questionType,
                questionTitle: questionTitle?.trim() || null,
                reason,
                description:   description?.trim() || null,
                sessionId:     sessionId || null,
            },
        });

        fastify.log.info(
            `[QuestionReport] User ${userId} reported ${questionType} question ${questionId} — reason: ${reason}`
        );

        // ── Email notification (fire-and-forget) ─────────────
        // Grab user email from our users table (already synced from Supabase auth)
        let userEmail: string | undefined;
        try {
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { email: true },
            });
            userEmail = user?.email;
        } catch {
            // non-critical
        }

        sendQuestionReportEmail({
            reportId:      report.id,
            userId,
            userEmail,
            questionId:    report.questionId,
            questionType:  report.questionType,
            questionTitle: report.questionTitle,
            reason:        report.reason,
            description:   report.description,
            sessionId:     report.sessionId,
            createdAt:     report.createdAt,
        }); // intentionally not awaited

        return reply.status(201).send({ success: true, reportId: report.id });
    });
}
