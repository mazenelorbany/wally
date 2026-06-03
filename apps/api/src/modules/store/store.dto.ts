import { z } from 'zod';

export const CreateStoreSchema = z
  .object({
    name: z.string().min(1).max(120),
    // "House", "Robins Kitchen", "The Custom Chef" — free text by design;
    // brand taxonomy lives in the merchandising data, not enforced here.
    brand: z.string().min(1).max(120),
    externalRef: z.string().max(120).optional(),
  })
  .strict();

export type CreateStoreInput = z.infer<typeof CreateStoreSchema>;
