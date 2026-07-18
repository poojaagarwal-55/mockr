import Redis from "ioredis";
import { getP2PConfig } from "./env.js";

type RedisPipelineResult = Array<[Error | null, unknown]> | null;

export interface RedisLike {
    get(key: string): Promise<string | null>;
    setex(key: string, seconds: number, value: string): Promise<string>;
    setnxex(key: string, seconds: number, value: string): Promise<boolean>;
    incr(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<number>;
    del(...keys: string[]): Promise<number>;
    zadd(key: string, score: number, member: string): Promise<number>;
    zrem(key: string, member: string): Promise<number>;
    zrank(key: string, member: string): Promise<number | null>;
    zrange(key: string, start: number, stop: number): Promise<string[]>;
    pipeline(): {
        zrem(key: string, member: string): any;
        exec(): Promise<RedisPipelineResult>;
    };
}

export class InMemoryRedisClient implements RedisLike {
    private readonly kv = new Map<string, string>();
    private readonly expiry = new Map<string, number>();
    private readonly zsets = new Map<string, Map<string, number>>();

    private purgeIfExpired(key: string): void {
        const expiresAt = this.expiry.get(key);
        if (!expiresAt) {
            return;
        }

        if (Date.now() >= expiresAt) {
            this.kv.delete(key);
            this.expiry.delete(key);
        }
    }

    private zremSync(key: string, member: string): number {
        const zset = this.zsets.get(key);
        if (!zset) {
            return 0;
        }

        const existed = zset.delete(member);
        return existed ? 1 : 0;
    }

    async get(key: string): Promise<string | null> {
        this.purgeIfExpired(key);
        return this.kv.get(key) ?? null;
    }

    async setex(key: string, seconds: number, value: string): Promise<string> {
        this.kv.set(key, value);
        this.expiry.set(key, Date.now() + seconds * 1000);
        return "OK";
    }

    async setnxex(key: string, seconds: number, value: string): Promise<boolean> {
        this.purgeIfExpired(key);

        if (this.kv.has(key)) {
            return false;
        }

        this.kv.set(key, value);
        this.expiry.set(key, Date.now() + seconds * 1000);
        return true;
    }

    async incr(key: string): Promise<number> {
        this.purgeIfExpired(key);

        const currentRaw = this.kv.get(key);
        const current = Number.parseInt(currentRaw || "0", 10) || 0;
        const next = current + 1;

        this.kv.set(key, String(next));
        return next;
    }

    async expire(key: string, seconds: number): Promise<number> {
        this.purgeIfExpired(key);

        if (!this.kv.has(key)) {
            return 0;
        }

        this.expiry.set(key, Date.now() + seconds * 1000);
        return 1;
    }

    async del(...keys: string[]): Promise<number> {
        let deleted = 0;
        keys.forEach((key) => {
            if (this.kv.delete(key)) {
                deleted += 1;
            }
            this.expiry.delete(key);
            this.zsets.delete(key);
        });
        return deleted;
    }

    async zadd(key: string, score: number, member: string): Promise<number> {
        const zset = this.zsets.get(key) || new Map<string, number>();
        zset.set(member, score);
        this.zsets.set(key, zset);
        return 1;
    }

    async zrem(key: string, member: string): Promise<number> {
        return this.zremSync(key, member);
    }

    async zrank(key: string, member: string): Promise<number | null> {
        const zset = this.zsets.get(key);
        if (!zset) {
            return null;
        }

        const sorted = Array.from(zset.entries())
            .map(([candidate, score]) => ({ candidate, score }))
            .sort((a, b) => a.score - b.score);

        const idx = sorted.findIndex((item) => item.candidate === member);
        return idx >= 0 ? idx : null;
    }

    async zrange(key: string, start: number, stop: number): Promise<string[]> {
        const zset = this.zsets.get(key);
        if (!zset) {
            return [];
        }

        const sorted = Array.from(zset.entries())
            .map(([candidate, score]) => ({ candidate, score }))
            .sort((a, b) => a.score - b.score)
            .map((item) => item.candidate);

        if (sorted.length === 0) {
            return [];
        }

        const end = stop >= 0 ? stop + 1 : sorted.length;
        return sorted.slice(start, end);
    }

    pipeline() {
        const ops: Array<{ key: string; member: string }> = [];
        const self = this;

        return {
            zrem(key: string, member: string) {
                ops.push({ key, member });
                return this;
            },
            async exec(): Promise<RedisPipelineResult> {
                return ops.map((op) => [null, self.zremSync(op.key, op.member)] as [Error | null, unknown]);
            },
        };
    }
}

export function isRedisConnectionRefused(error: unknown): boolean {
    if (!error || typeof error !== "object") {
        return false;
    }

    const maybeError = error as {
        code?: string;
        message?: string;
        errors?: Array<{ code?: string; message?: string }>;
    };

    if (maybeError.code === "ECONNREFUSED") {
        return true;
    }

    if (typeof maybeError.message === "string" && maybeError.message.includes("ECONNREFUSED")) {
        return true;
    }

    if (Array.isArray(maybeError.errors)) {
        return maybeError.errors.some((inner) =>
            inner.code === "ECONNREFUSED" ||
            (typeof inner.message === "string" && inner.message.includes("ECONNREFUSED"))
        );
    }

    return false;
}

const globalForRedis = globalThis as unknown as {
    redis: RedisLike | undefined;
};

let activeRedisClient: RedisLike;

const redisFacade: RedisLike = {
    get: (key: string) => activeRedisClient.get(key),
    setex: (key: string, seconds: number, value: string) => activeRedisClient.setex(key, seconds, value),
    setnxex: (key: string, seconds: number, value: string) => activeRedisClient.setnxex(key, seconds, value),
    incr: (key: string) => activeRedisClient.incr(key),
    expire: (key: string, seconds: number) => activeRedisClient.expire(key, seconds),
    del: (...keys: string[]) => activeRedisClient.del(...keys),
    zadd: (key: string, score: number, member: string) => activeRedisClient.zadd(key, score, member),
    zrem: (key: string, member: string) => activeRedisClient.zrem(key, member),
    zrank: (key: string, member: string) => activeRedisClient.zrank(key, member),
    zrange: (key: string, start: number, stop: number) => activeRedisClient.zrange(key, start, stop),
    pipeline: () => activeRedisClient.pipeline(),
};

function createRedisClient(): RedisLike {
    const { redisUrl, allowInMemoryRedis } = getP2PConfig();

    if (!redisUrl) {
        if (allowInMemoryRedis) {
            console.warn("REDIS_URL is not configured. Using explicit in-memory Redis mode for p2p service.");
            return new InMemoryRedisClient();
        }

        throw new Error("REDIS_URL is required for p2p service. Set P2P_ALLOW_INMEMORY_REDIS=true only for local development fallback.");
    }

    const networkClient = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        enableOfflineQueue: false,
        retryStrategy: () => null,
    });

    networkClient.on("error", (error) => {
        if (isRedisConnectionRefused(error)) {
            console.error("[p2p][redis] Redis connection refused. Service requires Redis for distributed state/rate limits.");
        }
        console.error("[p2p][redis]", error);
    });

    networkClient.on("end", () => {
        console.error("[p2p][redis] Redis connection ended. Service cannot safely continue without Redis.");
    });

    const baseSet = networkClient.set.bind(networkClient);
    const baseIncr = networkClient.incr.bind(networkClient);
    const baseExpire = networkClient.expire.bind(networkClient);

    const adapted: RedisLike = {
        get: (key: string) => networkClient.get(key),
        setex: (key: string, seconds: number, value: string) => networkClient.setex(key, seconds, value),
        async setnxex(key: string, seconds: number, value: string): Promise<boolean> {
            const result = await baseSet(key, value, "EX", seconds, "NX");
            return result === "OK";
        },
        incr: (key: string) => baseIncr(key),
        expire: (key: string, seconds: number) => baseExpire(key, seconds),
        del: (...keys: string[]) => networkClient.del(...keys),
        zadd: (key: string, score: number, member: string) => networkClient.zadd(key, score, member),
        zrem: (key: string, member: string) => networkClient.zrem(key, member),
        zrank: (key: string, member: string) => networkClient.zrank(key, member),
        zrange: (key: string, start: number, stop: number) => networkClient.zrange(key, start, stop),
        pipeline: () => networkClient.pipeline(),
    };

    return adapted;
}

activeRedisClient = globalForRedis.redis ?? createRedisClient();

export const redis = redisFacade;

if (process.env.NODE_ENV !== "production") {
    globalForRedis.redis = activeRedisClient;
}
