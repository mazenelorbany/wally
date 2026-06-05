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

const ROLES = ['ADMIN', 'REVIEWER', 'STORE_MANAGER', 'VIEWER'] as const;

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
