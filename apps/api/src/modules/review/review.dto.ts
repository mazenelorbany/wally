import { z } from 'zod';

// A reviewer's action on a machine verdict. Three actions:
//   CONFIRM  — agree with the model; an audit row, no verdict change. An
//              optional note is allowed (and persisted as the Review reason).
//   OVERRIDE — disagree with the model. Two shapes, both supported:
//                • whole-fixture band  → `overall` (the corrected Overall band).
//                  This is what the console offers: the reviewer picks the right
//                  band and the verdict's overall is set directly.
//                • per-criterion flip  → `criterionId` + `toVerdict` (the same
//                  lowercase VerdictValue the scoring core uses). Flips that one
//                  criterion and recomputes the fixture rollup.
//   ESCALATE — kick it up a level (e.g. to an admin / regional manager). An
//              optional note is allowed.
//
// `note` is the reviewer-facing field name (what the UI sends); it is persisted
// as the Review `reason`. `reason` is also accepted as an alias for API callers.

export const ReviewActionSchema = z.enum(['CONFIRM', 'OVERRIDE', 'ESCALATE']);

// The fixture-level band the reviewer can correct an OVERRIDE to — the lowercase
// @wally/types Overall, mirrored here so the DTO stays self-contained.
export const OverallBandSchema = z.enum([
  'perfect',
  'good',
  'not_good',
  'needs_review',
]);

export const CreateReviewSchema = z
  .object({
    action: ReviewActionSchema,
    // Whole-fixture OVERRIDE: the corrected Overall band. Mutually exclusive
    // with the per-criterion form below.
    overall: OverallBandSchema.optional(),
    // Per-criterion OVERRIDE: which criterion + its corrected verdict.
    criterionId: z.string().min(1).max(60).optional(),
    toVerdict: z.enum(['pass', 'fail', 'unsure']).optional(),
    // Reviewer's note (UI field). Persisted as Review.reason.
    note: z.string().min(1).max(1000).optional(),
    // Alias accepted for API callers; folded into `note` at the boundary.
    reason: z.string().min(1).max(1000).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.action === 'OVERRIDE') {
      const hasBand = v.overall !== undefined;
      const hasCriterion =
        v.criterionId !== undefined || v.toVerdict !== undefined;
      if (!hasBand && !hasCriterion) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'OVERRIDE requires either `overall` (a corrected band) or `criterionId`+`toVerdict`',
          path: ['overall'],
        });
      }
      if (hasBand && hasCriterion) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'OVERRIDE takes either `overall` or `criterionId`+`toVerdict`, not both',
          path: ['overall'],
        });
      }
      // The per-criterion form needs BOTH halves to be actionable.
      if (hasCriterion && (!v.criterionId || !v.toVerdict)) {
        if (!v.criterionId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'per-criterion OVERRIDE requires criterionId',
            path: ['criterionId'],
          });
        }
        if (!v.toVerdict) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'per-criterion OVERRIDE requires toVerdict',
            path: ['toVerdict'],
          });
        }
      }
    }
  });

export type CreateReviewInput = z.infer<typeof CreateReviewSchema>;
