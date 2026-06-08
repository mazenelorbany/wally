import { z } from 'zod';

export const CreateStoreSchema = z
  .object({
    name: z.string().min(1).max(120),
    // "House", "Robins Kitchen", "The Custom Chef" — free text by design;
    // brand taxonomy lives in the merchandising data, not enforced here.
    brand: z.string().min(1).max(120),
    // The project (venue group) this store belongs to. Drives project-scoped
    // campaign resolution + venue lists; validated in-org by the service.
    projectId: z.string().min(1).optional(),
    externalRef: z.string().max(120).optional(),
    // Segmentation dimensions (analytics filters). Free entry, but the directory
    // nudges reuse via a datalist and the service trims/collapses on write.
    region: z.string().max(80).optional(),
    areaManager: z.string().max(120).optional(),
    storeType: z.string().max(80).optional(),
  })
  .strict();

export type CreateStoreInput = z.infer<typeof CreateStoreSchema>;

// Patch a store — every field optional; null clears the column.
export const UpdateStoreSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    brand: z.string().min(1).max(120).optional(),
    // Re-home a store to another project, or null to detach it.
    projectId: z.string().min(1).nullable().optional(),
    externalRef: z.string().max(120).nullable().optional(),
    region: z.string().max(80).nullable().optional(),
    areaManager: z.string().max(120).nullable().optional(),
    storeType: z.string().max(80).nullable().optional(),
  })
  .strict();

export type UpdateStoreInput = z.infer<typeof UpdateStoreSchema>;
