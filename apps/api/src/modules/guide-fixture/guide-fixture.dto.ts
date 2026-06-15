import { z } from 'zod';

// PATCH /guide-fixtures/:id — save the VM notes (rich text / markdown). Capped
// generously; empty string is allowed (clearing the sheet).
export const SaveNotesSchema = z
  .object({
    notes: z.string().max(20_000),
  })
  .strict();

export type SaveNotesInput = z.infer<typeof SaveNotesSchema>;

// PUT /guide-fixtures/:id/instructions — replace the ordered step list.
export const SaveInstructionsSchema = z
  .object({
    steps: z.array(z.object({ text: z.string().max(2000) }).strict()).max(50),
  })
  .strict();
export type SaveInstructionsInput = z.infer<typeof SaveInstructionsSchema>;

// POST /guide-fixtures/:id/checklist — add a checklist item.
export const AddChecklistSchema = z
  .object({
    label: z.string().min(1).max(200),
    required: z.boolean().optional(),
  })
  .strict();
export type AddChecklistInput = z.infer<typeof AddChecklistSchema>;

// PATCH /guide-fixtures/:id/checklist/:itemId — edit a checklist item.
export const UpdateChecklistSchema = z
  .object({
    label: z.string().min(1).max(200).optional(),
    required: z.boolean().optional(),
  })
  .strict();
export type UpdateChecklistInput = z.infer<typeof UpdateChecklistSchema>;

// POST /guide-fixtures/:id/checklist/reorder — full ordered id list.
export const ReorderChecklistSchema = z
  .object({ ids: z.array(z.string().min(1)).min(1) })
  .strict();
export type ReorderChecklistInput = z.infer<typeof ReorderChecklistSchema>;

// Optional POST /guide-fixtures/:id/merchandise — place a product on the sheet.
export const AddMerchandiseSchema = z
  .object({
    productId: z.string().min(1),
    row: z.string().trim().max(120).optional(),
  })
  .strict();

export type AddMerchandiseInput = z.infer<typeof AddMerchandiseSchema>;

// PATCH /guide-fixtures/:id/planogram — persist a full drag-and-drop layout:
// shelves top→bottom, each a left→right list of merchandise ids. The server
// owns the `order` integer (the client only sends structure).
export const ReorderPlanogramSchema = z
  .object({
    shelves: z
      .array(
        z.object({
          row: z.string().trim().min(1).max(120),
          merchandiseIds: z.array(z.string().min(1)),
        }),
      )
      .max(50),
  })
  .strict()
  .refine(
    (s) => {
      const labels = s.shelves.map((x) => x.row.toLowerCase());
      return new Set(labels).size === labels.length;
    },
    { message: 'duplicate shelf label' },
  )
  .refine(
    (s) => {
      const ids = s.shelves.flatMap((x) => x.merchandiseIds);
      return new Set(ids).size === ids.length;
    },
    { message: 'duplicate merchandise id' },
  );

export type ReorderPlanogramInput = z.infer<typeof ReorderPlanogramSchema>;

// POST /guide-fixtures/:id/example-images — the caption is an optional text field
// sent alongside the multipart `file`. Empty/whitespace collapses to no caption.
export const AddExampleImageSchema = z
  .object({
    caption: z.string().trim().max(280).optional(),
  })
  .strict();

export type AddExampleImageInput = z.infer<typeof AddExampleImageSchema>;

// PATCH /guide-fixtures/:id/example-images/:imageId — edit the caption. An empty
// string clears it (null in the DB).
export const UpdateExampleImageSchema = z
  .object({
    caption: z.string().trim().max(280),
  })
  .strict();

export type UpdateExampleImageInput = z.infer<typeof UpdateExampleImageSchema>;
