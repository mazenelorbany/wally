import { z } from 'zod';

// Shared store-resolution query: `?storeId=` is optional. For a STORE_MANAGER
// it's ignored (their own store is used); for ADMIN/REVIEWER it selects which
// store's workspace to view (the demo "view as store" switcher).
export const StoreScopeSchema = z
  .object({
    storeId: z.string().min(1).optional(),
  })
  .strict();

export type StoreScopeInput = z.infer<typeof StoreScopeSchema>;

// PUT /manager/sales/:productId — set the units sold for one product. Idempotent
// upsert keyed on (store, campaign, product); units is a non-negative integer.
export const LogSaleSchema = z
  .object({
    units: z.number().int().min(0),
  })
  .strict();

export type LogSaleInput = z.infer<typeof LogSaleSchema>;
