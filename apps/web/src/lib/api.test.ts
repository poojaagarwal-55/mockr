import { apiFetch, ApiError } from "./api";

describe("apiFetch", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        jest.resetAllMocks();
    });

    afterAll(() => {
        global.fetch = originalFetch;
    });

    test("adds authorization and content-type headers", async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ ok: true }),
        } as Response);

        await apiFetch("/p2p/profile", {
            method: "POST",
            body: JSON.stringify({ level: "beginner" }),
            token: "abc",
        });

        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining("/p2p/profile"),
            expect.objectContaining({
                credentials: "include",
                headers: expect.objectContaining({
                    "Authorization": "Bearer abc",
                    "Content-Type": "application/json",
                }),
            })
        );
    });

    test("throws ApiError for non-ok responses", async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 400,
            statusText: "Bad Request",
            json: async () => ({ message: "Invalid payload" }),
        } as Response);

        await expect(apiFetch("/p2p/profile", { method: "POST", body: "{}" })).rejects.toEqual(
            expect.objectContaining({
                name: "ApiError",
                status: 400,
                message: "Invalid payload",
            })
        );
    });

    test("wraps fetch failures into ApiError with status 0", async () => {
        global.fetch = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));

        let thrown: unknown;
        try {
            await apiFetch("/p2p/profile", { method: "GET" });
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(ApiError);
        expect((thrown as ApiError).status).toBe(0);
        expect((thrown as ApiError).message).toContain("Network error while contacting API");
    });
});
