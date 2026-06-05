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
