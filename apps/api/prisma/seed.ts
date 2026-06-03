// =============================================================================
// Wally seed — a realistic GRB org so the review console has data on first run.
// =============================================================================
//
// Run from apps/api:   pnpm db:seed   (== tsx prisma/seed.ts)
//
// What it builds (idempotent — safe to re-run; upserts on natural keys):
//   - Org "GRB" (Globe Retail Brands — the retailer Wally audits for TCC).
//   - One ADMIN + one REVIEWER user.
//   - Campaign "MSP2-2026" (Myer Stocktake Sale P2), status ACTIVE.
//   - The REAL rubrics, parsed straight out of the POC YAML
//     (wally-poc/rubrics/<fixture>.MSP2-2026.v1.yaml) as append-only v1 rows.
//     One source of truth for "what good looks like" — the eval harness reads
//     the same files.
//   - 7 real stores, each with StoreFixture applicability rows: storefront
//     applicable everywhere; vm_table 1/2 a per-store mix of applicable /
//     not-applicable / (one store) not-built-yet; doorbuster applicable.
//   - A few Submissions + Photos pointing at sample images copied into the
//     StorageService so the queue isn't empty. We DO NOT fabricate Verdicts —
//     the JobsModule worker scores the photos for real on first boot, so the
//     numbers you see are honest. (Photos are seeded UPLOADED + a PENDING
//     ScoreJob, exactly as a real upload would leave them.)
//
// SECURITY: photos may contain people. We copy the sample bytes into the
// StorageService and only ever reference them by storage key — never log bytes.
// =============================================================================

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import {
  CampaignStatus,
  PhotoStatus,
  PrismaClient,
  Role,
  SubmissionStatus,
} from '@prisma/client';
import YAML from 'yaml';

// ───────────────────────────────────────────── locations
// The POC repo is the source of truth for rubrics + sample photos (decision T1).
const POC_ROOT = process.env.WALLY_POC_ROOT ?? '/Users/mazen/work/TCC/wally-poc';
const RUBRICS_DIR = join(POC_ROOT, 'rubrics');
const SAMPLES_DIR = join(POC_ROOT, 'data', 'samples');
// Where StorageService reads/writes (mirror its key layout so the API serves
// these by signed token without any extra wiring).
const STORAGE_DIR = resolve(process.env.WALLY_STORAGE_DIR ?? './storage');

const CAMPAIGN_KEY = 'MSP2-2026';
const FIXTURES = ['storefront', 'vm_table', 'doorbuster'] as const;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: requireEnv('DATABASE_URL') }),
});

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} is not set. Copy .env.example to apps/api/.env (or export it) before seeding.`,
    );
  }
  return v;
}

// ───────────────────────────────────────────── rubric YAML → Rubric.criteria
interface RawCriterion {
  id: string;
  kind: string;
  critical?: boolean;
  text: string;
}
interface RawRubric {
  fixture: string;
  campaign: string;
  version: number;
  reference_image?: string;
  rollup?: { not_good_if_any_critical_fails?: boolean; good_if_only_noncritical_fails?: boolean };
  criteria: RawCriterion[];
}

const DEFAULT_ROLLUP = {
  not_good_if_any_critical_fails: true,
  good_if_only_noncritical_fails: true,
};

/** Read every <fixture>.<campaign>.v<N>.yaml and return the highest version per
 *  fixture. Filename version must match the in-file version (fail loudly). */
function loadRubricsFromDisk(): Map<string, RawRubric> {
  if (!existsSync(RUBRICS_DIR)) {
    throw new Error(
      `rubrics dir not found: ${RUBRICS_DIR}. Set WALLY_POC_ROOT to the wally-poc checkout.`,
    );
  }
  const latest = new Map<string, RawRubric>();
  for (const file of readdirSync(RUBRICS_DIR)) {
    const m = /^([a-z_]+)\.([A-Za-z0-9-]+)\.v(\d+)\.yaml$/.exec(file);
    if (!m) continue;
    const [, fixture, campaign, vStr] = m;
    if (campaign !== CAMPAIGN_KEY) continue;
    const raw = YAML.parse(readFileSync(join(RUBRICS_DIR, file), 'utf8')) as RawRubric;
    const fileVersion = Number(vStr);
    if (raw.version !== fileVersion) {
      throw new Error(`${file}: filename v${fileVersion} != file version v${raw.version}`);
    }
    const prev = latest.get(fixture);
    if (!prev || raw.version > prev.version) latest.set(fixture, raw);
  }
  for (const fixture of FIXTURES) {
    if (!latest.has(fixture)) {
      throw new Error(`no rubric for fixture "${fixture}" in ${RUBRICS_DIR}`);
    }
  }
  return latest;
}

/** Normalise a parsed YAML rubric into the Rubric.criteria JSON shape. */
function toCriteria(raw: RawRubric) {
  return raw.criteria.map((c) => {
    if (c.kind !== 'presence' && c.kind !== 'aesthetic') {
      throw new Error(`${raw.fixture}: criterion "${c.id}" has invalid kind "${c.kind}"`);
    }
    return {
      id: c.id,
      kind: c.kind,
      critical: Boolean(c.critical),
      text: c.text.replace(/\s+/g, ' ').trim(),
    };
  });
}

// ───────────────────────────────────────────── storage (mirror StorageService)
// StorageService keys are `${prefix}/${day}/${id}${ext}` and resolve to
// STORAGE_DIR/<key>. We reproduce that exactly so the API serves seeded photos
// with no extra plumbing.
async function storeSample(absImagePath: string): Promise<{ key: string; bytes: number }> {
  const bytes = readFileSync(absImagePath);
  const day = new Date().toISOString().slice(0, 10);
  const id = randomBytes(16).toString('hex');
  const key = `photos/${day}/${id}.png`;
  const dest = join(STORAGE_DIR, key);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, bytes);
  // NEVER log the bytes — only the key + size.
  return { key, bytes: bytes.length };
}

function sample(name: string): string | null {
  const p = join(SAMPLES_DIR, name);
  return existsSync(p) ? p : null;
}

// ───────────────────────────────────────────── the 7 real GRB stores
// brand is the concession fascia the storefront rubric grades (The Custom Chef /
// The Cook Shop, inside the host department store).
const STORES = [
  { name: 'Marion', brand: 'The Custom Chef', externalRef: 'GRB-MAR' },
  { name: 'Altona', brand: 'The Custom Chef', externalRef: 'GRB-ALT' },
  { name: 'Ballina', brand: 'The Cook Shop', externalRef: 'GRB-BAL' },
  { name: 'Burleigh', brand: 'The Custom Chef', externalRef: 'GRB-BUR' },
  { name: 'Cairns Central', brand: 'The Custom Chef', externalRef: 'GRB-CNS' },
  { name: 'Carousel', brand: 'The Cook Shop', externalRef: 'GRB-CAR' },
  { name: 'Chad Pav', brand: 'The Custom Chef', externalRef: 'GRB-CHP' },
] as const;

// Per-store fixture applicability. Range assignment differs by store, so VM
// tables are a deliberate mix — applicable, not-applicable ("we don't have that
// table"), and one store where the table IS applicable but no photo was
// submitted (a "missing" gap, exercised via the Submissions below).
//
// shape: storeName -> [{ fixtureKey, label, applicable, order }]
function fixturesFor(storeName: string) {
  const rows = [
    { fixtureKey: 'storefront', label: 'Storefront', applicable: true, order: 0 },
    { fixtureKey: 'vm_table', label: 'VM Table 1 · Le Connoisseur', applicable: true, order: 1 },
    { fixtureKey: 'doorbuster', label: 'Store-Entry Door Buster Stack', applicable: true, order: 3 },
  ];
  // A second VM table that not every store carries.
  const carriesTable2 = !['Ballina', 'Carousel'].includes(storeName);
  rows.splice(2, 0, {
    fixtureKey: 'vm_table',
    label: 'VM Table 2 · Nook',
    applicable: carriesTable2,
    order: 2,
  });
  return rows;
}

// ───────────────────────────────────────────── main
async function main(): Promise<void> {
  console.log('Seeding Wally (GRB / MSP2-2026)…');

  // --- Org -----------------------------------------------------------------
  const org = await prisma.org.upsert({
    where: { slug: 'grb' },
    update: { name: 'Globe Retail Brands' },
    create: { name: 'Globe Retail Brands', slug: 'grb' },
  });
  console.log(`  org: ${org.name} (${org.id})`);

  // --- Users ---------------------------------------------------------------
  const admin = await prisma.user.upsert({
    where: { email: 'admin@grb.test' },
    update: { orgId: org.id, role: Role.ADMIN, name: 'GRB Admin' },
    create: { orgId: org.id, email: 'admin@grb.test', name: 'GRB Admin', role: Role.ADMIN },
  });
  const reviewer = await prisma.user.upsert({
    where: { email: 'reviewer@grb.test' },
    update: { orgId: org.id, role: Role.REVIEWER, name: 'VM Reviewer' },
    create: {
      orgId: org.id,
      email: 'reviewer@grb.test',
      name: 'VM Reviewer',
      role: Role.REVIEWER,
    },
  });
  console.log(`  users: ${admin.email} (ADMIN), ${reviewer.email} (REVIEWER)`);

  // --- Campaign ------------------------------------------------------------
  const campaign = await prisma.campaign.upsert({
    where: { orgId_key: { orgId: org.id, key: CAMPAIGN_KEY } },
    update: { status: CampaignStatus.ACTIVE, name: 'Myer Stocktake Sale P2' },
    create: {
      orgId: org.id,
      key: CAMPAIGN_KEY,
      name: 'Myer Stocktake Sale P2',
      status: CampaignStatus.ACTIVE,
      startsAt: new Date('2026-06-01T00:00:00Z'),
      endsAt: new Date('2026-07-06T23:59:59Z'),
    },
  });
  console.log(`  campaign: ${campaign.key} (${campaign.status})`);

  // --- Rubrics (real YAML → append-only v1 rows) ---------------------------
  const rawRubrics = loadRubricsFromDisk();
  const rubricByFixture = new Map<string, { id: string; version: number }>();
  for (const fixture of FIXTURES) {
    const raw = rawRubrics.get(fixture)!;
    const criteria = toCriteria(raw);
    const rubric = await prisma.rubric.upsert({
      where: {
        campaignId_fixtureKey_version: {
          campaignId: campaign.id,
          fixtureKey: fixture,
          version: raw.version,
        },
      },
      update: {
        criteria,
        rollupRule: { ...DEFAULT_ROLLUP, ...(raw.rollup ?? {}) },
        referenceKey: raw.reference_image ?? null,
      },
      create: {
        orgId: org.id,
        campaignId: campaign.id,
        fixtureKey: fixture,
        version: raw.version,
        criteria,
        rollupRule: { ...DEFAULT_ROLLUP, ...(raw.rollup ?? {}) },
        referenceKey: raw.reference_image ?? null,
      },
    });
    rubricByFixture.set(fixture, { id: rubric.id, version: rubric.version });
    console.log(
      `  rubric: ${fixture}.${CAMPAIGN_KEY}.v${raw.version} (${criteria.length} criteria)`,
    );
  }

  // --- Stores + StoreFixtures ---------------------------------------------
  const stores: { id: string; name: string }[] = [];
  for (const s of STORES) {
    const store = await prisma.store.upsert({
      where: { id: `seed-store-${s.externalRef}` },
      update: { name: s.name, brand: s.brand, externalRef: s.externalRef, orgId: org.id },
      create: {
        id: `seed-store-${s.externalRef}`,
        orgId: org.id,
        name: s.name,
        brand: s.brand,
        externalRef: s.externalRef,
      },
    });
    stores.push({ id: store.id, name: store.name });
    for (const f of fixturesFor(s.name)) {
      await prisma.storeFixture.upsert({
        where: {
          storeId_campaignId_fixtureKey: {
            storeId: store.id,
            campaignId: campaign.id,
            fixtureKey: f.fixtureKey,
          },
        },
        update: { label: f.label, applicable: f.applicable, order: f.order },
        create: {
          storeId: store.id,
          campaignId: campaign.id,
          fixtureKey: f.fixtureKey,
          label: f.label,
          applicable: f.applicable,
          order: f.order,
        },
      });
    }
  }
  console.log(`  stores: ${stores.map((s) => s.name).join(', ')}`);

  // --- Submissions + Photos (real bytes into storage, PENDING ScoreJobs) ----
  // We seed a handful so the queue + console aren't empty on first boot. The
  // worker scores them for real — we never fabricate a Verdict.
  //
  // Plan (exercises every store-rollup branch the console renders):
  //   Marion  — storefront + door buster submitted (two photos to score)
  //   Altona  — storefront only (one scored fixture; the rest "not submitted")
  //   Ballina — storefront submitted; this store has no VM Table 2 (n/a row)
  const seedPlan: {
    store: string;
    status: SubmissionStatus;
    photos: { fixtureKey: string; image: string }[];
  }[] = [
    {
      store: 'Marion',
      status: SubmissionStatus.SUBMITTED,
      photos: [
        { fixtureKey: 'storefront', image: 'msp2img-01.png' },
        { fixtureKey: 'doorbuster', image: 'msp2img-06.png' },
      ],
    },
    {
      store: 'Altona',
      status: SubmissionStatus.PARTIAL,
      photos: [{ fixtureKey: 'storefront', image: 'msp2img-05.png' }],
    },
    {
      store: 'Ballina',
      status: SubmissionStatus.SUBMITTED,
      photos: [{ fixtureKey: 'storefront', image: 'msp2img-03.png' }],
    },
  ];

  let photoCount = 0;
  let skipped = 0;
  for (const plan of seedPlan) {
    const store = stores.find((s) => s.name === plan.store);
    if (!store) continue;

    const submission = await prisma.submission.upsert({
      where: { storeId_campaignId: { storeId: store.id, campaignId: campaign.id } },
      update: {
        status: plan.status,
        submittedAt: plan.status === SubmissionStatus.SUBMITTED ? new Date() : null,
      },
      create: {
        orgId: org.id,
        storeId: store.id,
        campaignId: campaign.id,
        status: plan.status,
        submittedAt: plan.status === SubmissionStatus.SUBMITTED ? new Date() : null,
      },
    });

    // Re-seeding: clear prior seeded photos for this submission so we don't pile
    // up duplicate jobs. (Photo→ScoreJob/Verdict cascade on delete.)
    await prisma.photo.deleteMany({ where: { submissionId: submission.id } });

    for (const p of plan.photos) {
      const abs = sample(p.image);
      if (!abs) {
        console.warn(`  ! sample missing, skipping: ${p.image}`);
        skipped++;
        continue;
      }
      const { key, bytes } = await storeSample(abs);
      const photo = await prisma.photo.create({
        data: {
          submissionId: submission.id,
          fixtureKey: p.fixtureKey,
          storageKey: key,
          status: PhotoStatus.UPLOADED,
        },
      });
      // The durable queue picks this up (status PENDING, runAfter now).
      await prisma.scoreJob.create({ data: { photoId: photo.id } });
      photoCount++;
      console.log(
        `  photo: ${plan.store}/${p.fixtureKey} -> ${key} (${bytes} B) [job queued]`,
      );
    }
  }

  console.log(
    `\nDone. ${stores.length} stores, ${rubricByFixture.size} rubrics, ${photoCount} photos queued${
      skipped ? `, ${skipped} samples missing` : ''
    }.`,
  );
  console.log(
    'Start the API (pnpm dev) and the JobsModule worker will score the queued photos.',
  );
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
