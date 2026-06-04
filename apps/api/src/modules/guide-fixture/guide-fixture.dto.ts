import { z } from 'zod';

// PATCH /guide-fixtures/:id — save the VM notes (rich text / markdown). Capped
// generously; empty string is allowed (clearing the sheet).
export const SaveNotesSchema = z
  .object({
    notes: z.string().max(20_000),
  })
  .strict();

export type SaveNotesInput = z.infer<typeof SaveNotesSchema>;

// Optional POST /guide-fixtures/:id/merchandise — place a product on the sheet.
export const AddMerchandiseSchema = z
  .object({
    productId: z.string().min(1),
    row: z.string().trim().max(120).optional(),
  })
  .strict();

export type AddMerchandiseInput = z.infer<typeof AddMerchandiseSchema>;
