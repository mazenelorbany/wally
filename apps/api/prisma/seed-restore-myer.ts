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

// ── locations ───────────────────────────────────────────────────────────────
const EXPORT_DIR =
  process.env.RESTORE_EXPORT ?? join(homedir(), 'work/TCC/restore-myer');
const STORAGE_DIR = resolve(process.env.WALLY_STORAGE_DIR ?? './storage');
const MYER_PROJECT_ID = 'seed-project-myer';
const CAMPAIGN_KEY = 'MSP2-2026';

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
/** Myer department from the category. */
function deptOf(cat: string): string {
  const c = cat.toLowerCase();
  return c.includes('custom chef') || c.includes('gadget')
    ? 'The Custom Chef'
    : 'The Cook Shop';
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
  const dbStores = await prisma.store.findMany({
    where: { orgId, projectId: MYER_PROJECT_ID },
    select: { id: true, name: true },
  });
  const byNorm = new Map(dbStores.map((s) => [norm(s.name), s.id]));
  let numbered = 0;
  const unmatched: string[] = [];
  for (const name of storeNames) {
    const num = manifest.stores[name].storeNumber;
    const id = byNorm.get(norm(name));
    if (id && num != null) {
      await prisma.store.update({
        where: { id },
        data: { externalRef: String(num) },
      });
      numbered++;
    } else if (!id) {
      unmatched.push(name);
    }
  }
  console.log(
    `  stores: set ${numbered} real store numbers` +
      (unmatched.length ? ` · unmatched (skipped): ${unmatched.join(', ')}` : ''),
  );

  // ── 2. The 16 real fixture categories → library fixtures + guide sheets ────
  const categories = new Set<string>();
  for (const name of storeNames) {
    for (const cat of Object.keys(manifest.stores[name].fixtures)) categories.add(cat);
  }
  const guideFixtureByCat = new Map<string, string>();
  const fixtureIdByCat = new Map<string, string>();
  const cats = [...categories].sort();
  let order = 100; // after the existing guide fixtures
  for (const cat of cats) {
    const fixture = await prisma.fixture.upsert({
      where: { orgId_name: { orgId, name: cat } },
      update: { kind: kindOf(cat), department: deptOf(cat) },
      create: { orgId, name: cat, kind: kindOf(cat), department: deptOf(cat) },
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

  // ── 2b. Lay the real fixtures onto every Myer store's floor plan ───────────
  // Replace the fabricated layout with the REAL 16-fixture taxonomy in a clean
  // grid, so each store's floor map shows its real fixtures (and clicking one
  // opens the guide sheet + real photo gallery). 1000×640 canvas, 4×4 grid.
  const grid = cats.map((cat, i) => ({
    cat,
    x: 30 + (i % 4) * 240,
    y: 30 + Math.floor(i / 4) * 152,
    w: 200,
    h: 120,
  }));
  let placed = 0;
  for (const s of dbStores) {
    await prisma.placement.deleteMany({
      where: { storeId: s.id, campaignId: campaign.id },
    });
    for (let i = 0; i < grid.length; i++) {
      const g = grid[i];
      await prisma.placement.create({
        data: {
          orgId,
          storeId: s.id,
          campaignId: campaign.id,
          fixtureId: fixtureIdByCat.get(g.cat)!,
          label: g.cat,
          x: g.x,
          y: g.y,
          w: g.w,
          h: g.h,
          order: i,
        },
      });
      placed++;
    }
  }
  console.log(`  floor plans: ${placed} placements across ${dbStores.length} stores`);

  // ── 3. Per-fixture reference gallery from each store's newest photo ─────────
  let images = 0;
  let missing = 0;
  for (const cat of categories) {
    const gfId = guideFixtureByCat.get(cat)!;
    // idempotent: clear this restore fixture's gallery, then rebuild.
    await prisma.exampleImage.deleteMany({ where: { guideFixtureId: gfId } });
    let first = true;
    for (const storeName of storeNames) {
      const photos = manifest.stores[storeName].fixtures[cat];
      if (!photos || photos.length === 0) continue;
      // newest by createdAt (the downloaded file IS the newest per store x cat).
      const file = join(EXPORT_DIR, safe(storeName), `${safe(cat)}.jpg`);
      const key = await storeImage(file);
      if (!key) {
        missing++;
        continue;
      }
      const newest = [...photos].sort((a, b) =>
        (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
      )[0];
      const date = newest?.createdAt ? newest.createdAt.slice(0, 10) : '';
      await prisma.exampleImage.create({
        data: {
          orgId,
          guideFixtureId: gfId,
          storageKey: key,
          caption: `${storeName}${date ? ` · ${date}` : ''}`,
          bestInClass: first,
        },
      });
      images++;
      first = false;
    }
  }
  console.log(
    `  reference photos: ${images} attached across ${categories.size} fixtures` +
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
