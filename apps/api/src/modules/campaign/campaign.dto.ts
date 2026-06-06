import { z } from 'zod';

export const CreateCampaignSchema = z
  .object({
    // "MSP2-2026" — stable human key, unique per org (enforced by the DB).
    key: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[A-Za-z0-9._-]+$/, 'key may use letters, digits, dot, dash, underscore'),
    name: z.string().min(1).max(160),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
  })
  .strict()
  .refine(
    (c) => !c.startsAt || !c.endsAt || c.endsAt >= c.startsAt,
    { message: 'endsAt must be on or after startsAt', path: ['endsAt'] },
  );

export type CreateCampaignInput = z.infer<typeof CreateCampaignSchema>;

/**
 * Edit a campaign's mutable fields. `key` is intentionally absent — it's the
 * stable human handle, `@@unique([orgId, key])`, and is referenced as an
 * identifier across surfaces, so it stays immutable after creation (re-key by
 * creating a new campaign). All fields optional; the same startsAt<=endsAt
 * order check applies, evaluated against whichever of the two ends up set.
 */
export const UpdateCampaignSchema = z
  .object({
    name: z.string().min(1).max(160).optional(),
    // `null` clears the date; omitted leaves it unchanged.
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional(),
  })
  .strict()
  .refine(
    (c) => !c.startsAt || !c.endsAt || c.endsAt >= c.startsAt,
    { message: 'endsAt must be on or after startsAt', path: ['endsAt'] },
  );

export type UpdateCampaignInput = z.infer<typeof UpdateCampaignSchema>;
