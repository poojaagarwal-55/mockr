// Force IPv4 DNS resolution — must be before any network imports
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import * as dotenv from "dotenv";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const currentDir = typeof __dirname !== 'undefined' ? __dirname : fileURLToPath(new URL(".", (import.meta as any).url));
const envCandidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
    path.resolve(currentDir, "../../../.env"),
];
const envPath = envCandidates.find((p) => existsSync(p));
console.log('[ENV] Loading environment from:', envPath || 'default .env');
console.log('[ENV] Checked paths:', envCandidates);
dotenv.config(envPath ? { path: envPath } : undefined);
import { validateEnv } from "./lib/env.js";
import { connectMongoDB } from "./lib/mongoose.js";
import { prisma } from "./lib/prisma.js";
import http from "node:http";
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import authPlugin from "./plugins/auth.js";
import cacheHeadersPlugin from "./plugins/cache-headers.js";
import healthRoutes from "./routes/health.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import interviewRoutes from "./routes/interviews.js";
import p2pRoutes from "./routes/p2p.js";
import resumeRoutes from "./routes/resumes.js";
import billingRoutes from "./routes/billing.js";
import adminRoutes from "./routes/admin.js";
import webhookRoutes from "./routes/webhooks.js";
import ideRoutes from "./routes/ide.js";
import sqlRoutes from "./routes/sql.js";
import csFundamentalsRoutes from "./routes/cs-fundamentals.js";
import systemDesignRoutes from "./routes/system-design.js";
import latexResumeRoutes from "./routes/latex-resumes.js";
import tutorRoutes from "./routes/tutor.js";
import actionPlanRoutes from "./routes/action-plan.js";
import questionReportRoutes from "./routes/question-reports.js";
import customSheetsRoutes from "./routes/custom-sheets.js";
import streakRoutes from "./routes/streaks.js";
import verificationRoutes from "./routes/verification.js";
import blogRoutes from "./routes/blog.js";
import searchRoutes from "./routes/search.js";
import secureOaRoutes from "./routes/secure-oa.js";
import jobsRoutes from "./routes/jobs.js";
import jobProfileRoutes from "./routes/job-profiles.js";
import monitorRoutes from "./routes/monitor.js";
import skillRoutes from "./routes/skills.js";
import githubIntegrationRoutes from "./routes/github-integrations.js";
import notificationRoutes from "./routes/notifications.js";
import contestQuestionAssetRoutes from "./routes/contest-question-assets.js";
import companyRoutes from "./companies/routes.js";
import companyVerificationRoutes from "./companies/verification.js";
import companyJobRoutes from "./companies/jobs.js";
import companyTeamRoutes from "./companies/teams.js";
import companyDirectInterviewRoutes from "./companies/direct-interviews.js";
import companyQuestionBankRoutes from "./companies/question-bank.js";
import companyOnlineAssessmentRoutes from "./companies/online-assessments.js";
import companyAiInterviewRoutes from "./companies/ai-interviews.js";
import companySecureOaRoutes from "./companies/secure-oa.js";
import { problemSetterRoutes } from "./routes/problem-setter.js";
import codeExecutionRoutes from "./routes/code-execution.js";
import { createWebSocketServer } from "./services/websocket.js";
import { createPlanWebSocketServer } from "./services/plan-websocket.js";
import { registerSecureOaSocketNamespace } from "./services/proctoring/socket.js";
import { startProctoringWatchdog } from "./services/proctoring/watchdog.js";
import { startPaymentBackgroundJobs } from "./services/payment/payment-background-jobs.js";
import { clearPaymentConfigCache } from "./services/payment/config.js";
import { sanitizeForLog } from "./lib/log-utils.js";
import {
    INTERNAL_SERVER_ERROR_MESSAGE,
    INTERNAL_SERVER_ERROR_NAME,
} from "./lib/user-facing-errors.js";

const PORT = parseInt(process.env.API_PORT || "3001", 10);
const HOST = process.env.API_HOST || "::";

async function main() {
    // Validate all required env vars before anything else
    validateEnv();
    
    // Clear payment config cache to ensure fresh credentials are loaded
    clearPaymentConfigCache();

    // Connect to MongoDB (non-blocking — won't crash if unavailable)
    await connectMongoDB();

    // Behind a reverse proxy / LB the socket peer is the PROXY, so request.ip
    // (and IP-keyed rate limits like signup/verification) are only correct when
    // Fastify is told how far to trust the X-Forwarded-For chain. Conservative by
    // default: 1 hop in prod (a single LB/ingress), false in dev (no proxy — trust
    // the real socket IP). Override with TRUST_PROXY: "true"/"false", a hop COUNT
    // ("2"), or — safest, spoof-proof — a comma-separated IP/CIDR allowlist of your
    // proxies (e.g. "10.0.0.0/8,127.0.0.1"). Never use "true" unless the proxy
    // strips any client-supplied X-Forwarded-For, or clients can forge their IP.
    const trustProxyRaw = (process.env.TRUST_PROXY ?? "").trim();
    const trustProxy: boolean | number | string =
        !trustProxyRaw ? (process.env.NODE_ENV === "production" ? 1 : false)
        : trustProxyRaw.toLowerCase() === "true" ? true
        : trustProxyRaw.toLowerCase() === "false" ? false
        : /^\d+$/.test(trustProxyRaw) ? Number(trustProxyRaw)
        : trustProxyRaw;

    const fastify = Fastify({
        // Resolve request.ip through the trusted proxy chain (see trustProxyRaw above).
        trustProxy,
        bodyLimit: 52428800, // 50MB max payload
        // Raise the HTTP header limit above Node's 16KB default. Large cookie
        // headers otherwise yield a 431 emitted by the HTTP parser before CORS
        // runs, surfacing as a confusing CORS error in the browser.
        serverFactory: (handler) => http.createServer({ maxHeaderSize: 96 * 1024 }, handler),
        logger: {
            level: process.env.NODE_ENV === "production" ? "info" : "debug",
            transport:
                process.env.NODE_ENV !== "production"
                    ? { target: "pino-pretty", options: { colorize: true } }
                    : undefined,
        },
    });

    fastify.log.info(`trustProxy: ${JSON.stringify(trustProxy)}`);

    // ── Plugins ────────────────────────────────────────────────
    const localDevOrigins = process.env.NODE_ENV === "production"
        ? []
        : [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:3001",
            "http://127.0.0.1:3001",
            "http://localhost:3003",
            "http://127.0.0.1:3003",
        ];

    const corsOrigins = [
        "https://practers.com",
        "https://www.practers.com",
        process.env.FRONTEND_URL || "",
        process.env.COMPANY_FRONTEND_URL || "",
        ...localDevOrigins,
        ...(process.env.CORS_ALLOWED_ORIGINS ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(origin => origin.trim()) : []),
    ].filter(Boolean).filter((origin, index, origins) => origins.indexOf(origin) === index);

    fastify.log.info(`CORS allowed origins: ${corsOrigins.join(', ')}`);

    await fastify.register(cors, {
        origin: corsOrigins,
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    });

    await fastify.register(cookie, {
        // parseOptions is for parsing incoming cookies, not setting them
        // Cookie options should be set when calling reply.setCookie()
    });
    await fastify.register(multipart, {
        limits: {
            fileSize: 5 * 1024 * 1024, // 5MB max
        },
    });

    await fastify.register(authPlugin);
    await fastify.register(cacheHeadersPlugin);

    // ── Decorate with Prisma ───────────────────────────────────
    fastify.decorateRequest("prisma", null);
    fastify.addHook("onRequest", async (request) => {
        request.prisma = prisma;
    });

    // ── Routes ─────────────────────────────────────────────────
    await fastify.register(healthRoutes);
    await fastify.register(authRoutes);
    await fastify.register(userRoutes);
    await fastify.register(interviewRoutes);
    await fastify.register(p2pRoutes);
    await fastify.register(resumeRoutes);
    await fastify.register(billingRoutes);
    await fastify.register(adminRoutes);
    await fastify.register(webhookRoutes);
    await fastify.register(ideRoutes);
    await fastify.register(sqlRoutes);
    await fastify.register(csFundamentalsRoutes);
    await fastify.register(systemDesignRoutes);
    await fastify.register(latexResumeRoutes);
    await fastify.register(tutorRoutes);
    await fastify.register(actionPlanRoutes);
    await fastify.register(questionReportRoutes);
    await fastify.register(customSheetsRoutes);
    await fastify.register(streakRoutes);
    await fastify.register(searchRoutes);
    await fastify.register(secureOaRoutes);
    await fastify.register(jobsRoutes);
    await fastify.register(jobProfileRoutes);
    await fastify.register(monitorRoutes);
    await fastify.register(skillRoutes);
    await fastify.register(githubIntegrationRoutes);
    await fastify.register(notificationRoutes);
    await fastify.register(contestQuestionAssetRoutes);
    await fastify.register(verificationRoutes, { prefix: "/verification" });
    await fastify.register(blogRoutes, { prefix: "/blog" });
    await fastify.register(problemSetterRoutes);
    await fastify.register(codeExecutionRoutes);
    await fastify.register(companyRoutes);
    await fastify.register(companyVerificationRoutes);
    await fastify.register(companyJobRoutes);
    await fastify.register(companyTeamRoutes);
    await fastify.register(companyDirectInterviewRoutes);
    await fastify.register(companyOnlineAssessmentRoutes);
    await fastify.register(companyAiInterviewRoutes);
    await fastify.register(companySecureOaRoutes);
    await fastify.register(companyQuestionBankRoutes);

    // ── Global Error Handler ───────────────────────────────────
    fastify.setErrorHandler((error: any, request, reply) => {
        fastify.log.error(sanitizeForLog(error));

        const statusCode = error.statusCode || 500;
        const isServerError = statusCode >= 500;

        const safeErrorName = isServerError
            ? INTERNAL_SERVER_ERROR_NAME
            : (error.name || "Request Error");

        const safeMessage = isServerError
            ? INTERNAL_SERVER_ERROR_MESSAGE
            : (error.message || "Request failed");

        reply.status(statusCode).send({
            error: safeErrorName,
            message: safeMessage,
        });
    });

    // Force a generalized payload for all system-level responses.
    // This catches both thrown 5xx errors and manual 5xx reply bodies.
    fastify.addHook("onSend", async (_request, reply, payload) => {
        if (reply.statusCode < 500) {
            return payload;
        }

        reply.type("application/json");
        return JSON.stringify({
            error: INTERNAL_SERVER_ERROR_NAME,
            message: INTERNAL_SERVER_ERROR_MESSAGE,
        });
    });

    // ── Start ──────────────────────────────────────────────────
    try {
        await fastify.listen({ port: PORT, host: HOST });

        // Attach WebSocket servers to the underlying HTTP server
        const httpServer = fastify.server;
        const io = createWebSocketServer(httpServer);
        const planIO = createPlanWebSocketServer(httpServer);
        registerSecureOaSocketNamespace(io, prisma, fastify.log);

        // Start payment background jobs (reconciliation, zombie detection, etc.)
            startPaymentBackgroundJobs(prisma, fastify.log);
            startProctoringWatchdog(prisma, fastify.log);

        fastify.log.info(`API + WebSocket servers ready on ${HOST}:${PORT}`);
            fastify.log.info('Payment background jobs started');

        // Graceful shutdown. Cloud Run sends SIGTERM on every deploy/scale-down,
        // then SIGKILL after 10s. Without this, in-flight requests (including
        // payment webhooks and interview writes) were dropped mid-flight and DB
        // connections leaked. fastify.close() drains in-flight requests first.
        let shuttingDown = false;
        const shutdown = async (signal: string) => {
            if (shuttingDown) return;
            shuttingDown = true;
            fastify.log.info(`${signal} received — draining and shutting down`);
            try {
                await fastify.close();
                await prisma.$disconnect();
            } catch (err) {
                fastify.log.error({ err }, 'Error during graceful shutdown');
            } finally {
                process.exit(0);
            }
        };
        process.on('SIGTERM', () => void shutdown('SIGTERM'));
        process.on('SIGINT', () => void shutdown('SIGINT'));
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
}

main();
