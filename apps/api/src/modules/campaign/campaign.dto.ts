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
