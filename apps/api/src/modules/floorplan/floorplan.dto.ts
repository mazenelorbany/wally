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
