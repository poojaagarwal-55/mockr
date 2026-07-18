import { FastifyInstance } from "fastify";

export default async function healthRoutes(fastify: FastifyInstance) {
    fastify.get("/health", async (_request, reply) => {
        reply.cacheControl("NONE");
        return {
            status: "ok",
            service: "interviewforge-api",
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
        };
    });
}
