import { z } from 'zod';

// A rubric is append-only and versioned per (campaignId, fixtureKey). Publishing
// never mutates an existing row — it inserts the next version. So the only write
// DTO here is "publish": the full criteria set + rollup rule for a new version.
//
// Shapes mirror @wally/types (Criterion, RollupRule) exactly, but are declared
// as zod schemas so the payload is validated at the edge before it reaches the
// service. The DB stores them as Json columns.

export const CriterionSchema = z
  .object({
    // Stable id the model grades against and the verdict references. Letters,
    // digits, dot, dash, underscore — used as a JSON key, kept boring on purpose.
    id: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[A-Za-z0-9._-]+$/, 'criterion id may use letters, digits, dot, dash, underscore'),
    kind: z.enum(['presence', 'aesthetic']),
    critical: z.boolean(),
    text: z.string().min(1).max(500),
  })
  .strict();

export const RollupRuleSchema = z
  .object({
    not_good_if_any_critical_fails: z.boolean(),
    good_if_only_noncritical_fails: z.boolean(),
  })
  .strict();

// Default rollup matches the Prisma column default and the scoring core's
// DEFAULT_RULE — escalation-first, critical-fail dominates.
const DEFAULT_ROLLUP = {
  not_good_if_any_critical_fails: true,
  good_if_only_noncritical_fails: true,
} as const;

export const PublishRubricSchema = z
  .object({
    fixtureKey: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[A-Za-z0-9._-]+$/, 'fixtureKey may use letters, digits, dot, dash, underscore'),
    // At least one criterion — a rubric with nothing to grade is meaningless and
    // the store-rollup would have nothing to escalate on.
    criteria: z
      .array(CriterionSchema)
      .min(1, 'a rubric needs at least one criterion')
      .max(100)
      .superRefine((criteria, ctx) => {
        const seen = new Set<string>();
        for (const c of criteria) {
          if (seen.has(c.id)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `duplicate criterion id "${c.id}"`,
              path: [criteria.findIndex((x) => x.id === c.id), 'id'],
            });
          }
          seen.add(c.id);
        }
      }),
    rollupRule: RollupRuleSchema.default(DEFAULT_ROLLUP),
    // Storage key of the campaign's reference/standard image for the fixture.
    // OMITTED → the service carries the previous version's key forward (so an
    // edit never silently drops the reference). `null` → explicitly clear it.
    // A string → set/replace it. The uploader puts the bytes in StorageService
    // (POST .../reference-image) and hands the returned key here.
    referenceKey: z.string().max(256).nullable().optional(),
  })
  .strict();

export type PublishRubricInput = z.infer<typeof PublishRubricSchema>;

// POST /campaigns/:campaignId/rubrics/:fixtureKey/activate — flip the live
// grading version to a specific version (= rollback to / promote an earlier one)
// without publishing anything new. Identifies the target by version number.
export const ActivateRubricSchema = z
  .object({
    version: z.number().int().positive(),
  })
  .strict();

export type ActivateRubricInput = z.infer<typeof ActivateRubricSchema>;
