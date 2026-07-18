describe("p2p supabase auth helper", () => {
    beforeEach(() => {
        jest.resetModules();
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    });

    test("throws explicit error when supabase env is missing", async () => {
        const { verifyAccessToken } = require("./supabase.js");

        await expect(verifyAccessToken("token")).rejects.toThrow(
            "Missing Supabase env for p2p service"
        );
    });

    test("returns user identity when token is valid", async () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
        process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";

        const getUserMock = jest.fn().mockResolvedValue({
            data: { user: { id: "user-1", email: "u@example.com" } },
            error: null,
        });

        jest.doMock("@supabase/supabase-js", () => ({
            createClient: jest.fn(() => ({
                auth: {
                    getUser: getUserMock,
                },
            })),
        }));

        const { verifyAccessToken } = require("./supabase.js");
        const user = await verifyAccessToken("token");

        expect(getUserMock).toHaveBeenCalledWith("token");
        expect(user).toEqual({ id: "user-1", email: "u@example.com" });
    });

    test("returns null when supabase returns error", async () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
        process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";

        const getUserMock = jest.fn().mockResolvedValue({
            data: { user: null },
            error: new Error("bad token"),
        });

        jest.doMock("@supabase/supabase-js", () => ({
            createClient: jest.fn(() => ({
                auth: {
                    getUser: getUserMock,
                },
            })),
        }));

        const { verifyAccessToken } = require("./supabase.js");
        const user = await verifyAccessToken("token");

        expect(user).toBeNull();
    });
});
