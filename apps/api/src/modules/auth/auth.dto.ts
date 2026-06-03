// Zod request schemas for the auth controller. Mirrors the rest of the API,
// which validates every body with zod via the shared ZodValidationPipe rather
// than class-validator. Keep these strict() so a typo'd field 400s loudly.
import { z } from 'zod';

// The three roles, as a zod enum that matches the Prisma `Role` enum values.
const RoleSchema = z.enum(['ADMIN', 'REVIEWER', 'STORE_MANAGER']);

/**
 * POST /auth/magic-link/request — invite a user into an org (and optionally a
 * store) with a role. The admin issuing the invite chooses the scope; the
 * requester only supplies an email + the org/store it's for.
 */
export const MagicLinkRequestSchema = z
  .object({
    email: z.string().email(),
    orgId: z.string().min(1),
    storeId: z.string().min(1).optional(),
    role: RoleSchema.optional(),
  })
  .strict();

export type MagicLinkRequestInput = z.infer<typeof MagicLinkRequestSchema>;

/** POST /auth/dev-login — pick a role to impersonate (development only). */
export const DevLoginSchema = z
  .object({
    role: RoleSchema,
  })
  .strict();

export type DevLoginInput = z.infer<typeof DevLoginSchema>;
