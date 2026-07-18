import {
    DEFAULT_DSA_CATALOG_LIMIT,
    MAX_DSA_CATALOG_LIMIT,
    dsaCatalogQuerySchema,
} from "./ide-catalog-query.js";

describe("DSA catalog query parsing", () => {
    it("accepts the deployed legacy limit=1000 request", () => {
        const parsed = dsaCatalogQuerySchema.safeParse({
            page: "1",
            limit: "1000",
        });

        expect(parsed.success).toBe(true);
        if (!parsed.success) return;

        expect(parsed.data.page).toBe(1);
        expect(parsed.data.limit).toBe(MAX_DSA_CATALOG_LIMIT);
    });

    it("defaults the catalog limit and clamps oversized requests", () => {
        const defaulted = dsaCatalogQuerySchema.parse({});
        const clamped = dsaCatalogQuerySchema.parse({
            page: "1",
            limit: "5000",
        });

        expect(defaulted.limit).toBe(DEFAULT_DSA_CATALOG_LIMIT);
        expect(clamped.limit).toBe(MAX_DSA_CATALOG_LIMIT);
    });
});
