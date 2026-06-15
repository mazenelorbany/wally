// =============================================================================
// seed-reference-images — attach a real "what good looks like" reference photo
// to every Myer guide fixture that doesn't have one yet.
//
// The base seed (seed.ts) only ships a reference image on TCC WALL BAY 1, so the
// other 30 guide fixtures render "No reference image set" in the guide studio.
// This fills the gap with REAL Myer fixture photos curated from the ReStore
// export: one distinct store's photo per fixture (see seed-poc/reference,
// produced by tools/build-refs). Each fixture maps to a real ReStore category;
// the baked manifest.json carries the per-fixture file + caption.
//
// Non-destructive + idempotent: a guide fixture that ALREADY has an example
// image is skipped (so WALL BAY 1's curated directives survive, and re-runs are
// no-ops). Photos are copied into StorageService's dir the same way seed.ts
// does, so the API serves them by signed token with no extra wiring.
//
// Runs as part of the start command, AFTER seed.ts, where the Railway volume is
// mounted (volumes are NOT mounted during pre-deploy). Local:
//   pnpm --filter @wally/api exec tsx prisma/seed-reference-images.ts
// =============================================================================

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

// Reference photos live under the baked POC root (same dir as rubrics/samples).
const POC_ROOT = process.env.WALLY_POC_ROOT ?? '/Users/mazen/work/TCC/wally-poc';
const REFERENCE_DIR = join(POC_ROOT, 'reference');
const STORAGE_DIR = resolve(process.env.WALLY_STORAGE_DIR ?? './storage');
const CAMPAIGN_KEY = 'MSP2-2026';
const ORG_SLUG = 'grb';

// Load apps/api/.env (mirrors seed.ts) unless DATABASE_URL is already exported.
const __envPath = join(__dirname, '..', '.env');
if (!process.env.DATABASE_URL && existsSync(__envPath) && typeof process.loadEnvFile === 'function') {
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

interface RefEntry {
  fixture: string;
  file: string;
  caption: string;
}

/** Copy a baked reference jpg into StorageService's dir under a fresh key. */
async function storeReference(absPath: string): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  const id = randomBytes(16).toString('hex');
  const key = `examples/${day}/${id}.jpg`;
  const dest = join(STORAGE_DIR, key);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, readFileSync(absPath));
  return key;
}

async function main(): Promise<void> {
  const manifestPath = join(REFERENCE_DIR, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.warn(`[refs] no reference manifest at ${manifestPath} — skipping.`);
    return;
  }
  const entries = JSON.parse(readFileSync(manifestPath, 'utf8')) as RefEntry[];
  const byFixture = new Map(entries.map((e) => [e.fixture, e]));

  const org = await prisma.org.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) {
    console.warn(`[refs] org "${ORG_SLUG}" not found — run seed.ts first. Skipping.`);
    return;
  }
  const campaign = await prisma.campaign.findUnique({
    where: { orgId_key: { orgId: org.id, key: CAMPAIGN_KEY } },
  });
  if (!campaign) {
    console.warn(`[refs] campaign "${CAMPAIGN_KEY}" not found — skipping.`);
    return;
  }

  // Iterate the manifest (keyed by fixture NAME), not existing GuideFixture rows
  // — the base seed only authors 7 sheets; the other placed fixtures get a sheet
  // lazily when first opened in the UI (ensureGuideFixture). We mirror that:
  // resolve the library fixture by name, upsert its sheet for this campaign, then
  // attach the reference image when the sheet has none yet.
  let added = 0;
  let skippedHasImage = 0;
  let noFixture = 0;
  let missingFile = 0;
  for (const entry of entries) {
    const fixture = await prisma.fixture.findUnique({
      where: { orgId_name: { orgId: org.id, name: entry.fixture } },
      select: { id: true },
    });
    if (!fixture) {
      noFixture++;
      continue;
    }

    const gf = await prisma.guideFixture.upsert({
      where: { campaignId_fixtureId: { campaignId: campaign.id, fixtureId: fixture.id } },
      update: {},
      create: { orgId: org.id, campaignId: campaign.id, fixtureId: fixture.id },
      select: { id: true, _count: { select: { exampleImages: true } } },
    });
    if (gf._count.exampleImages > 0) {
      skippedHasImage++;
      continue; // preserve existing curated examples; keeps re-runs idempotent
    }

    const abs = join(REFERENCE_DIR, entry.file);
    if (!existsSync(abs)) {
      console.warn(`[refs] photo missing on disk, skipping: ${entry.file}`);
      missingFile++;
      continue;
    }
    const storageKey = await storeReference(abs);
    await prisma.exampleImage.create({
      data: {
        orgId: org.id,
        guideFixtureId: gf.id,
        storageKey,
        caption: entry.caption,
        bestInClass: true,
      },
    });
    added++;
  }

  console.log(
    `[refs] reference images: +${added} added, ${skippedHasImage} already had one, ` +
      `${noFixture} fixture-name unmatched, ${missingFile} file missing.`,
  );
}

main()
  .catch((err) => {
    console.error('[refs] seed-reference-images failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
