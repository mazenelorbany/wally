import { z } from 'zod';

// The fixture "kinds" mirror the @wally/types FixtureKind union and the DB
// default ("bay"). Kept as a zod enum so POST /fixtures rejects a typo'd kind
// at the edge rather than letting free text into the library.
export const FIXTURE_KINDS = [
  'bay',
  'table',
  'stand',
  'window',
  'dais',
  'trolley',
] as const;

export const CreateFixtureSchema = z
  .object({
    name: z.string().min(1).max(120),
    kind: z.enum(FIXTURE_KINDS).default('bay'),
  })
  .strict();

export type CreateFixtureInput = z.infer<typeof CreateFixtureSchema>;
