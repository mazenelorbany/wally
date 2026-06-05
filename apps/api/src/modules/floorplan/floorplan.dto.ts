import { z } from 'zod';

// PATCH /placements/:id — move / resize / rotate a placed fixture on the floor
// plan. Every field is optional (the canvas may send just an x/y nudge, or a
// w/h resize), but at least one must be present so an empty body is a no-op the
// client never intends. Geometry is in floor-plan units; rotation in degrees.
export const UpdatePlacementSchema = z
  .object({
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    w: z.number().finite().positive().optional(),
    h: z.number().finite().positive().optional(),
    rotation: z.number().finite().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'provide at least one of x, y, w, h, rotation',
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
