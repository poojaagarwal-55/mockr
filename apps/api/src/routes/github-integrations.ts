import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { encrypt } from "../lib/encryption.js";
import { checkRateLimit } from "../lib/rate-limiter.js";
import { cacheDel } from "../lib/redis.js";

const githubIntegration = (prisma as any).gitHubIntegration;

const saveGitHubIntegrationSchema = z.object({
    accessToken: z.string().min(1).max(4096),
    refreshToken: z.string().min(1).max(4096).optional().nullable(),
    scopes: z.array(z.string().trim().min(1).max(80)).max(30).optional().default([]),
    githubUserId: z.string().trim().max(120).optional().nullable(),
    githubUsername: z.string().trim().max(120).optional().nullable(),
});

async function verifyGitHubAccessToken(accessToken: string) {
    const response = await fetch("https://api.github.com/user", {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "Practers-GitHub-Connect",
        },
    });

    if (!response.ok) return null;
    return response.json().catch(() => null);
}

export default async function githubIntegrationRoutes(fastify: FastifyInstance) {
    fastify.addHook("preHandler", fastify.authenticate);

    fastify.get("/github/integration", async (request) => {
        const userId = request.user!.id;
        const integration = await githubIntegration.findUnique({
            where: { userId },
            select: {
                githubUserId: true,
                githubUsername: true,
                scopes: true,
                connectedAt: true,
                lastSyncedAt: true,
                revokedAt: true,
            },
        });

        return {
            connected: Boolean(integration && !integration.revokedAt),
            integration,
        };
    });

    fastify.post("/github/integration", async (request, reply) => {
        const userId = request.user!.id;
        const rl = checkRateLimit(`github:connect:${userId}`, 60, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `GitHub connect limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const parsed = saveGitHubIntegrationSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const data = parsed.data;
        const githubUser = await verifyGitHubAccessToken(data.accessToken);
        if (!githubUser?.login) {
            return reply.status(400).send({
                error: "Invalid GitHub Token",
                message: "GitHub did not accept this connection token. Please reconnect GitHub.",
            });
        }

        const integration = await githubIntegration.upsert({
            where: { userId },
            create: {
                userId,
                githubUserId: String(githubUser.id || data.githubUserId || ""),
                githubUsername: githubUser.login,
                encryptedAccessToken: encrypt(data.accessToken),
                encryptedRefreshToken: data.refreshToken ? encrypt(data.refreshToken) : null,
                scopes: data.scopes,
                connectedAt: new Date(),
                revokedAt: null,
            },
            update: {
                githubUserId: String(githubUser.id || data.githubUserId || ""),
                githubUsername: githubUser.login,
                encryptedAccessToken: encrypt(data.accessToken),
                encryptedRefreshToken: data.refreshToken ? encrypt(data.refreshToken) : null,
                scopes: data.scopes,
                connectedAt: new Date(),
                revokedAt: null,
            },
            select: {
                githubUserId: true,
                githubUsername: true,
                scopes: true,
                connectedAt: true,
                lastSyncedAt: true,
                revokedAt: true,
            },
        });

        await cacheDel([`api:users:${userId}:profile`]);

        return {
            connected: true,
            integration,
        };
    });

    fastify.delete("/github/integration", async (request) => {
        const userId = request.user!.id;
        await githubIntegration.updateMany({
            where: { userId },
            data: { revokedAt: new Date() },
        });
        await cacheDel([`api:users:${userId}:profile`]);
        return { connected: false };
    });
}
