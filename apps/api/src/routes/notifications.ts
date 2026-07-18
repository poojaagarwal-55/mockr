import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { checkRateLimit } from "../lib/rate-limiter.js";

const notificationIdParamsSchema = z.object({
    id: z.string().uuid(),
});

export default async function notificationRoutes(fastify: FastifyInstance) {
    fastify.addHook("preHandler", fastify.authenticate);

    fastify.get("/notifications", async (request, reply) => {
        const userId = request.user?.id;
        if (!userId) {
            return reply.status(401).send({ error: "Unauthorized", message: "Authentication required." });
        }

        const rl = checkRateLimit(`notifications:list:${userId}`, 120, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Notification limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const notifications = await (prisma as any).userNotification.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            take: 50,
            select: {
                id: true,
                type: true,
                title: true,
                message: true,
                href: true,
                read: true,
                createdAt: true,
            },
        });

        return { notifications };
    });

    fastify.patch("/notifications/:id/read", async (request, reply) => {
        const params = notificationIdParamsSchema.safeParse(request.params);
        const userId = request.user?.id;
        if (!userId) {
            return reply.status(401).send({ error: "Unauthorized", message: "Authentication required." });
        }
        if (!params.success) {
            return reply.status(400).send({ error: "Validation Error", details: params.error.flatten().fieldErrors });
        }

        await (prisma as any).userNotification.updateMany({
            where: { id: params.data.id, userId },
            data: { read: true },
        });

        return { ok: true };
    });

    fastify.patch("/notifications/read-all", async (request, reply) => {
        const userId = request.user?.id;
        if (!userId) {
            return reply.status(401).send({ error: "Unauthorized", message: "Authentication required." });
        }

        await (prisma as any).userNotification.updateMany({
            where: { userId, read: false },
            data: { read: true },
        });

        return { ok: true };
    });

    fastify.delete("/notifications/:id", async (request, reply) => {
        const params = notificationIdParamsSchema.safeParse(request.params);
        const userId = request.user?.id;
        if (!userId) {
            return reply.status(401).send({ error: "Unauthorized", message: "Authentication required." });
        }
        if (!params.success) {
            return reply.status(400).send({ error: "Validation Error", details: params.error.flatten().fieldErrors });
        }

        const rl = checkRateLimit(`notifications:delete:${userId}`, 120, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Notification limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        await (prisma as any).userNotification.deleteMany({
            where: { id: params.data.id, userId },
        });

        return { ok: true };
    });

    fastify.delete("/notifications", async (request, reply) => {
        const userId = request.user?.id;
        if (!userId) {
            return reply.status(401).send({ error: "Unauthorized", message: "Authentication required." });
        }

        const rl = checkRateLimit(`notifications:clear:${userId}`, 30, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Notification limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        await (prisma as any).userNotification.deleteMany({
            where: { userId },
        });

        return { ok: true };
    });
}
