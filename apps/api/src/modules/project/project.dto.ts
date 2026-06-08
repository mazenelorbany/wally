import { z } from 'zod';

// POST /projects — create a top-level project (a Myer retail programme, an
// Ambiente tradeshow, …). `name` is the human label; `kind` decides the venue
// model. The slug is derived server-side (kebab-case of name, unique per org).
export const CreateProjectSchema = z
  .object({
    name: z.string().trim().min(1, 'name is required'),
    kind: z.enum(['RETAIL', 'TRADESHOW']),
  })
  .strict();

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

// PATCH /projects/:id — rename a project and/or change its kind. Both fields are
// optional (send only what changed) but at least one is required, so an empty
// body is the no-op the client never intends. `.strict()` rejects unknown keys.
//
// `slug` and `orgId` are intentionally NOT editable: the slug is the project's
// stable per-org key (links, lookups, the @@unique(orgId, slug) handle), and the
// org is the tenancy boundary — neither is ever rewritten by an edit.
export const UpdateProjectSchema = z
  .object({
    name: z.string().trim().min(1, 'name is required').optional(),
    kind: z.enum(['RETAIL', 'TRADESHOW']).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'provide at least one field to update',
  });

export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;
