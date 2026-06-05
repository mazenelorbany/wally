import { z } from 'zod';

// POST /admin/stores/:storeId/tasks — an admin assigns a task to a store's
// manager. `kind` drives the manager UI (UPLOAD_PHOTO surfaces a fixture target,
// LOG_SALES jumps to the sales log, GENERAL is a free-form ask). `dueAt` is an
// ISO datetime when present.
export const CreateTaskSchema = z
  .object({
    kind: z.enum(['UPLOAD_PHOTO', 'LOG_SALES', 'GENERAL']),
    title: z.string().min(1),
    body: z.string().optional(),
    fixtureKey: z.string().optional(),
    dueAt: z.string().datetime().optional(),
  })
  .strict();

export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
