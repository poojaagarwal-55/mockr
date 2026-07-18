import { FastifyInstance } from "fastify";
import { cacheGet, cacheDel } from "../lib/redis.js";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import {
    analyzeResume,
    createResume,
    getUserResumes,
    getResumeById,
    deleteResume,
    updateResumeAnalysis,
    updateResumeFileName,
    analyzeResumeATS,
    updateResumeAtsAnalysis,
    validateIsResume,
} from "../services/resume-service.js";
import { uploadToR2, deleteFromR2, getPresignedDownloadUrl } from "../lib/r2.js";
import { checkRateLimit } from "../lib/rate-limiter.js";
import {
    getActivePlan,
    requireFeatureCountAndConsume,
    EntitlementError,
} from "../services/entitlements.js";
import { getEntitlements } from "@interviewforge/shared";

// pdf-parse v1.1.1 — CJS-only module, needs createRequire in ESM context
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
    const pdfParse = require("pdf-parse");
    const data = await pdfParse(buffer);
    return data.text;
}

export default async function resumeRoutes(fastify: FastifyInstance) {
    // All routes require authentication
    fastify.addHook("preHandler", fastify.authenticate);

    // ─── Upload & Analyze Resume ──────────────────────────────
    fastify.post("/resumes/upload", async (request, reply) => {
        // Rate limit: 5 uploads per 10 minutes per user
        const rl = checkRateLimit(`upload:${request.user!.id}`, 5, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Upload limit reached. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s before uploading again.`,
            });
        }

        const data = await request.file();

        if (!data) {
            return reply.status(400).send({
                error: "No file provided",
                message: "Please upload a PDF file",
            });
        }

        // Validate file type
        if (data.mimetype !== "application/pdf") {
            return reply.status(400).send({
                error: "Invalid file type",
                message: "Only PDF files are accepted",
            });
        }

        const buffer = await data.toBuffer();

        // Validate file size (5MB max)
        if (buffer.length > 5 * 1024 * 1024) {
            return reply.status(400).send({
                error: "File too large",
                message: "Maximum file size is 5MB",
            });
        }

        // 1. Upload to Cloudflare R2
        const fileId = uuidv4();
        const ext = path.extname(data.filename) || ".pdf";
        const objectKey = `resumes/${fileId}${ext}`;
        let fileUrl: string;

        try {
            fileUrl = await uploadToR2(objectKey, buffer, "application/pdf");
        } catch (err) {
            fastify.log.error(err, "Failed to upload PDF to Cloudflare R2");
            return reply.status(500).send({
                error: "Upload Error",
                message: "Failed to upload the file. Please try again.",
            });
        }

        // 2. Extract text from PDF
        let rawText: string;
        try {
            rawText = await extractTextFromPdf(buffer);
        } catch (err) {
            fastify.log.error(err, "Failed to extract text from PDF");
            // Clean up the already-uploaded file from R2
            await deleteFromR2(objectKey).catch((e) => fastify.log.error(e, "Failed to clean up R2 orphan"));
            return reply.status(422).send({
                error: "PDF Processing Error",
                message: "Could not extract text from the uploaded PDF. Please ensure it contains selectable text.",
            });
        }

        if (!rawText || rawText.trim().length < 50) {
            // Clean up the already-uploaded file from R2
            await deleteFromR2(objectKey).catch((e) => fastify.log.error(e, "Failed to clean up R2 orphan"));
            return reply.status(422).send({
                error: "Insufficient Content",
                message: "The PDF appears to have very little text content. Please upload a text-based resume (not a scanned image).",
            });
        }

        // 2b. Validate the document is actually a resume using AI
        try {
            const validation = await validateIsResume(rawText);
            if (!validation.isResume) {
                await deleteFromR2(objectKey).catch((e) => fastify.log.error(e, "Failed to clean up R2 orphan"));
                return reply.status(422).send({
                    error: "Not a Resume",
                    message: validation.reason || "The uploaded document does not appear to be a resume. Please upload a valid resume/CV.",
                });
            }
        } catch (err) {
            fastify.log.warn(err, "Resume validation AI check failed, proceeding with upload");
            // Don't block upload if AI check fails — fall through gracefully
        }

        // 3. Save to database
        const resume = await createResume(
            request.user!.id,
            data.filename,
            fileUrl,
            rawText,
            null
        );

        // 4. Invalidate cached resume list so the new upload appears immediately
        await cacheDel([`api:users:${request.user!.id}:resumes`]);

        return reply.status(201).send({
            id: resume.id,
            fileName: resume.fileName,
            fileUrl: resume.fileUrl,
            analysis: resume.analysis,
            atsAnalysis: resume.atsAnalysis,
            uploadedAt: resume.uploadedAt,
        });
    });

    // ─── Analyze Resume ───────────────────────────────────────────
    fastify.post("/resumes/:id/analyze", async (request, reply) => {
        const { id } = request.params as { id: string };
        const userId = request.user!.id;

        // Rate limit: 5 AI analyses per hour per user
        const rl = checkRateLimit(`resume:analyze:${userId}`, 5, 3_600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Resume analysis limit reached. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s before analyzing again.`,
            });
        }

        const resume = await getResumeById(id, userId);
        if (!resume) {
            return reply.status(404).send({
                error: "Not Found",
                message: "Resume not found",
            });
        }

        if (resume.analysis) {
            return reply.status(400).send({
                error: "Already Analyzed",
                message: "This resume has already been analyzed.",
            });
        }

        if (!resume.rawText) {
            return reply.status(400).send({
                error: "No text content",
                message: "This resume does not have extracted text to analyze."
            });
        }

        // Entitlement: monthly count-based cap per plan.
        try {
            const plan = await getActivePlan(userId);
            const ent = getEntitlements(plan);
            await requireFeatureCountAndConsume(
                userId,
                "resume_analysis",
                ent.resumeAnalysisPerMonth,
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

        let analysis;
        try {
            analysis = await analyzeResume(resume.rawText);
        } catch (err) {
            fastify.log.error(err, "Failed to analyze resume with AI");
            return reply.status(500).send({
                error: "Analysis Error",
                message: "Failed to analyze the resume. Please try again.",
            });
        }

        await updateResumeAnalysis(id, userId, analysis);

        await cacheDel([`api:users:${userId}:resumes`]);

        return reply.status(200).send({
            message: "Resume analyzed successfully",
            analysis,
        });
    });

    // ─── Analyze Resume ATS ───────────────────────────────────────
    fastify.post("/resumes/:id/analyze-ats", async (request, reply) => {
        const { id } = request.params as { id: string };
        const { mode, jobDescription, roleId } = request.body as { mode: "jd" | "role", jobDescription?: string, roleId?: string };
        const userId = request.user!.id;

        // Rate limit: 10 ATS analyses per hour per user
        const rl = checkRateLimit(`resume:analyze-ats:${userId}`, 10, 3_600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `ATS analysis limit reached. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s before analyzing again.`,
            });
        }

        if (!mode || (mode === "jd" && !jobDescription) || (mode === "role" && !roleId)) {
            return reply.status(400).send({
                error: "Bad Request",
                message: "Missing required ATS configuration (mode and context)."
            });
        }

        const resume = await getResumeById(id, userId);
        if (!resume) {
            return reply.status(404).send({
                error: "Not Found",
                message: "Resume not found",
            });
        }

        if (!resume.rawText) {
            return reply.status(400).send({
                error: "No text content",
                message: "This resume does not have extracted text to analyze."
            });
        }

        // Entitlement: monthly count-based cap per plan (same as regular analysis)
        try {
            const plan = await getActivePlan(userId);
            const ent = getEntitlements(plan);
            await requireFeatureCountAndConsume(
                userId,
                "resume_analysis",
                ent.resumeAnalysisPerMonth,
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

        let atsAnalysis;
        try {
            atsAnalysis = await analyzeResumeATS(resume.rawText, mode, mode === "jd" ? jobDescription! : roleId!);
        } catch (err) {
            fastify.log.error(err, "Failed to analyze ATS for resume");
            return reply.status(500).send({
                error: "Analysis Error",
                message: "Failed to run ATS analysis on the resume. Please try again.",
            });
        }

        // Augment the stored analysis with mode metadata so the frontend can display context tags
        const atsAnalysisWithMeta = {
            ...atsAnalysis,
            _meta: {
                mode,
                contextLabel: mode === "jd" ? "Job Description" : roleId!,
            },
        };

        await updateResumeAtsAnalysis(id, userId, atsAnalysisWithMeta);
        await cacheDel([`api:users:${userId}:resumes`]);

        return reply.status(200).send({
            message: "Resume ATS analysis successfully completed.",
            atsAnalysis: atsAnalysisWithMeta,
        });
    });

    // ─── List User's Resumes ──────────────────────────────────
    fastify.get("/resumes", async (request, reply) => {
        const userId = request.user!.id;
        const cacheKey = `api:users:${userId}:resumes`;

        const resumes = await cacheGet(cacheKey, 3600, async () => {
            return getUserResumes(userId);
        });

        reply.cacheControl("NONE");
        return { resumes };
    });

    // ─── Get Resume by ID ─────────────────────────────────────
    fastify.get("/resumes/:id", async (request, reply) => {
        const { id } = request.params as { id: string };
        const resume = await getResumeById(id, request.user!.id);

        if (!resume) {
            return reply.status(404).send({
                error: "Not Found",
                message: "Resume not found",
            });
        }

        reply.cacheControl("USER_SHORT");
        return {
            id: resume.id,
            fileName: resume.fileName,
            fileUrl: resume.fileUrl,
            analysis: resume.analysis,
            atsAnalysis: resume.atsAnalysis,
            uploadedAt: resume.uploadedAt,
        };
    });

    // ─── Download Resume (Presigned URL) ──────────────────────
    fastify.get("/resumes/:id/download", async (request, reply) => {
        const { id } = request.params as { id: string };
        const resume = await getResumeById(id, request.user!.id);

        if (!resume) {
            return reply.status(404).send({
                error: "Not Found",
                message: "Resume not found",
            });
        }

        try {
            let objectKey: string;

            if (resume.fileUrl.startsWith("/uploads/resumes/")) {
                // Legacy local file URL — extract filename and construct R2 key
                const filename = resume.fileUrl.replace("/uploads/resumes/", "");
                objectKey = `resumes/${filename}`;
            } else if (resume.fileUrl.startsWith("/uploads/")) {
                // Another legacy format — extract filename and construct R2 key
                const filename = resume.fileUrl.replace("/uploads/", "");
                objectKey = `resumes/${filename}`;
            } else if (resume.fileUrl.startsWith("http")) {
                // R2 URL — extract key from the URL path (strip bucket prefix)
                const pathSegments = new URL(resume.fileUrl).pathname.replace(/^\//, "").split("/");
                objectKey = pathSegments.slice(1).join("/");
            } else {
                // Invalid URL format
                throw new Error(`Invalid file URL format: ${resume.fileUrl}`);
            }

            const url = await getPresignedDownloadUrl(objectKey);
            reply.cacheControl("USER_MEDIUM");
            return { url };
        } catch (err) {
            fastify.log.error(err, "Failed to generate presigned URL");
            return reply.status(500).send({
                error: "Download Error",
                message: "Failed to generate download link. Please try again.",
            });
        }
    });

    // ─── Rename Resume ────────────────────────────────────────
    fastify.patch("/resumes/:id", async (request, reply) => {
        const { id } = request.params as { id: string };
        const { fileName } = request.body as { fileName?: string };

        const trimmed = fileName?.trim();
        if (!trimmed) {
            return reply.status(400).send({ error: "Bad Request", message: "fileName is required" });
        }
        if (trimmed.length > 100) {
            return reply.status(400).send({ error: "Bad Request", message: "Name must be 100 characters or fewer" });
        }

        const resume = await getResumeById(id, request.user!.id);
        if (!resume) {
            return reply.status(404).send({ error: "Not Found", message: "Resume not found" });
        }

        // Preserve .pdf extension if the stored name had one
        const ext = resume.fileName.toLowerCase().endsWith(".pdf") ? ".pdf" : "";
        const newName = trimmed.toLowerCase().endsWith(".pdf") ? trimmed : trimmed + ext;

        await updateResumeFileName(id, request.user!.id, newName);
        await cacheDel([`api:users:${request.user!.id}:resumes`]);

        return { id, fileName: newName };
    });

    // ─── Delete Resume ────────────────────────────────────────
    fastify.delete("/resumes/:id", async (request, reply) => {
        const { id } = request.params as { id: string };

        // Fetch the resume first to get the R2 object key
        const resume = await getResumeById(id, request.user!.id);
        if (!resume) {
            return reply.status(404).send({
                error: "Not Found",
                message: "Resume not found",
            });
        }

        // Delete file from Cloudflare R2
        try {
            const pathSegments = new URL(resume.fileUrl).pathname.replace(/^\//, "").split("/");
            // Strip the bucket name prefix (first segment) since deleteFromR2 specifies bucket separately
            const objectKey = pathSegments.slice(1).join("/");
            await deleteFromR2(objectKey);
        } catch (err) {
            fastify.log.error(err, "Failed to delete file from R2, proceeding with DB deletion");
        }

        // Delete DB record
        await deleteResume(id, request.user!.id);
        await cacheDel([
            `api:users:${request.user!.id}:resumes`,
            `api:users:${request.user!.id}:profile`
        ]);

        return { message: "Resume deleted successfully" };
    });
}
