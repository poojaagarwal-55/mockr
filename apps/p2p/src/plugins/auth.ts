import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { verifyAccessToken } from "../lib/supabase.js";

declare module "fastify" {
    interface FastifyRequest {
        user: {
            id: string;
            email: string;
        } | null;
    }

    interface FastifyInstance {
        authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    }
}

async function authPlugin(fastify: FastifyInstance) {
    fastify.decorateRequest("user", null);

    fastify.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
        const authHeader = request.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return reply.status(401).send({
                error: "Unauthorized",
                message: "Missing or invalid Authorization header",
            });
        }

        const token = authHeader.replace("Bearer ", "");
        const user = await verifyAccessToken(token);

        if (!user) {
            return reply.status(401).send({
                error: "Unauthorized",
                message: "Invalid or expired token",
            });
        }

        request.user = {
            id: user.id,
            email: user.email,
        };
    });
}

export default fp(authPlugin, {
    name: "p2p-auth-plugin",
});
