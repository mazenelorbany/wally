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

// The two Myer departments a fixture can belong to. Drives the manager guide
// grouping; null/unset means "un-classified" (dumped under "Store").
export const DEPARTMENTS = ['The Custom Chef', 'The Cook Shop'] as const;

export const CreateFixtureSchema = z
  .object({
    name: z.string().min(1).max(120),
    kind: z.enum(FIXTURE_KINDS).default('bay'),
    department: z.enum(DEPARTMENTS).optional(),
    // The owning project. Omit (or send null) for a shared fixture visible in
    // every project; an id scopes it to that one project's library.
    projectId: z.string().min(1).max(64).nullable().optional(),
  })
  .strict();

export type CreateFixtureInput = z.infer<typeof CreateFixtureSchema>;

// PATCH /fixtures/:id — rename / re-kind / re-classify a library fixture. Every
// field optional (send only what changed); at least one must be present so an
// empty body is a no-op the client never intends. `department` accepts null to
// clear the classification.
export const UpdateFixtureSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    kind: z.enum(FIXTURE_KINDS).optional(),
    department: z.enum(DEPARTMENTS).nullable().optional(),
    // Re-home the fixture: an id moves it to that project, null makes it shared.
    projectId: z.string().min(1).max(64).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'provide at least one of name, kind, department, projectId',
  });

export type UpdateFixtureInput = z.infer<typeof UpdateFixtureSchema>;

// Body for adding a product to a fixture's default set. An optional `row` files
// it onto a planogram shelf (mirrors Merchandise.row on guide fixtures).
export const AddFixtureProductSchema = z
  .object({
    productId: z.string().min(1),
    row: z.string().trim().max(120).optional(),
  })
  .strict();

export type AddFixtureProductInput = z.infer<typeof AddFixtureProductSchema>;

// PATCH /fixtures/:id/planogram — persist the whole default-set layout:
// shelves top→bottom, each a left→right list of FixtureProduct ids. The server
// owns the `order` integer (the client only sends structure). Mirrors the
// guide-fixture ReorderPlanogramSchema.
export const ReorderFixturePlanogramSchema = z
  .object({
    shelves: z
      .array(
        z.object({
          row: z.string().trim().min(1).max(120),
          fixtureProductIds: z.array(z.string().min(1)),
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
      const ids = s.shelves.flatMap((x) => x.fixtureProductIds);
      return new Set(ids).size === ids.length;
    },
    { message: 'duplicate fixture-product id' },
  );

export type ReorderFixturePlanogramInput = z.infer<
  typeof ReorderFixturePlanogramSchema
>;
