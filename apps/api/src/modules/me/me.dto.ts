import { z } from 'zod';

// PATCH /me/preferences — the signed-in user's own account preferences.
//
// This is the admin/reviewer Settings surface (distinct from the manager-only
// `manager/preferences`, which owns the task-alert toggle). For now it carries
// just the chase-email opt-out; new self-service prefs land here.
export const UpdateMePreferencesSchema = z
  .object({
    chaseEmails: z.boolean().optional(),
  })
  .strict();

export type UpdateMePreferencesInput = z.infer<typeof UpdateMePreferencesSchema>;
