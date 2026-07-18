import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { getCachedAuthUser, setCachedAuthUser } from "../lib/auth-token-cache.js";
import {
    AUTHENTICATION_FAILED_MESSAGE,
    INTERNAL_SERVER_ERROR_MESSAGE,
    INTERNAL_SERVER_ERROR_NAME,
    isConnectivityIssue,
} from "../lib/user-facing-errors.js";

// Extend Fastify types to include user on request
declare module "fastify" {
    interface FastifyRequest {
        user: {
            id: string;
            email: string;
            user_metadata?: Record<string, any>;
        } | null;
        prisma: import("@prisma/client").PrismaClient;
    }
}

async function authPlugin(fastify: FastifyInstance) {
    // Decorate request with null user by default
    fastify.decorateRequest("user", null);

    // Add an auth hook that can be applied per-route
    fastify.decorate(
        "authenticate",
        async function (request: FastifyRequest, reply: FastifyReply) {
            const authHeader = request.headers.authorization;

            if (!authHeader || !authHeader.startsWith("Bearer ")) {
                return reply.status(401).send({
                    error: "Unauthorized",
                    message: "Missing or invalid Authorization header",
                });
            }

            const token = authHeader.replace("Bearer ", "");

            // Fast path: reuse a recently verified token instead of calling
            // Supabase's auth API on every request (the load bottleneck).
            const cachedUser = getCachedAuthUser(token);
            if (cachedUser) {
                request.user = cachedUser;
                return;
            }

            try {
                const supabase = getSupabaseAdmin();
                const {
                    data: { user },
                    error,
                } = await supabase.auth.getUser(token);

                if (error) {
                    if (isConnectivityIssue(error)) {
                        return reply.status(503).send({
                            error: INTERNAL_SERVER_ERROR_NAME,
                            message: INTERNAL_SERVER_ERROR_MESSAGE,
                        });
                    }

                    return reply.status(401).send({
                        error: "Unauthorized",
                        message: AUTHENTICATION_FAILED_MESSAGE,
                    });
                }

                if (!user) {
                    return reply.status(401).send({
                        error: "Unauthorized",
                        message: AUTHENTICATION_FAILED_MESSAGE,
                    });
                }

                const verifiedUser = {
                    id: user.id,
                    email: user.email!,
                    user_metadata: user.user_metadata,
                };
                setCachedAuthUser(token, verifiedUser);
                request.user = verifiedUser;
            } catch (err) {
                if (isConnectivityIssue(err)) {
                    return reply.status(503).send({
                        error: INTERNAL_SERVER_ERROR_NAME,
                        message: INTERNAL_SERVER_ERROR_MESSAGE,
                    });
                }

                return reply.status(401).send({
                    error: "Unauthorized",
                    message: AUTHENTICATION_FAILED_MESSAGE,
                });
            }
        }
    );
}

export default fp(authPlugin, {
    name: "auth-plugin",
});

// Extend Fastify type for the authenticate decorator
declare module "fastify" {
    interface FastifyInstance {
        authenticate: (
            request: FastifyRequest,
            reply: FastifyReply
        ) => Promise<void>;
    }
}
