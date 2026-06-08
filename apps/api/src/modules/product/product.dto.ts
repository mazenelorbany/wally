import { z } from 'zod';

// Catalog filter query for GET /products. All optional — an empty query returns
// the (capped) catalog. `search` matches name OR sku (case-insensitive); the
// other three are exact-ish facet filters that pair with the merchandising data.
// `includeArchived` opts archived (soft-deleted) products back into the list —
// the default hides them so they leave the working catalog + the picker.
export const ProductFilterSchema = z
  .object({
    search: z.string().trim().max(120).optional(),
    brand: z.string().trim().max(120).optional(),
    category: z.string().trim().max(120).optional(),
    color: z.string().trim().max(120).optional(),
    // Query params arrive as strings; the service treats "true" as the opt-in.
    // (Kept as a string enum so the pipe's input/output type stays aligned.)
    includeArchived: z.enum(['true', 'false']).optional(),
  })
  .strict();

export type ProductFilterInput = z.infer<typeof ProductFilterSchema>;

// Shared field shapes so Create + Update agree. rrp/salePrice are non-negative
// money values (the per-unit price the sales log snapshots against).
const sku = z.string().trim().min(1).max(80);
const name = z.string().trim().min(1).max(200);
const optionalText = (max: number) => z.string().trim().max(max).optional();
const money = z.number().nonnegative().optional();

// POST /products — add a product to the org catalog. `sku` is the unique key
// (per org) and `name` is the VM-guide label; everything else is optional
// merchandising metadata. `.strict()` rejects unknown keys at the edge.
export const CreateProductSchema = z
  .object({
    sku,
    name,
    webTitle: optionalText(200),
    brand: optionalText(120),
    range: optionalText(120),
    category: optionalText(120),
    color: optionalText(120),
    imageUrl: optionalText(2048),
    rrp: money,
    salePrice: money,
  })
  .strict();

export type CreateProductInput = z.infer<typeof CreateProductSchema>;

// PATCH /products/:id — every field optional (send only what changed). `sku` is
// editable but still unique-checked in the service (P2002 → 409). Text fields
// accept null to clear the column; at least one field must be present so an
// empty body is a no-op the client never intends.
export const UpdateProductSchema = z
  .object({
    sku: sku.optional(),
    name: name.optional(),
    webTitle: z.string().trim().max(200).nullable().optional(),
    brand: z.string().trim().max(120).nullable().optional(),
    range: z.string().trim().max(120).nullable().optional(),
    category: z.string().trim().max(120).nullable().optional(),
    color: z.string().trim().max(120).nullable().optional(),
    imageUrl: z.string().trim().max(2048).nullable().optional(),
    rrp: z.number().nonnegative().nullable().optional(),
    salePrice: z.number().nonnegative().nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'provide at least one field to update',
  });

export type UpdateProductInput = z.infer<typeof UpdateProductSchema>;
