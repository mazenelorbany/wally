import { z } from 'zod';

// Multipart text fields arrive as strings, so booleans come through as
// "true"/"false". Coerce them honestly (z.coerce.boolean treats "false" as true).
const boolish = z.preprocess((v) => v === true || v === 'true', z.boolean());

// POST /projects/:id/bulletins (multipart; the file is a separate field).
export const CreateBulletinSchema = z.object({
  title: z.string().trim().min(1).max(300),
  body: z.string().max(50_000).optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  pinned: boolish.optional(),
  publish: boolish.optional(),
});
export type CreateBulletinInput = z.infer<typeof CreateBulletinSchema>;

// PATCH /bulletins/:id (JSON).
export const UpdateBulletinSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    body: z.string().max(50_000).optional(),
    startsAt: z.string().nullable().optional(),
    endsAt: z.string().nullable().optional(),
    pinned: z.boolean().optional(),
    publish: z.boolean().optional(),
  })
  .strict();
export type UpdateBulletinInput = z.infer<typeof UpdateBulletinSchema>;

// ?storeId= on the manager-facing bulletin routes (admin "view as" a store).
export const BulletinScopeSchema = z.object({ storeId: z.string().optional() });
export type BulletinScopeInput = z.infer<typeof BulletinScopeSchema>;
