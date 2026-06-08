import { z } from 'zod';

// A submission is one store's response to one campaign (DB @@unique[storeId,
// campaignId]). Creating it is idempotent on that pair — see the service.

export const CreateSubmissionSchema = z
  .object({
    storeId: z.string().min(1).max(64),
    campaignId: z.string().min(1).max(64),
  })
  .strict();

export type CreateSubmissionInput = z.infer<typeof CreateSubmissionSchema>;

// Photo upload is multipart/form-data: the file rides as `photo`, and the
// fixture it depicts rides as a text field. We validate the text field with zod
// (the file itself is validated in the service: mime + size).
export const UploadPhotoSchema = z
  .object({
    fixtureKey: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[A-Za-z0-9._-]+$/, 'fixtureKey may use letters, digits, dot, dash, underscore'),
  })
  .strict();

export type UploadPhotoInput = z.infer<typeof UploadPhotoSchema>;

// Toggle a store execution photo as best-in-class (the showcase flag).
export const SetBestInClassSchema = z.object({ value: z.boolean() }).strict();

export type SetBestInClassInput = z.infer<typeof SetBestInClassSchema>;

// OPTIONAL analytics date window for the queue / turnaround surfaces. Both
// bounds are optional query params (`?from=…&to=…`, ISO dates). When absent the
// surface is all-time — the unchanged, backward-compatible behaviour. Invalid
// dates are rejected (a 400) rather than silently dropped.
const isoDate = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected an ISO date'));

export const AnalyticsWindowSchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .strict();

export type AnalyticsWindowInput = z.infer<typeof AnalyticsWindowSchema>;

/** Parse `{from?, to?}` query strings into a Date window (undefined when both absent). */
export function toDateWindow(
  q: AnalyticsWindowInput,
): { from?: Date; to?: Date } | undefined {
  const from = q.from ? new Date(q.from) : undefined;
  const to = q.to ? new Date(q.to) : undefined;
  if (!from && !to) return undefined;
  return { from, to };
}
