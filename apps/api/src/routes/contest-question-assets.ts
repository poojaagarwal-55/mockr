import { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isAdminEmail } from "../lib/admin.js";
import { sanitizeForLog } from "../lib/log-utils.js";
import { prisma } from "../lib/prisma.js";
import { checkRateLimit } from "../lib/rate-limiter.js";
import { getPresignedDownloadUrl, uploadToR2 } from "../lib/r2.js";
import { USER_ROLE } from "../lib/user-roles.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const supportedImageMimeValues = ["image/jpeg", "image/png", "image/webp"] as const;
const declaredImageMimeValues = ["image/jpeg", "image/jpg", "image/png", "image/webp"] as const;
type SupportedImageMime = typeof supportedImageMimeValues[number];

const imageMetadataSchema = z.object({
    filename: z.string().min(1).max(255),
    mimetype: z.enum(declaredImageMimeValues),
});

const imageUploadSchema = z.object({
    size: z.number().int().positive().max(MAX_IMAGE_BYTES),
    declaredMime: z.enum(declaredImageMimeValues),
    detectedMime: z.enum(supportedImageMimeValues),
}).refine((data) => normalizeImageMime(data.declaredMime) === data.detectedMime, {
    message: "Declared file type does not match image content",
});

const imageParamsSchema = z.object({
    ownerId: z.string().regex(/^[a-zA-Z0-9_-]{3,128}$/),
    filename: z.string().regex(/^[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)$/i),
});

function normalizeImageMime(mime: string): SupportedImageMime | null {
    if (mime === "image/jpg") return "image/jpeg";
    return supportedImageMimeValues.includes(mime as SupportedImageMime)
        ? (mime as SupportedImageMime)
        : null;
}

function detectImageMime(buffer: Buffer): SupportedImageMime | null {
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return "image/jpeg";
    }

    if (
        buffer.length >= 8 &&
        buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
        return "image/png";
    }

    if (
        buffer.length >= 12 &&
        buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
        buffer.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
        return "image/webp";
    }

    return null;
}

function getImageExtension(mime: SupportedImageMime): string {
    switch (mime) {
        case "image/jpeg":
            return "jpg";
        case "image/png":
            return "png";
        case "image/webp":
            return "webp";
    }
}

function fileNameToAlt(filename: string) {
    return filename
        .replace(/\.[^.]+$/, "")
        .replace(/[^\w\s-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80) || "question image";
}

function getRequestOrigin(request: FastifyRequest) {
    const forwardedProto = Array.isArray(request.headers["x-forwarded-proto"])
        ? request.headers["x-forwarded-proto"][0]
        : request.headers["x-forwarded-proto"];
    const forwardedHost = Array.isArray(request.headers["x-forwarded-host"])
        ? request.headers["x-forwarded-host"][0]
        : request.headers["x-forwarded-host"];
    const host = forwardedHost || request.headers.host || `localhost:${process.env.API_PORT || "3001"}`;
    const protocol = forwardedProto || (String(host).startsWith("localhost") || String(host).startsWith("127.0.0.1") ? "http" : "https");
    return `${protocol}://${host}`;
}

function getAssetUrl(request: FastifyRequest, key: string) {
    const prefix = "contest-question-assets/";
    const path = key.startsWith(prefix) ? key.slice(prefix.length) : key;
    return `${getRequestOrigin(request)}/contest-question-assets/images/${path}`;
}

async function requireContestQuestionAssetAccess(request: FastifyRequest, reply: FastifyReply) {
    const user = request.user;
    if (!user) {
        return reply.status(401).send({
            error: "Unauthorized",
            message: "Please sign in to upload contest question images.",
        });
    }

    if (isAdminEmail(user.email)) return;

    const account = await prisma.user.findUnique({
        where: { id: user.id },
        select: { role: true },
    });

    if (account?.role !== USER_ROLE.CONTEST_CREATOR) {
        return reply.status(403).send({
            error: "Forbidden",
            message: "You do not have access to upload contest question images.",
        });
    }
}

const contestQuestionAssetRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.get(
        "/contest-question-assets/images/:ownerId/:filename",
        async (request, reply) => {
            const params = imageParamsSchema.safeParse(request.params);
            if (!params.success) {
                return reply.status(404).send({
                    error: "Not Found",
                    message: "Image not found.",
                });
            }

            const key = `contest-question-assets/${params.data.ownerId}/${params.data.filename}`;
            try {
                const url = await getPresignedDownloadUrl(key, 300);
                return reply
                    .header("Cache-Control", "public, max-age=60")
                    .redirect(url, 302);
            } catch (error) {
                fastify.log.warn({ error: sanitizeForLog(error) }, "Failed to create contest question image URL");
                return reply.status(404).send({
                    error: "Not Found",
                    message: "Image not found.",
                });
            }
        }
    );

    fastify.post(
        "/contest-question-assets/images",
        { preHandler: [fastify.authenticate, requireContestQuestionAssetAccess] },
        async (request, reply) => {
            const userId = request.user!.id;
            const rateLimit = checkRateLimit(`contest-question-image:${userId}`, 30, 600_000);
            if (!rateLimit.allowed) {
                return reply.status(429).send({
                    error: "Too Many Requests",
                    message: `Image upload limit reached. Please wait ${Math.ceil(rateLimit.retryAfterMs / 1000)}s before uploading again.`,
                });
            }

            let data;
            try {
                data = await request.file();
            } catch (error) {
                fastify.log.warn({ error: sanitizeForLog(error) }, "Failed to read contest question image upload");
                return reply.status(400).send({
                    error: "Invalid upload",
                    message: "Please upload a PNG, JPEG, or WebP image under 5MB.",
                });
            }

            if (!data) {
                return reply.status(400).send({
                    error: "No file provided",
                    message: "Please upload an image file.",
                });
            }

            const metadata = imageMetadataSchema.safeParse({
                filename: data.filename,
                mimetype: data.mimetype,
            });

            if (!metadata.success) {
                return reply.status(400).send({
                    error: "Invalid file type",
                    message: "Only PNG, JPEG, and WebP images are allowed.",
                });
            }

            const chunks: Buffer[] = [];
            let totalSize = 0;

            try {
                for await (const chunk of data.file) {
                    totalSize += chunk.length;
                    if (totalSize > MAX_IMAGE_BYTES) {
                        return reply.status(400).send({
                            error: "File too large",
                            message: "Image must be under 5MB.",
                        });
                    }
                    chunks.push(chunk);
                }
            } catch (error) {
                fastify.log.warn({ error: sanitizeForLog(error) }, "Failed to stream contest question image upload");
                return reply.status(400).send({
                    error: "Invalid upload",
                    message: "Please upload a PNG, JPEG, or WebP image under 5MB.",
                });
            }

            const buffer = Buffer.concat(chunks);
            const detectedMime = detectImageMime(buffer);
            if (!detectedMime) {
                return reply.status(400).send({
                    error: "Invalid file content",
                    message: "The uploaded file is not a supported image.",
                });
            }

            const uploadValidation = imageUploadSchema.safeParse({
                size: buffer.length,
                declaredMime: metadata.data.mimetype,
                detectedMime,
            });

            if (!uploadValidation.success) {
                return reply.status(400).send({
                    error: "Invalid image",
                    message: "The uploaded file type could not be verified.",
                });
            }

            const alt = fileNameToAlt(metadata.data.filename);
            const key = `contest-question-assets/${userId}/${randomUUID()}.${getImageExtension(uploadValidation.data.detectedMime)}`;

            try {
                await uploadToR2(key, buffer, uploadValidation.data.detectedMime);
                const url = getAssetUrl(request, key);
                return reply.status(201).send({
                    url,
                    alt,
                    markdown: `![${alt}](${url})`,
                });
            } catch (error) {
                fastify.log.error({ error: sanitizeForLog(error) }, "Failed to upload contest question image to R2");
                return reply.status(500).send({
                    error: "Upload Error",
                    message: "Failed to upload the image. Please try again.",
                });
            }
        }
    );
};

export default contestQuestionAssetRoutes;
