import { z } from 'zod';

// Review threads anchor to exactly ONE piece of a store's report: a fixture's
// photo step or a question answer. A thread on a fixture may additionally pin
// a spot on one gallery photo (normalized 0..1 coordinates).

export const CreateThreadSchema = z
  .object({
    storeId: z.string().min(1),
    campaignId: z.string().min(1),
    fixtureId: z.string().min(1).optional(),
    questionId: z.string().min(1).optional(),
    photoId: z.string().min(1).optional(),
    pinX: z.number().min(0).max(1).optional(),
    pinY: z.number().min(0).max(1).optional(),
    body: z.string().trim().min(1).max(4000),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (Boolean(v.fixtureId) === Boolean(v.questionId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'anchor the thread to exactly one of fixtureId or questionId',
      });
    }
    if (v.photoId && !v.fixtureId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a photo pin only makes sense on a fixture thread',
      });
    }
    if ((v.pinX == null) !== (v.pinY == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'pinX and pinY come together',
      });
    }
    if (v.pinX != null && !v.photoId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a pin needs the photoId it sits on',
      });
    }
  });

export type CreateThreadInput = z.infer<typeof CreateThreadSchema>;

export const ReplySchema = z
  .object({ body: z.string().trim().min(1).max(4000) })
  .strict();

export type ReplyInput = z.infer<typeof ReplySchema>;

// GET /report-threads?campaignId=…&storeId=… — storeId optional for a
// STORE_MANAGER (their own store is used, same convention as /manager/*).
export const ListThreadsSchema = z
  .object({
    campaignId: z.string().min(1),
    storeId: z.string().min(1).optional(),
  })
  .strict();

export type ListThreadsInput = z.infer<typeof ListThreadsSchema>;
