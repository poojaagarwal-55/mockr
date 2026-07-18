import { z } from "zod";

export const MAX_DSA_CATALOG_LIMIT = 1000;
export const DEFAULT_DSA_CATALOG_LIMIT = 50;

export const dsaCatalogQuerySchema = z.object({
    difficulty: z.enum(["Easy", "Medium", "Hard"]).optional(),
    topics: z.union([z.string(), z.array(z.string())]).optional(),
    companies: z.union([z.string(), z.array(z.string())]).optional(),
    search: z.string().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce
        .number()
        .int()
        .positive()
        .default(DEFAULT_DSA_CATALOG_LIMIT)
        .transform((value) => Math.min(value, MAX_DSA_CATALOG_LIMIT)),
});
