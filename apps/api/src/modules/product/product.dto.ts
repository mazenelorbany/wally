import { z } from 'zod';

// Catalog filter query for GET /products. All optional — an empty query returns
// the (capped) catalog. `search` matches name OR sku (case-insensitive); the
// other three are exact-ish facet filters that pair with the merchandising data.
export const ProductFilterSchema = z
  .object({
    search: z.string().trim().max(120).optional(),
    brand: z.string().trim().max(120).optional(),
    category: z.string().trim().max(120).optional(),
    color: z.string().trim().max(120).optional(),
  })
  .strict();

export type ProductFilterInput = z.infer<typeof ProductFilterSchema>;
