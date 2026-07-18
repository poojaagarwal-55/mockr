import { FastifyInstance } from "fastify";
import { cacheGet, cacheDel } from "../lib/redis.js";
import { PassThrough } from "node:stream";
import {
    CreateLatexResumeSchema,
    UpdateLatexResumeSchema,
    LatexAiRequestSchema,
    LatexAiEnhanceSchema,
    LatexAiRephraseSchema,
} from "@interviewforge/shared";
import {
    createLatexResume,
    rebuildLatexResumeFromFormData,
    getUserLatexResumes,
    getLatexResumeById,
    updateLatexResume,
    updateLatexResumeCompiled,
    deleteLatexResume,
    latexAiRewrite,
    latexAiFix,
    latexAiSuggest,
    latexAiChat,
    latexAiGenerateSummary,
    latexAiRephraseSummary,
    latexAiExtractResume,
    extractionHasData,
    latexAiGenerateImprovementQuestions,
    latexAiImproveFormData,
} from "../services/latex-resume-service.js";
import { runLatexAgent } from "../services/latex-agent.js";
import { getResumeById } from "../services/resume-service.js";
import { LATEX_TEMPLATES } from "../services/latex-templates.js";
import { uploadToR2, deleteFromR2, getPresignedDownloadUrl } from "../lib/r2.js";
import { checkRateLimit } from "../lib/rate-limiter.js";
import { cloudRunAuthHeaders } from "../lib/gcp-identity.js";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import {
    getActivePlan,
    requireTokenBudget,
    requireFeatureCountAndConsume,
    recordTokenUsage,
    EntitlementError,
} from "../services/entitlements.js";
import { getEntitlements } from "@interviewforge/shared";

// Crude token estimator: ~4 chars/token. Used for billing LaTeX/tutor budgets.
// We err slightly on the high side so users can't abuse with very long contexts.
function estimateTokens(...parts: unknown[]): number {
    let total = 0;
    for (const p of parts) {
        if (!p) continue;
        const s = typeof p === "string" ? p : JSON.stringify(p);
        total += Math.ceil(s.length / 4);
    }
    return total;
}

const LATEX_COMPILER_URL = process.env.LATEX_COMPILER_URL || "http://localhost:3002";
const CompileLatexResumeSchema = z.object({
    source: z.string().min(1).max(500_000),
});

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

export default async function latexResumeRoutes(fastify: FastifyInstance) {
    // All routes require authentication
    fastify.addHook("preHandler", fastify.authenticate);

    // pdf-parse v1.1.1 — CJS-only module
    async function extractTextFromPdf(buffer: Buffer): Promise<string> {
        const pdfParse = require("pdf-parse");
        const data = await pdfParse(buffer);
        return data.text;
    }

    // ─── List Templates ────────────────────────────────────────
    fastify.get("/latex-resumes/templates", async (_request, reply) => {
        reply.cacheControl("CONFIG");
        return {
            templates: LATEX_TEMPLATES.map(({ slug, name, description }) => ({
                slug,
                name,
                description,
            })),
        };
    });

    // ─── Generate Summary via AI ─────────────────────────────
    fastify.post("/latex-resumes/generate-summary", async (request, reply) => {
        const userId = request.user!.id;
        
        // Rate limit: 20 per 10 mins
        const rl = checkRateLimit(`latex-ai-enhance:${userId}`, 20, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Enhance limit reached. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const parsed = LatexAiEnhanceSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                message: parsed.error.issues[0]?.message || "Invalid input",
            });
        }

        try {
            const summary = await latexAiGenerateSummary(parsed.data.formData);
            return reply.send({ summary });
        } catch (err) {
            fastify.log.error(err, "Failed to generate summary");
            return reply.status(500).send({
                error: "AI Error",
                message: "Failed to generate AI summary.",
            });
        }
    });

    // ─── Rephrase Summary via AI ─────────────────────────────
    fastify.post("/latex-resumes/rephrase-summary", async (request, reply) => {
        const userId = request.user!.id;
        const rl = checkRateLimit(`latex-ai-rephrase:${userId}`, 20, 600_000);
        if (!rl.allowed) return reply.status(429).send({ error: "Too Many Requests" });
        const parsed = LatexAiRephraseSchema.safeParse(request.body);
        if (!parsed.success) return reply.status(400).send({ error: "Validation Error" });

        try {
            const summary = await latexAiRephraseSummary(parsed.data.text);
            return reply.send({ summary });
        } catch (err) {
            fastify.log.error(err, "Failed to rephrase summary");
            return reply.status(500).send({ error: "AI Error" });
        }
    });

    // ─── Extract Resume Data from PDF ────────────────────────
    fastify.post("/latex-resumes/extract-from-pdf", async (request, reply) => {
        const userId = request.user!.id;
        
        const rl = checkRateLimit(`latex-ai-extract:${userId}`, 10, 600_000);
        if (!rl.allowed) return reply.status(429).send({ error: "Too Many Requests" });

        const data = await request.file();
        if (!data) return reply.status(400).send({ error: "No file provided" });
        if (data.mimetype !== "application/pdf") return reply.status(400).send({ error: "Invalid file type" });

        const buffer = await data.toBuffer();
        if (buffer.length > 5 * 1024 * 1024) return reply.status(400).send({ error: "File too large (max 5MB)" });

        let rawText: string;
        try {
            rawText = await extractTextFromPdf(buffer);
        } catch (err) {
            fastify.log.error(err, "Failed to extract text from PDF");
            return reply.status(422).send({ error: "PDF Error", message: "Could not extract text." });
        }

        if (!rawText || rawText.trim().length < 50) {
            return reply.status(422).send({ error: "Insufficient Content", message: "The PDF has no text." });
        }

        try {
            const extraction = await latexAiExtractResume(rawText);
            if (!extractionHasData(extraction)) {
                return reply.status(422).send({
                    error: "Extraction Failed",
                    message: "We couldn't read structured details from this resume. Please upload a clearer, text-based PDF and try again.",
                });
            }
            return reply.send({ extraction });
        } catch (err) {
            fastify.log.error(err, "Failed to extract via AI");
            return reply.status(500).send({ error: "AI Error", message: "Failed to extract data. Please try again." });
        }
    });

    // ─── Generate Improvement Questions ─────────────────────────
    fastify.post("/latex-resumes/improve-questions/:id", async (request, reply) => {
        const userId = request.user!.id;
        const { id } = request.params as { id: string };

        const rl = checkRateLimit(`latex-ai-improve:${userId}`, 10, 600_000);
        if (!rl.allowed) return reply.status(429).send({ error: "Too Many Requests" });

        const resume = await getResumeById(id, userId);
        if (!resume) return reply.status(404).send({ error: "Resume not found" });
        if (!resume.atsAnalysis) return reply.status(400).send({ error: "Resume has not been analyzed yet." });

        try {
            const data = await latexAiGenerateImprovementQuestions(resume.rawText || "", resume.atsAnalysis);
            return reply.send(data);
        } catch (err) {
            fastify.log.error(err, "Failed to generate improvement questions");
            return reply.status(500).send({ error: "AI Error", message: "Failed to generate improvement questions." });
        }
    });

    // ─── Improve FormData with Answers ──────────────────────────
    fastify.post("/latex-resumes/improve-data/:id", async (request, reply) => {
        const userId = request.user!.id;
        const { id } = request.params as { id: string };
        const body = request.body as { qaPairs: { question: string, answer: string }[] };

        if (!body.qaPairs) return reply.status(400).send({ error: "Missing qaPairs array" });

        const resume = await getResumeById(id, userId);
        if (!resume) return reply.status(404).send({ error: "Resume not found" });

        // Entitlement: monthly "improve with AI" count cap.
        try {
            const plan = await getActivePlan(userId);
            const ent = getEntitlements(plan);
            await requireFeatureCountAndConsume(
                userId,
                "resume_improve_ai",
                ent.resumeImproveAiPerMonth,
                plan
            );
        } catch (err) {
            if (err instanceof EntitlementError) {
                return reply.status(err.statusCode).send({
                    error: err.code,
                    message: err.message,
                    plan: err.plan,
                    detail: err.detail,
                });
            }
            throw err;
        }

        try {
            const formData = await latexAiImproveFormData(resume.rawText || "", resume.atsAnalysis || {}, body.qaPairs);
            return reply.send({ formData });
        } catch (err) {
            fastify.log.error(err, "Failed to generate improved resume structure");
            return reply.status(500).send({ error: "AI Error", message: "Failed to improve resume data." });
        }
    });


    // ─── Create LaTeX Resume ───────────────────────────────────
    fastify.post("/latex-resumes", async (request, reply) => {
        const parsed = CreateLatexResumeSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                message: parsed.error.issues[0]?.message || "Invalid input",
            });
        }

        const { title, template, formData } = parsed.data;
        const resume = await createLatexResume(request.user!.id, title, template, formData);
        await cacheDel([`api:users:${request.user!.id}:latex-resumes`]);

        return reply.status(201).send({
            id: resume.id,
            title: resume.title,
            template: resume.template,
            createdAt: resume.createdAt,
            updatedAt: resume.updatedAt,
        });
    });

    // ─── Rebuild Existing LaTeX Resume from FormData ───────────
    fastify.post("/latex-resumes/:id/rebuild", async (request, reply) => {
        const { id } = request.params as { id: string };
        const parsed = CreateLatexResumeSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                message: parsed.error.issues[0]?.message || "Invalid input",
            });
        }

        const existing = await getLatexResumeById(id, request.user!.id);
        if (!existing) {
            return reply.status(404).send({
                error: "Not Found",
                message: "LaTeX resume not found",
            });
        }

        const { title, template, formData } = parsed.data;
        await rebuildLatexResumeFromFormData(id, request.user!.id, title, template, formData);

        return reply.send({
            id,
            title,
            template,
            message: "LaTeX resume rebuilt successfully",
        });
    });

    // ─── List User's LaTeX Resumes ─────────────────────────────
    fastify.get("/latex-resumes", async (request, reply) => {
        const userId = request.user!.id;
        const cacheKey = `api:users:${userId}:latex-resumes`;

        const resumes = await cacheGet(cacheKey, 3600, async () => {
            return getUserLatexResumes(userId);
        });

        reply.cacheControl("NONE");
        return { resumes };
    });

    // ─── Get LaTeX Resume by ID ────────────────────────────────
    fastify.get("/latex-resumes/:id", async (request, reply) => {
        const { id } = request.params as { id: string };
        const resume = await getLatexResumeById(id, request.user!.id);

        if (!resume) {
            return reply.status(404).send({
                error: "Not Found",
                message: "LaTeX resume not found",
            });
        }
        reply.cacheControl("NONE");
        return {
            id: resume.id,
            title: resume.title,
            latexSource: resume.latexSource,
            template: resume.template,
            compiledUrl: resume.compiledUrl,
            compiledAt: resume.compiledAt,
            createdAt: resume.createdAt,
            updatedAt: resume.updatedAt,
        };
    });

    // ─── Update LaTeX Resume (auto-save) ───────────────────────
    fastify.patch("/latex-resumes/:id", async (request, reply) => {
        const { id } = request.params as { id: string };
        const parsed = UpdateLatexResumeSchema.safeParse(request.body);

        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                message: parsed.error.issues[0]?.message || "Invalid input",
            });
        }

        const resume = await getLatexResumeById(id, request.user!.id);
        if (!resume) {
            return reply.status(404).send({
                error: "Not Found",
                message: "LaTeX resume not found",
            });
        }

        await updateLatexResume(id, request.user!.id, parsed.data);
        await cacheDel([`api:users:${request.user!.id}:latex-resumes`]);
        return { message: "Updated successfully" };
    });

    // ─── Delete LaTeX Resume ───────────────────────────────────
    fastify.delete("/latex-resumes/:id", async (request, reply) => {
        const { id } = request.params as { id: string };
        const resume = await getLatexResumeById(id, request.user!.id);

        if (!resume) {
            return reply.status(404).send({
                error: "Not Found",
                message: "LaTeX resume not found",
            });
        }

        // Clean up compiled PDF from R2 if exists
        if (resume.compiledUrl) {
            try {
                const url = new URL(resume.compiledUrl);
                const objectKey = url.pathname.replace(/^\//, "").split("/").slice(1).join("/");
                await deleteFromR2(objectKey);
            } catch (err) {
                fastify.log.error(err, "Failed to delete compiled PDF from R2");
            }
        }

        await deleteLatexResume(id, request.user!.id);
        await cacheDel([`api:users:${request.user!.id}:latex-resumes`]);
        return { message: "LaTeX resume deleted successfully" };
    });

    // ─── Compile LaTeX to PDF ──────────────────────────────────
    fastify.post("/latex-resumes/:id/compile", async (request, reply) => {
        const { id } = request.params as { id: string };
        const userId = request.user!.id;
        const parsedBody = CompileLatexResumeSchema.safeParse(request.body);

        if (!parsedBody.success) {
            return reply.status(400).send({
                error: "Validation Error",
                message: parsedBody.error.issues[0]?.message || "Invalid input",
            });
        }

        // Rate limit: 10 compiles per 10 minutes
        const rl = checkRateLimit(`latex-compile:${userId}`, 10, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Compile limit reached. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const resume = await getLatexResumeById(id, userId);
        if (!resume) {
            return reply.status(404).send({
                error: "Not Found",
                message: "LaTeX resume not found",
            });
        }

        const sourceToCompile = parsedBody.data.source;

        // Compile via Docker latex-compiler service
        let compileResult: {
            success: boolean;
            pdf?: string;
            errors?: { line: number; message: string; severity: string }[];
            warnings?: string[];
        };

        try {
            const compileResponse = await fetch(`${LATEX_COMPILER_URL}/compile`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...await cloudRunAuthHeaders(LATEX_COMPILER_URL),
                },
                body: JSON.stringify({ source: sourceToCompile }),
                signal: AbortSignal.timeout(60_000),
            });
            compileResult = await compileResponse.json() as typeof compileResult;
        } catch (err) {
            fastify.log.error(err, "LaTeX compiler service unreachable");
            return reply.status(503).send({
                success: false,
                errors: [{
                    line: 0,
                    message: "LaTeX compiler service is not running. Start it with: docker compose up latex-compiler",
                    severity: "error",
                }],
                warnings: [],
            });
        }

        if (!compileResult.success || !compileResult.pdf) {
            return reply.status(422).send({
                success: false,
                errors: compileResult.errors || [],
                warnings: compileResult.warnings || [],
            });
        }

        // Upload compiled PDF to R2
        const pdfBuffer = Buffer.from(compileResult.pdf, "base64");
        const objectKey = `latex-pdfs/${userId}/${id}-${uuidv4().slice(0, 8)}.pdf`;

        try {
            const fileUrl = await uploadToR2(objectKey, pdfBuffer, "application/pdf");
            await updateLatexResumeCompiled(id, userId, fileUrl);
            const presignedUrl = await getPresignedDownloadUrl(objectKey, 300);

            return {
                success: true,
                pdfUrl: presignedUrl,
                warnings: compileResult.warnings || [],
            };
        } catch (err) {
            fastify.log.error(err, "Failed to upload compiled PDF to R2");
            return reply.status(500).send({
                error: "Upload Error",
                message: "Compilation succeeded but failed to store the PDF. Please try again.",
            });
        }
    });

    // ─── Download Compiled PDF ─────────────────────────────────
    fastify.get("/latex-resumes/:id/download", async (request, reply) => {
        const { id } = request.params as { id: string };
        const resume = await getLatexResumeById(id, request.user!.id);

        if (!resume) {
            return reply.status(404).send({
                error: "Not Found",
                message: "LaTeX resume not found",
            });
        }

        if (!resume.compiledUrl) {
            return reply.status(400).send({
                error: "Not Compiled",
                message: "This resume has not been compiled yet. Compile it first.",
            });
        }

        try {
            const url = new URL(resume.compiledUrl);
            const objectKey = url.pathname.replace(/^\//, "").split("/").slice(1).join("/");
            const presignedUrl = await getPresignedDownloadUrl(objectKey, 300);
            reply.cacheControl("USER_MEDIUM");
            return { url: presignedUrl };
        } catch (err) {
            fastify.log.error(err, "Failed to generate presigned URL for compiled PDF");
            return reply.status(500).send({
                error: "Download Error",
                message: "Failed to generate download link. Please try again.",
            });
        }
    });

    // ─── AI Assistance ─────────────────────────────────────────
    fastify.post("/latex-resumes/:id/ai", async (request, reply) => {
        const { id } = request.params as { id: string };
        const userId = request.user!.id;

        // Rate limit: 20 AI requests per 10 minutes
        const rl = checkRateLimit(`latex-ai:${userId}`, 20, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `AI request limit reached. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const parsed = LatexAiRequestSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                message: parsed.error.issues[0]?.message || "Invalid input",
            });
        }

        // Verify ownership
        const resume = await getLatexResumeById(id, userId);
        if (!resume) {
            return reply.status(404).send({
                error: "Not Found",
                message: "LaTeX resume not found",
            });
        }

        const { action, selectedText, chatMessage, fullSource } = parsed.data;

        // Entitlement: LaTeX AI is gated + token-budgeted per plan.
        let plan;
        try {
            plan = await getActivePlan(userId);
            const ent = getEntitlements(plan);
            if (!ent.latexAiAccess) {
                return reply.status(403).send({
                    error: "FEATURE_LOCKED",
                    message: "Upgrade to Plus or higher to use AI in the LaTeX editor.",
                    plan,
                });
            }
            await requireTokenBudget(userId, "latex_ai_tokens", ent.latexAiMonthlyTokens, plan);
        } catch (err) {
            if (err instanceof EntitlementError) {
                return reply.status(err.statusCode).send({
                    error: err.code,
                    message: err.message,
                    plan: err.plan,
                    detail: err.detail,
                });
            }
            throw err;
        }

        try {
            let result: unknown;

            switch (action) {
                case "rewrite":
                    if (!selectedText) {
                        return reply.status(400).send({
                            error: "Bad Request",
                            message: "selectedText is required for rewrite action",
                        });
                    }
                    result = await latexAiRewrite(selectedText, fullSource);
                    break;

                case "fix":
                    result = await latexAiFix(fullSource);
                    break;

                case "suggest":
                    result = await latexAiSuggest(fullSource);
                    break;

                case "chat":
                    if (!chatMessage) {
                        return reply.status(400).send({
                            error: "Bad Request",
                            message: "chatMessage is required for chat action",
                        });
                    }
                    result = await latexAiChat(chatMessage, fullSource);
                    break;
            }

            // Record token usage post-call. Uses a conservative estimate
            // because underlying services don't surface exact token counts.
            await recordTokenUsage(
                userId,
                "latex_ai_tokens",
                estimateTokens(fullSource, selectedText, chatMessage, result)
            );

            return result;
        } catch (err) {
            fastify.log.error(err, "LaTeX AI assistance failed");
            return reply.status(500).send({
                error: "AI Error",
                message: "AI assistance request failed. Please try again.",
            });
        }
    });

    // ─── Agentic AI (SSE streaming) ────────────────────────────
    fastify.post("/latex-resumes/:id/agent", async (request, reply) => {
        const { id } = request.params as { id: string };
        const userId = request.user!.id;

        // Rate limit: 5 agent runs per 10 minutes (each can trigger multiple compiles)
        const rl = checkRateLimit(`latex-agent:${userId}`, 5, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Agent limit reached. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const body = request.body as { message?: string; source?: string };
        const message = body?.message?.trim();
        const source = body?.source;

        if (!message || !source) {
            return reply.status(400).send({ error: "Bad Request", message: "message and source are required" });
        }

        // Verify ownership
        const resume = await getLatexResumeById(id, userId);
        if (!resume) {
            return reply.status(404).send({ error: "Not Found", message: "LaTeX resume not found" });
        }

        const stream = new PassThrough();

        // Stream SSE
        reply.header("Content-Type", "text/event-stream");
        reply.header("Cache-Control", "no-cache");
        reply.header("Connection", "keep-alive");
        reply.header("X-Accel-Buffering", "no");

        const send = (event: Record<string, unknown>) => {
            stream.write(`data: ${JSON.stringify(event)}\n\n`);
        };

        // Run agent async so we immediately send the stream back to Fastify
        void (async () => {
            try {
                for await (const event of runLatexAgent(message, source)) {
                    send(event);
                    if (event.type === "done" || event.type === "error") break;
                }
            } catch (err) {
                fastify.log.error(err, "LaTeX agent failed");
                send({ type: "error", message: "Agent encountered an unexpected error." });
            } finally {
                stream.end();
            }
        })();

        return reply.send(stream);
    });
}
