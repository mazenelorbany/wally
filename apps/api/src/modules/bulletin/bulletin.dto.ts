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

// PATCH /bulletins/:id (multipart — the optional replacement file is a separate
// field). Multipart text fields arrive as strings, so booleans are coerced and
// an empty-string date means "clear it" (null); an absent field is untouched.
// NOT .strict(): a multipart body may carry the `file` field, which Multer
// strips before validation but other framework noise can slip through.
const dateField = z.preprocess(
  (v) => (v === '' ? null : v),
  z.string().nullable().optional(),
);
export const UpdateBulletinSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  body: z.string().max(50_000).optional(),
  startsAt: dateField,
  endsAt: dateField,
  pinned: boolish.optional(),
  publish: boolish.optional(),
  // Drop the current attachment (ignored when a replacement file is supplied).
  removeAttachment: boolish.optional(),
});
export type UpdateBulletinInput = z.infer<typeof UpdateBulletinSchema>;

// ?storeId= on the manager-facing bulletin routes (admin "view as" a store).
export const BulletinScopeSchema = z.object({ storeId: z.string().optional() });
export type BulletinScopeInput = z.infer<typeof BulletinScopeSchema>;
