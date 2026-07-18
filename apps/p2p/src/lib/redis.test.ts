describe("InMemoryRedisClient", () => {
    function getClient() {
        process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
        process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
        delete process.env.REDIS_URL;
        process.env.P2P_ALLOW_INMEMORY_REDIS = "true";

        // Load after env setup so module-level config validation does not exit.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { InMemoryRedisClient } = require("./redis.js");
        return new InMemoryRedisClient();
    }

    function getHelper() {
        process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
        process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
        delete process.env.REDIS_URL;
        process.env.P2P_ALLOW_INMEMORY_REDIS = "true";

        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { isRedisConnectionRefused } = require("./redis.js");
        return isRedisConnectionRefused as (error: unknown) => boolean;
    }

    beforeEach(() => {
        jest.resetModules();
    });

    test("supports kv lifecycle and ttl expiry", async () => {
        const redis = getClient();

        await redis.setex("k1", 1, "v1");
        expect(await redis.get("k1")).toBe("v1");

        await new Promise((resolve) => setTimeout(resolve, 1100));
        expect(await redis.get("k1")).toBeNull();
    });

    test("supports sorted set ranking and range", async () => {
        const redis = getClient();

        await redis.zadd("q", 20, "u2");
        await redis.zadd("q", 10, "u1");

        expect(await redis.zrank("q", "u1")).toBe(0);
        expect(await redis.zrange("q", 0, 1)).toEqual(["u1", "u2"]);
    });

    test("supports setnxex, incr and expire helpers", async () => {
        const redis = getClient();

        await redis.setex("counter", 5, "0");
        expect(await redis.incr("counter")).toBe(1);
        expect(await redis.incr("counter")).toBe(2);

        expect(await redis.setnxex("lock", 5, "token-1")).toBe(true);
        expect(await redis.setnxex("lock", 5, "token-2")).toBe(false);

        expect(await redis.expire("counter", 1)).toBe(1);
        await new Promise((resolve) => setTimeout(resolve, 1100));
        expect(await redis.get("counter")).toBeNull();
    });

    test("pipeline zrem executes in order", async () => {
        const redis = getClient();

        await redis.zadd("q", 10, "u1");
        await redis.zadd("q", 20, "u2");

        const results = await redis.pipeline().zrem("q", "u1").zrem("q", "u2").exec();

        expect(results).toEqual([
            [null, 1],
            [null, 1],
        ]);

        expect(await redis.zrange("q", 0, -1)).toEqual([]);
    });

    test("detects ECONNREFUSED from direct error and aggregate form", () => {
        const isRedisConnectionRefused = getHelper();

        expect(isRedisConnectionRefused({ code: "ECONNREFUSED" })).toBe(true);
        expect(
            isRedisConnectionRefused({
                errors: [{ code: "ECONNREFUSED" }],
            })
        ).toBe(true);
        expect(isRedisConnectionRefused(new Error("oops"))).toBe(false);
    });
});
