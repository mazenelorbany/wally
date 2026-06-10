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

// A calendar day in 'YYYY-MM-DD'. Sales are logged per day, so the manager can
// enter (and review) any date; the UI defaults to today.
const DateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

// GET /manager/sales — store scope + which day to show (default: today).
export const SalesQuerySchema = z
  .object({
    storeId: z.string().min(1).optional(),
    date: DateOnly.optional(),
  })
  .strict();

export type SalesQueryInput = z.infer<typeof SalesQuerySchema>;

// PUT /manager/sales/:productId — set the units sold for one product ON A DAY.
// Idempotent upsert keyed on (store, campaign, product, soldOn).
export const LogSaleSchema = z
  .object({
    units: z.number().int().min(0),
    date: DateOnly.optional(),
  })
  .strict();

export type LogSaleInput = z.infer<typeof LogSaleSchema>;

// PATCH /manager/preferences — the signed-in user's own notification prefs.
export const UpdatePreferencesSchema = z
  .object({
    notifyOnNewTask: z.boolean().optional(),
  })
  .strict();

export type UpdatePreferencesInput = z.infer<typeof UpdatePreferencesSchema>;

// POST /manager/fixtures/:fixtureId/override — a REVIEWER/ADMIN's human verdict
// that supersedes the AI verdict for this fixture's capture (with an optional
// rationale). The store-scope query is carried separately, as on the other routes.
export const OverrideCaptureSchema = z
  .object({
    verdict: z.enum(['PASS', 'NEEDS_REVIEW', 'FAIL']),
    note: z.string().trim().max(2000).optional(),
  })
  .strict();

export type OverrideCaptureInput = z.infer<typeof OverrideCaptureSchema>;

// PUT /manager/fixtures/:fixtureId/checklist/:itemId — tick/untick a checklist item.
export const TickChecklistSchema = z.object({ checked: z.boolean() }).strict();
export type TickChecklistInput = z.infer<typeof TickChecklistSchema>;
