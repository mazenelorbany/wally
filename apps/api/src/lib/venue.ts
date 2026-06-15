// Store names follow "{Venue} — {Brand}" (e.g. "Adelaide City Myer — The
// Cookshop"): one physical venue hosts several concession mini-stores, one per
// brand. This is the API-side twin of apps/web/src/studio/lib/venue.ts — the
// convention lives in the name, and both sides derive it the same way.

/** "Adelaide City Myer — The Cookshop" → "Adelaide City Myer". */
export function venueOf(name: string): string {
  const parts = name.split(/\s*—\s*/);
  return parts.length >= 2 ? parts.slice(0, -1).join(' — ').trim() : name.trim();
}
