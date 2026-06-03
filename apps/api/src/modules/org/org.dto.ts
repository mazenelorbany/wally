import { z } from 'zod';

// Org is CRUD-lite: a caller only ever reads/updates the org their session is
// scoped to (req.user.orgId). There is no "create org" here — that's a
// provisioning/admin concern outside the per-tenant API surface.

export const UpdateOrgSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    slug: z
      .string()
      .min(2)
      .max(60)
      .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, digits, or hyphens')
      .optional(),
  })
  .strict();

export type UpdateOrgInput = z.infer<typeof UpdateOrgSchema>;
