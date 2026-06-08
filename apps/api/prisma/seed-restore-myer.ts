// =============================================================================
// seed-restore-myer — import the REAL Myer data scraped from ReStore (project
// 1447) into Wally's Myer project.
//
// Reads the export at ~/work/TCC/restore-myer (manifest.json + the newest photo
// per store x fixture). Targets only the STABLE models (Store / Fixture /
// GuideFixture / ExampleImage) so it doesn't collide with the in-flight
// capture/submission pipeline migration:
//   - sets real store NUMBERS (externalRef) on the matching Myer stores
//   - creates the 16 real fixture categories as library fixtures + guide sheets
//   - attaches each store's newest real photo as a per-fixture reference gallery
//     ("what good looks like"), captioned by store + date
//
// Idempotent: upserts on natural keys; example images for the restore guide
// fixtures are cleared + recreated each run. Run:
//   pnpm --filter @wally/api exec tsx prisma/seed-restore-myer.ts
// =============================================================================

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { layoutFor } from './floor-layout';

// ── locations ───────────────────────────────────────────────────────────────
const EXPORT_DIR =
  process.env.RESTORE_EXPORT ?? join(homedir(), 'work/TCC/restore-myer');
const STORAGE_DIR = resolve(process.env.WALLY_STORAGE_DIR ?? './storage');
const MYER_PROJECT_ID = 'seed-project-myer';
const CAMPAIGN_KEY = 'MSP2-2026';

// ReStore categories that are NOT real fixtures:
//   - "Additional Photos *" are catch-all ReStore photo buckets.
//   - "The Custom Chef" / "The Cookshop" name the two CONCESSION STORES inside a
//     Myer, not fixtures. Each becomes its own Store (see seed.ts); the floor map
//     belongs to the store, so these never appear as tiles on it.
const EXCLUDE_CATEGORIES = new Set([
  'Additional Photos 1',
  'Additional Photos 2',
  'The Custom Chef',
  'The Cookshop',
]);

// Which concession store(s) a fixture category belongs to. Anything not listed
// here is SHARED merchandising that both stores execute, so it is laid on BOTH
// floor maps (a separate per-store capture each).
const CC_ONLY = new Set([
  'Gadget Freestanders',
  'The Custom Chef Bulk Stack',
  'The Custom Chef Freestanders',
]);
const CS_ONLY = new Set(['The Cookshop Bulk Stack']);
type Dept = 'cc' | 'cs';
/** Concession store(s) a category is laid onto. */
function deptsFor(cat: string): Dept[] {
  if (CC_ONLY.has(cat)) return ['cc'];
  if (CS_ONLY.has(cat)) return ['cs'];
  return ['cc', 'cs']; // shared — both stores
}

// The original demo planogram (authored in seed.ts) lives on a different set of
// fixtures — VM TABLE 1/2/3, COOKSET BULKSTACK, FRY WALL BAY 01, ELECTRICAL
// STAND 1 — none of which exist in the real ReStore taxonomy. This import
// re-points every Myer placement at the real fixtures below, so unless the
// merchandise moves with them the Sales Log (placements ⋈ guide-fixtures by
// fixtureId) renders empty for every Myer store. Re-home each legacy fixture's
// products onto the real category that replaces it. There is no canonical map
// in the data (the categories are a different real-world taxonomy, not renames);
// this mapping was confirmed with the owner. Keys are seed.ts fixture names;
// values are ReStore category names (== the real fixture names imported below).
const LEGACY_MERCH_MAP: Array<[string, string]> = [
  ['VM TABLE 1', 'Vm Table'], // Le Connoisseur
  ['VM TABLE 2', 'Display Tables'], // NOOK
  ['VM TABLE 3', 'Display Tables'], // iD3 cookset / loose
  ['COOKSET BULKSTACK', 'The Cookshop Bulk Stack'], // boxed cooksets
  ['FRY WALL BAY 01', 'The Cookshop Bulk Stack'], // fry-pan wall (no Cook Shop bay in the new plan)
  ['ELECTRICAL STAND 1', 'Appliance Stand 1'], // appliances
];

// Load apps/api/.env so DATABASE_URL is present (same mechanism as seed.ts).
const __envPath = join(__dirname, '..', '.env');
if (
  !process.env.DATABASE_URL &&
  existsSync(__envPath) &&
  typeof process.loadEnvFile === 'function'
) {
  process.loadEnvFile(__envPath);
}
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (copy apps/api/.env.example).`);
  return v;
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: requireEnv('DATABASE_URL') }),
});

// Mirror the download's filename sanitiser so we can find each photo on disk.
const safe = (x: string): string =>
  (x || 'unknown').replace(/[^A-Za-z0-9 ._-]/g, '').trim() || 'unknown';
// Normalise a store name for matching ("Adelaide City Myer" ~ "Adelaide City").
const norm = (x: string): string =>
  (x || '')
    .toLowerCase()
    .replace(/\bmyer\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Heuristic fixture kind from the ReStore category name. */
function kindOf(cat: string): string {
  const c = cat.toLowerCase();
  if (c.includes('table')) return 'table';
  if (c.includes('window')) return 'window';
  if (c.includes('dais')) return 'dais';
  if (c.includes('trolley')) return 'trolley';
  if (c.includes('cookshop') || c.includes('custom chef')) {
    return c.includes('bulk') ? 'stand' : 'bay';
  }
  return 'stand';
}
// The concession is now carried by the STORE, so a fixture's `department` is set
// only for genuinely single-concession fixtures and left null for shared ones
// (which live on both stores' floor maps).
const DEPT_LABEL: Record<Dept, string> = { cc: 'The Custom Chef', cs: 'The Cook Shop' };
function deptOf(cat: string): string | null {
  const depts = deptsFor(cat);
  return depts.length === 1 ? DEPT_LABEL[depts[0]] : null;
}

// Split-store name parsing. seed.ts names each concession store
// "<Location> — The Custom Chef" / "<Location> — The Cookshop".
const STORE_SUFFIX_RE = /\s*[—–-]\s*the (custom chef|cookshop)\s*$/i;
function deptOfStore(name: string): Dept | null {
  const m = name.match(STORE_SUFFIX_RE);
  return m ? (/custom chef/i.test(m[1]) ? 'cc' : 'cs') : null;
}
/** The Myer location key (normalised, concession suffix stripped) for matching. */
function locKeyOfStore(name: string): string {
  return norm(name.replace(STORE_SUFFIX_RE, ''));
}

interface Photo {
  mediaId: number;
  subject: string | null;
  fileName: string | null;
  createdAt: string | null;
  thumbnailUrl: string | null;
  fullUrl: string | null;
}
interface Manifest {
  stores: Record<
    string,
    { storeNumber: string | number | null; fixtures: Record<string, Photo[]> }
  >;
}

/** Copy a local image into StorageService's dir under a fresh key; return key. */
async function storeImage(absPath: string): Promise<string | null> {
  if (!existsSync(absPath)) return null;
  const key = `examples/restore/${randomBytes(12).toString('hex')}.jpg`;
  const dest = join(STORAGE_DIR, key);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, readFileSync(absPath));
  return key;
}

/**
 * Re-home the legacy demo planogram onto the real ReStore fixtures created by
 * this import (see LEGACY_MERCH_MAP). Idempotent: once moved, the source
 * fixtures hold no merchandise so subsequent runs are no-ops, and existing
 * merchandise already on the real fixtures is never disturbed (we only read the
 * legacy sources). When two legacy fixtures map to the same target (VM TABLE
 * 2 + 3 → Display Tables) a product appearing on both is kept once.
 *
 * @param guideFixtureByCat real category name → its guide-fixture id (built in
 *   section 2). A mapping whose target wasn't imported this run is skipped.
 */
async function remapLegacyMerch(
  orgId: string,
  campaignId: string,
  guideFixtureByCat: Map<string, string>,
): Promise<void> {
  let moved = 0;
  let dropped = 0;
  const seenByTarget = new Map<string, Set<string>>();
  for (const [fromName, toCat] of LEGACY_MERCH_MAP) {
    const toGf = guideFixtureByCat.get(toCat);
    if (!toGf) continue; // target category not present in this import

    const fromFixture = await prisma.fixture.findFirst({
      where: { orgId, name: fromName },
      select: { id: true },
    });
    if (!fromFixture) continue;
    const fromGf = await prisma.guideFixture.findUnique({
      where: { campaignId_fixtureId: { campaignId, fixtureId: fromFixture.id } },
      select: { id: true },
    });
    if (!fromGf) continue;

    // Products already on the target (pre-existing or moved earlier this run)
    // must not be duplicated.
    let seen = seenByTarget.get(toGf);
    if (!seen) {
      const existing = await prisma.merchandise.findMany({
        where: { guideFixtureId: toGf },
        select: { productId: true },
      });
      seen = new Set(existing.map((m) => m.productId));
      seenByTarget.set(toGf, seen);
    }

    const rows = await prisma.merchandise.findMany({
      where: { guideFixtureId: fromGf.id },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, productId: true },
    });
    for (const m of rows) {
      if (seen.has(m.productId)) {
        await prisma.merchandise.delete({ where: { id: m.id } });
        dropped++;
        continue;
      }
      seen.add(m.productId);
      await prisma.merchandise.update({
        where: { id: m.id },
        data: { guideFixtureId: toGf, order: seen.size - 1 },
      });
      moved++;
    }
  }
  console.log(
    `  planogram: re-homed ${moved} merchandise rows onto real fixtures` +
      (dropped ? ` · ${dropped} duplicate(s) dropped` : ''),
  );
}

async function main(): Promise<void> {
  const manifestPath = join(EXPORT_DIR, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`No export at ${manifestPath}. Run the ReStore scrape first.`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  const storeNames = Object.keys(manifest.stores);
  console.log(`ReStore import — ${storeNames.length} stores from ${EXPORT_DIR}`);

  // Resolve the Myer project + its org + guide campaign.
  const project = await prisma.project.findFirst({
    where: { id: MYER_PROJECT_ID },
    select: { id: true, orgId: true },
  });
  if (!project) throw new Error('Myer project not found — run the main seed first.');
  const orgId = project.orgId;
  const campaign = await prisma.campaign.findFirst({
    where: { orgId, key: CAMPAIGN_KEY },
    select: { id: true },
  });
  if (!campaign) throw new Error(`Campaign ${CAMPAIGN_KEY} not found.`);

  // ── 1. Real store numbers on the matching Myer stores ──────────────────────
  // Each Myer LOCATION is two stores now (The Custom Chef + The Cookshop), so a
  // manifest location resolves to a {cc, cs} pair and the store number lands on
  // both as "<num>-CC" / "<num>-CS".
  const dbStores = await prisma.store.findMany({
    where: { orgId, projectId: MYER_PROJECT_ID },
    select: { id: true, name: true },
  });
  const storesByLoc = new Map<string, { cc?: string; cs?: string }>();
  for (const s of dbStores) {
    const d = deptOfStore(s.name);
    if (!d) continue;
    const slot = storesByLoc.get(locKeyOfStore(s.name)) ?? {};
    slot[d] = s.id;
    storesByLoc.set(locKeyOfStore(s.name), slot);
  }
  const REF_SUFFIX: Record<Dept, string> = { cc: 'CC', cs: 'CS' };
  let numbered = 0;
  const unmatched: string[] = [];
  for (const name of storeNames) {
    const num = manifest.stores[name].storeNumber;
    const slot = storesByLoc.get(norm(name));
    if (!slot) {
      unmatched.push(name);
      continue;
    }
    if (num == null) continue;
    for (const d of ['cc', 'cs'] as const) {
      const id = slot[d];
      if (!id) continue;
      await prisma.store.update({
        where: { id },
        data: { externalRef: `${num}-${REF_SUFFIX[d]}` },
      });
      numbered++;
    }
  }
  console.log(
    `  stores: set ${numbered} real store numbers across ${storesByLoc.size} locations` +
      (unmatched.length ? ` · unmatched (skipped): ${unmatched.join(', ')}` : ''),
  );

  // Remove any previously-imported non-fixture categories — the "Additional
  // Photos" buckets and the "The Custom Chef" / "The Cookshop" tiles (those are
  // stores, not fixtures). Deleting the fixture cascades to its guide sheet,
  // gallery, placements and captures.
  const purged = await prisma.fixture.deleteMany({
    where: { orgId, name: { in: [...EXCLUDE_CATEGORIES] } },
  });
  if (purged.count) console.log(`  purged ${purged.count} non-fixture categories (buckets + store tiles)`);

  // ── 2. The real fixture categories → library fixtures + guide sheets ───────
  const categories = new Set<string>();
  for (const name of storeNames) {
    for (const cat of Object.keys(manifest.stores[name].fixtures)) {
      if (!EXCLUDE_CATEGORIES.has(cat)) categories.add(cat);
    }
  }
  const guideFixtureByCat = new Map<string, string>();
  const fixtureIdByCat = new Map<string, string>();
  const cats = [...categories].sort();
  let order = 100; // after the existing guide fixtures
  for (const cat of cats) {
    const fixture = await prisma.fixture.upsert({
      where: { orgId_name: { orgId, name: cat } },
      update: { kind: kindOf(cat), department: deptOf(cat), projectId: MYER_PROJECT_ID },
      create: {
        orgId,
        name: cat,
        kind: kindOf(cat),
        department: deptOf(cat),
        projectId: MYER_PROJECT_ID,
      },
    });
    fixtureIdByCat.set(cat, fixture.id);
    const gf = await prisma.guideFixture.upsert({
      where: { campaignId_fixtureId: { campaignId: campaign.id, fixtureId: fixture.id } },
      update: {},
      create: { orgId, campaignId: campaign.id, fixtureId: fixture.id, order: order++ },
    });
    guideFixtureByCat.set(cat, gf.id);
  }
  console.log(`  fixtures: ${categories.size} real categories as guide fixtures`);

  // ── 2b. Lay each fixture onto the floor map of the store(s) that own it ─────
  // A concession store only shows its own fixtures: The Custom Chef gets the CC
  // fixtures + shared merchandising; The Cookshop gets the CS fixtures + shared.
  // Each store re-grids its own subset on a 1000×640 canvas, 4 across.
  let placed = 0;
  let storesPlaced = 0;
  for (const s of dbStores) {
    await prisma.placement.deleteMany({
      where: { storeId: s.id, campaignId: campaign.id },
    });
    const d = deptOfStore(s.name);
    if (!d) continue; // not a split concession store — leave it empty
    const storeCats = cats.filter((cat) => deptsFor(cat).includes(d));
    // A believable department layout (perimeter bays + islands + entrance-
    // flanking tables) instead of a uniform grid — see floor-layout.ts.
    const slots = layoutFor(storeCats.length);
    for (let i = 0; i < storeCats.length; i++) {
      const cat = storeCats[i];
      const slot = slots[i]!;
      await prisma.placement.create({
        data: {
          orgId,
          storeId: s.id,
          campaignId: campaign.id,
          fixtureId: fixtureIdByCat.get(cat)!,
          label: cat,
          x: slot.x,
          y: slot.y,
          w: slot.w,
          h: slot.h,
          rotation: slot.rotation ?? 0,
          order: i,
        },
      });
      placed++;
    }
    storesPlaced++;
  }
  console.log(`  floor plans: ${placed} placements across ${storesPlaced} concession stores`);

  // ── 2c. Re-home the legacy demo planogram onto the real fixtures ───────────
  // The placements above now point at the real categories; move the seed.ts
  // merchandise with them so the Sales Log isn't empty.
  await remapLegacyMerch(orgId, campaign.id, guideFixtureByCat);

  // ── 3. ONE guide reference per fixture + per-store CAPTURES ────────────────
  // The guide's "what good looks like" is the shared STANDARD, so it gets a
  // single clean reference (not every store). Each store's own photo becomes
  // its FixtureCapture — so a store's floor map shows only THAT store's photo.
  let refs = 0;
  let captures = 0;
  let missing = 0;
  for (const cat of categories) {
    const gfId = guideFixtureByCat.get(cat)!;
    const fixtureId = fixtureIdByCat.get(cat)!;
    await prisma.exampleImage.deleteMany({ where: { guideFixtureId: gfId } });

    let best: { store: string; date: string; file: string } | null = null;
    for (const storeName of storeNames) {
      const photos = manifest.stores[storeName].fixtures[cat];
      if (!photos || photos.length === 0) continue;
      const newest = [...photos].sort((a, b) =>
        (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
      )[0];
      const date = newest?.createdAt ? newest.createdAt.slice(0, 10) : '';
      const file = join(EXPORT_DIR, safe(storeName), `${safe(cat)}.jpg`);
      if (!best || date > best.date) best = { store: storeName, date, file };

      // Per-store capture — route to the concession store(s) that own this cat.
      // A shared fixture's photo lands on BOTH stores of the location.
      const slot = storesByLoc.get(norm(storeName));
      if (!slot) continue;
      const targetIds = deptsFor(cat)
        .map((d) => slot[d])
        .filter((id): id is string => Boolean(id));
      if (targetIds.length === 0) continue;
      const key = await storeImage(file);
      if (!key) {
        missing++;
        continue;
      }
      const uploadedAt = newest?.createdAt ? new Date(newest.createdAt) : new Date();
      for (const sid of targetIds) {
        await prisma.fixtureCapture.upsert({
          where: {
            storeId_campaignId_fixtureId: { storeId: sid, campaignId: campaign.id, fixtureId },
          },
          update: { storageKey: key, needsPhoto: false, uploadedAt },
          create: {
            orgId,
            storeId: sid,
            campaignId: campaign.id,
            fixtureId,
            storageKey: key,
            needsPhoto: false,
            uploadedAt,
          },
        });
        captures++;
      }
    }

    // The single guide reference (newest execution across stores).
    if (best) {
      const rkey = await storeImage(best.file);
      if (rkey) {
        await prisma.exampleImage.create({
          data: {
            orgId,
            guideFixtureId: gfId,
            storageKey: rkey,
            caption: `Reference · ${best.store} · ${best.date}`,
            bestInClass: true,
          },
        });
        refs++;
      }
    }
  }
  console.log(
    `  guide references: ${refs} (one per fixture) · per-store captures: ${captures}` +
      (missing ? ` · ${missing} files missing on disk` : ''),
  );
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error('ReStore import failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
