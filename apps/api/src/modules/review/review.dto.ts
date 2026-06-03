import { z } from 'zod';

// A reviewer's action on a machine verdict. Three actions:
//   CONFIRM  — agree with the model; an audit row, no verdict change.
//   OVERRIDE — disagree on one criterion (criterionId + toVerdict required);
//              flips that criterion and recomputes the fixture rollup.
//   ESCALATE — kick it up a level (e.g. to an admin / regional manager).
//
// toVerdict, when present, is a per-criterion pass/fail/unsure — the same
// VerdictValue the scoring core uses (lowercase), NOT the fixture-level Overall.

export const ReviewActionSchema = z.enum(['CONFIRM', 'OVERRIDE', 'ESCALATE']);

export const CreateReviewSchema = z
  .object({
    action: ReviewActionSchema,
    // Which criterion this action targets. Required for OVERRIDE (you override a
    // specific criterion); optional for CONFIRM/ESCALATE (whole-fixture).
    criterionId: z.string().min(1).max(60).optional(),
    // The corrected per-criterion verdict. Required for OVERRIDE.
    toVerdict: z.enum(['pass', 'fail', 'unsure']).optional(),
    reason: z.string().min(1).max(1000).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.action === 'OVERRIDE') {
      if (!v.criterionId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'OVERRIDE requires criterionId',
          path: ['criterionId'],
        });
      }
      if (!v.toVerdict) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'OVERRIDE requires toVerdict',
          path: ['toVerdict'],
        });
      }
    }
  });

export type CreateReviewInput = z.infer<typeof CreateReviewSchema>;
