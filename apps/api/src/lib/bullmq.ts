import { Redis } from "ioredis";

const DEFAULT_REDIS_URL = "redis://localhost:6379";

function getBullMQRedisUrl(): string {
    return (
        process.env.BULLMQ_REDIS_URL ||
        process.env.QUEUE_REDIS_URL ||
        process.env.REDIS_URL ||
        ""
    );
}

export function isBullMQConfigured(): boolean {
    return Boolean(getBullMQRedisUrl());
}

export function getRequiredBullMQRedisUrl(): string {
    const url = getBullMQRedisUrl();
    if (!url) {
        throw new Error(
            "BullMQ Redis is not configured. Set REDIS_URL or BULLMQ_REDIS_URL to a Redis/Valkey TCP URL."
        );
    }
    return url;
}

export function createBullMQConnection(connectionName: string) {
    const url = getRequiredBullMQRedisUrl();
    const connection = new Redis(url || DEFAULT_REDIS_URL, {
        connectionName,
        maxRetriesPerRequest: null,
    });

    connection.on("error", (err) => {
        console.error(`[BullMQ:${connectionName}] Redis connection error:`, err);
    });

    return connection;
}

export function getBullMQEnvInt(
    names: string | string[],
    fallback: number,
    min = 0
): number {
    const keys = Array.isArray(names) ? names : [names];
    const raw = keys.map((name) => process.env[name]).find(Boolean);
    const value = Number.parseInt(raw || "", 10);
    if (!Number.isFinite(value)) return fallback;
    return Math.max(min, value);
}
