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
