// =============================================================================
// The single API client for @wally/web.
//
// Wraps @wally/sdk's `createClient`, pointed at the dev API (port 3001) unless
// `VITE_API_URL` overrides it. The SDK sends `credentials: 'include'` on every
// request, so the browser attaches the `wally_session` cookie the API sets.
// Import `api` everywhere; never construct a second client.
// =============================================================================

import { createClient, ApiError } from '@wally/sdk';
import type { WallyClient } from '@wally/sdk';

// In production the SPA is served from the SAME origin as the API (one Railway
// service), so default to the current origin and let the SDK append `/api`.
// `VITE_API_URL` still overrides for split deployments; dev falls back to the
// local API on :3001.
const baseUrl =
  (import.meta.env.VITE_API_URL as string | undefined)?.trim() ||
  (import.meta.env.PROD ? window.location.origin : 'http://localhost:3001');

export const api: WallyClient = createClient({ baseUrl });

export { ApiError };

/** Lift a human-readable message off any thrown value (ApiError or otherwise). */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Something went wrong. Please try again.';
}

/** HTTP status of an error, when it is an ApiError. */
export function errorStatus(err: unknown): number | undefined {
  return err instanceof ApiError ? err.status : undefined;
}
