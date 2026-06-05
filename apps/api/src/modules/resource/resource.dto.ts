import { z } from 'zod';

// Multipart text fields arrive as strings, so booleans come through as
// "true"/"false". Coerce them honestly (z.coerce.boolean treats "false" as true).
const boolish = z.preprocess((v) => v === true || v === 'true', z.boolean());

// POST /resources (multipart; an optional file is a separate field).
export const CreateResourceSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(10_000).optional(),
  category: z.string().trim().max(120).optional(),
  url: z.string().trim().url().max(2000).optional(),
  pinned: boolish.optional(),
});
export type CreateResourceInput = z.infer<typeof CreateResourceSchema>;

// PATCH /resources/:id (JSON).
export const UpdateResourceSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().max(10_000).optional(),
    category: z.string().trim().max(120).optional(),
    url: z.string().trim().url().max(2000).nullable().optional(),
    pinned: z.boolean().optional(),
  })
  .strict();
export type UpdateResourceInput = z.infer<typeof UpdateResourceSchema>;
