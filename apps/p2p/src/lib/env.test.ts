describe("p2p env", () => {
    const requiredEnv = {
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    };

    beforeEach(() => {
        jest.resetModules();
        Object.assign(process.env, requiredEnv);
        delete process.env.REDIS_URL;
    });

    test("validateEnv does not require REDIS_URL", async () => {
        const { validateEnv } = require("./env.js");
        expect(() => validateEnv()).not.toThrow();
    });

    test("getP2PConfig exposes undefined redisUrl when not configured", async () => {
        const { getP2PConfig } = require("./env.js");
        const cfg = getP2PConfig();

        expect(cfg.port).toBe(3004);
        expect(cfg.redisUrl).toBeUndefined();
        expect(cfg.allowInMemoryRedis).toBe(false);
    });

    test("validateEnv exits when required key is missing", async () => {
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;

        const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
        const exitSpy = jest
            .spyOn(process, "exit")
            .mockImplementation(((code?: number) => {
                throw new Error(`exit:${code ?? 0}`);
            }) as never);

        const { validateEnv } = require("./env.js");

        expect(() => validateEnv()).toThrow("exit:1");

        errorSpy.mockRestore();
        exitSpy.mockRestore();
    });
});
