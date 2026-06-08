import { z } from 'zod';

// PATCH /placements/:id — edit a placed fixture on the floor plan. Geometry
// (move / resize / rotate) plus the editable per-placement fields: `label`
// (inline rename), `order` (reorder the manager checklist), and `applicable`
// ("we don't have this fixture here" — a non-destructive opt-out so the store's
// compliance sheet stops asking for a photo it can never take). Every field is
// optional (the canvas may send just an x/y nudge), but at least one must be
// present so an empty body is a no-op the client never intends. Geometry is in
// floor-plan units; rotation in degrees.
export const UpdatePlacementSchema = z
  .object({
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    w: z.number().finite().positive().optional(),
    h: z.number().finite().positive().optional(),
    rotation: z.number().finite().optional(),
    label: z.string().min(1).max(120).optional(),
    order: z.number().int().min(0).optional(),
    applicable: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message:
      'provide at least one of x, y, w, h, rotation, label, order, applicable',
  });

export type UpdatePlacementInput = z.infer<typeof UpdatePlacementSchema>;

// POST /campaigns/:campaignId/stores/:storeId/placements — add a fixture to a
// store's floor plan (the layout builder). Only `fixtureId` is required; the
// geometry + label default server-side (centre of canvas, the fixture's name).
// Idempotent on (storeId, campaignId, fixtureId): re-posting returns the
// existing placement rather than erroring.
export const CreatePlacementSchema = z
  .object({
    fixtureId: z.string().min(1),
    label: z.string().optional(),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    w: z.number().finite().positive().optional(),
    h: z.number().finite().positive().optional(),
    rotation: z.number().finite().optional(),
  })
  .strict();

export type CreatePlacementInput = z.infer<typeof CreatePlacementSchema>;

// POST /campaigns/:campaignId/stores/:storeId/copy-layout — copy another store's
// whole floor-plan layout onto this one (the target). Idempotent: re-copying
// overwrites the target's matching placements rather than duplicating them.
export const CopyLayoutSchema = z
  .object({
    fromStoreId: z.string().min(1),
  })
  .strict();

export type CopyLayoutInput = z.infer<typeof CopyLayoutSchema>;
