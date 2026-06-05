// =============================================================================
// seed-myer.ts — pure data loaders/helpers for the Myer seed (no DB access).
// =============================================================================
//
// Keeps seed.ts focused on the upsert orchestration. Everything here is pure:
// it reads the three seed-data JSONs from disk, parses prices, joins products to
// their web enrichment, and exposes a deterministic product→fixture mapping so
// the seed (and any test) can reason about placement without a database.
// =============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SEED_DATA_DIR = join(__dirname, 'seed-data');

// ─────────────────────────────────────────── raw JSON shapes (on disk)
interface RawFixture {
  label: string;
  kind: string;
  dept: string; // "TCC" | "TCS" | "shared"
  applies: string;
  note?: string;
}
interface RawCampaign {
  key: string;
  name: string;
  window: string;
  departments: string[];
}
interface MyerFixturesFile {
  campaign: RawCampaign;
  fixtures: RawFixture[];
  ranges_displayed: string[];
}
interface RawProduct {
  sku: string;
  name: string;
  brand: string;
  range: string;
  rrp: string; // "$1,349.99"
  salePrice: string; // "$199.99"
  fixture: string; // placement hint: "IKEA TABLE" | "BULK STACK" | "END CAPS" | "TRESTLE TABLES"
  status: string;
}
interface RawEnrichment {
  sku: string;
  title: string | null;
  imageUrl: string | null;
  webSalePrice: string | null;
  webRrp: string | null;
  matched: string;
}

// ─────────────────────────────────────────── parsed / joined shapes (exported)
export interface MyerProduct {
  sku: string;
  name: string; // VM-guide label
  webTitle: string | null;
  brand: string;
  range: string;
  category: string; // == range (the buying category for this campaign)
  imageUrl: string | null;
  rrp: number | null;
  salePrice: number | null;
  fixtureHint: string; // raw placement hint from the product sheet
  status: string;
}

export interface MyerCampaignMeta {
  key: string;
  name: string;
  window: string;
  departments: string[];
}

/** "$1,349.99" → 1349.99 ; "" / null / "$" → null. */
export function parsePrice(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(SEED_DATA_DIR, file), 'utf8')) as T;
}

/** The campaign header from myer-fixtures.json (display name + window). */
export function loadCampaignMeta(): MyerCampaignMeta {
  const f = readJson<MyerFixturesFile>('myer-fixtures.json');
  return {
    key: f.campaign.key,
    name: f.campaign.name,
    window: f.campaign.window,
    departments: f.campaign.departments,
  };
}

/**
 * Load the 122 Baccarat products, joined to their web enrichment by sku.
 * rrp prefers the product sheet, falling back to enrichment.webRrp; salePrice
 * likewise prefers the product sheet, falling back to enrichment.webSalePrice.
 * imageUrl comes from enrichment (may be null when the web match failed).
 */
export function loadProducts(): MyerProduct[] {
  const products = readJson<RawProduct[]>('myer-baccarat-products.json');
  const enrichment = readJson<RawEnrichment[]>('baccarat-web-enrichment.json');
  const enrichBySku = new Map(enrichment.map((e) => [e.sku, e]));

  return products.map((p) => {
    const e = enrichBySku.get(p.sku);
    const rrp = parsePrice(p.rrp) ?? parsePrice(e?.webRrp ?? null);
    const salePrice = parsePrice(p.salePrice) ?? parsePrice(e?.webSalePrice ?? null);
    return {
      sku: p.sku,
      name: p.name,
      webTitle: e?.title ?? null,
      brand: p.brand,
      range: p.range,
      category: p.range,
      imageUrl: e?.imageUrl ?? null,
      rrp,
      salePrice,
      fixtureHint: p.fixture,
      status: p.status,
    };
  });
}

// ─────────────────────────────────────────── product → guide-fixture mapping
// Map each product to a guide-fixture NAME (must exist in seed.ts's fixture
// library). Driven by range first (the merchandising story), with the product
// sheet's fixture hint as a tie-breaker. Every applicable guide fixture should
// end up with ~3–10 products; ranges with no obvious home spread across wall
// bays by a deterministic hash so re-runs are stable.

export const FIXTURE_FOR_RANGE: Record<string, string> = {
  'LE CON': 'VM TABLE 1', // Le Connoisseur → the promo VM table 1
  NOOK: 'VM TABLE 2', // NOOK → VM table 2
  'ID3 CS': 'VM TABLE 3', // ID3 cookset/loose → VM table 3
  'LOOSE COOKWARE': 'VM TABLE 3',
  COOKSETS: 'COOKSET BULKSTACK', // boxed cooksets → cookset bulk stack
  'KITCHEN APPLIANCES': 'ELECTRICAL STAND 1', // appliances → electrical stand
  GRYLT: 'FRY WALL BAY 01', // cast-iron grill range → fry wall
};

// Wall bays to spread leftover / unmapped ranges across (deterministic).
export const SPREAD_WALL_BAYS = [
  'TCC WALL BAY 2',
  'TCC WALL BAY 3',
  'TCC WALL BAY 4',
  'TCC WALL BAY 5',
];

/** Deterministic 0..n-1 bucket from a string (FNV-1a). */
export function bucket(s: string, n: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % n;
}

/** The guide-fixture NAME a product merchandises onto. */
export function fixtureForProduct(p: MyerProduct): string {
  const mapped = FIXTURE_FOR_RANGE[p.range];
  if (mapped) return mapped;
  // No obvious home (e.g. an odd range) → spread across wall bays by sku hash.
  return SPREAD_WALL_BAYS[bucket(p.sku, SPREAD_WALL_BAYS.length)];
}

/** A shelf-row label for a product, grouping a fixture's items into 3 bands. */
export function rowForProduct(p: MyerProduct): string {
  const rows = ['Top shelf', 'Eye level', 'Lower'];
  return rows[bucket(p.sku, rows.length)];
}
