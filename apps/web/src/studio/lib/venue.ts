// Store names follow "{Venue} — {Brand}" (e.g. "Adelaide City Myer — The
// Cookshop"): one physical venue hosts several concession mini-stores, one per
// brand. Every venue-grouping surface (stores list, directory, floor-plan
// brand toggle) derives the pair from the name with these helpers so the
// convention lives in exactly one place.

export interface VenueName {
  venue: string;
  brand: string;
}

/** Split "{Venue} — {Brand}" — names without an em-dash are brandless venues. */
export function splitVenueName(name: string): VenueName {
  const parts = name.split(/\s*—\s*/);
  return parts.length >= 2
    ? {
        venue: parts.slice(0, -1).join(' — ').trim(),
        brand: parts[parts.length - 1]!.trim(),
      }
    : { venue: name.trim(), brand: '' };
}

/** "The Cookshop" → "Cookshop" for the brand toggle chips. */
export function brandLabel(brand: string): string {
  return brand.replace(/^The\s+/i, '');
}

/** True for the venue's default concession (floor plans open on Custom Chef). */
export function isDefaultBrand(brand: string): boolean {
  return /custom chef/i.test(brand);
}
