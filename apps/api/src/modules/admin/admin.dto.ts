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
    /** Optionally narrow the task to one manager (else store-wide). */
    assignedToId: z.string().optional(),
  })
  .strict();

export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;

// POST /admin/tasks/bulk — assign the same task to MANY stores at once (the
// "assign to all stores" affordance). `storeIds` is the explicit set of targets
// the UI resolved from the selected project/campaign.
export const BulkCreateTaskSchema = z
  .object({
    storeIds: z.array(z.string().min(1)).min(1),
    kind: z.enum(['UPLOAD_PHOTO', 'LOG_SALES', 'GENERAL']),
    title: z.string().min(1),
    body: z.string().optional(),
    fixtureKey: z.string().optional(),
    dueAt: z.string().datetime().optional(),
  })
  .strict();

export type BulkCreateTaskInput = z.infer<typeof BulkCreateTaskSchema>;

// PATCH /admin/tasks/:id — edit a task's title / body / due date / status. A
// status flip to DONE/OPEN moves it through the lifecycle (completedAt is
// stamped/cleared by the service). `dueAt` accepts null to clear it.
export const UpdateTaskSchema = z
  .object({
    title: z.string().min(1).optional(),
    body: z.string().nullable().optional(),
    dueAt: z.string().datetime().nullable().optional(),
    status: z.enum(['OPEN', 'DONE']).optional(),
  })
  .strict();

export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;

const ROLES = [
  'ADMIN',
  'REVIEWER',
  'STORE_MANAGER',
  'SETUP_CREW',
  'VIEWER',
] as const;

// Invite a teammate: creates/links the user at this org with a role (+ store for
// managers) and emails them a magic link to sign in.
export const InviteUserSchema = z
  .object({
    email: z.string().email(),
    name: z.string().max(120).optional(),
    role: z.enum(ROLES),
    storeId: z.string().optional(),
  })
  .strict();

export type InviteUserInput = z.infer<typeof InviteUserSchema>;

// Patch a user: change role, (re)assign a store, or (de)activate.
export const UpdateUserSchema = z
  .object({
    role: z.enum(ROLES).optional(),
    storeId: z.string().nullable().optional(),
    disabled: z.boolean().optional(),
  })
  .strict();

export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
