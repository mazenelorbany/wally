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

// tsx does not auto-load .env. Load apps/api/.env ourselves (mirrors
// prisma.config.ts), unless DATABASE_URL is already exported (CI).
const __envPath = join(__dirname, '..', '.env');
if (!process.env.DATABASE_URL && existsSync(__envPath) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(__envPath);
}

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
async function storeSample(
  absImagePath: string,
  prefix = 'photos',
): Promise<{ key: string; bytes: number }> {
  const bytes = readFileSync(absImagePath);
  const day = new Date().toISOString().slice(0, 10);
  const id = randomBytes(16).toString('hex');
  // Mirror StorageService.put exactly: `${prefix}/${day}/${id}${ext}`.
  const safePrefix = prefix.replace(/[^a-zA-Z0-9._-]/g, '');
  const key = `${safePrefix}/${day}/${id}.png`;
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
    `\nDone (compliance). ${stores.length} stores, ${rubricByFixture.size} rubrics, ${photoCount} photos queued${
      skipped ? `, ${skipped} samples missing` : ''
    }.`,
  );
  console.log(
    'Start the API (pnpm dev) and the JobsModule worker will score the queued photos.',
  );

  // --- CREATE GUIDE pillar (reuses the GRB org + MSP2-2026 campaign above) ---
  await seedCreateGuide({ orgId: org.id, campaignId: campaign.id, stores });
}

// ═══════════════════════════════════════════════════════════════════════════
// CREATE GUIDE pillar — Flagship's "build the planogram" half of VM.
// ───────────────────────────────────────────────────────────────────────────
// Reuses the GRB org + MSP2-2026 campaign seeded above and lays out:
//   - the real TCC fixture library (Fixture rows)
//   - a real TCC knife/cookware product catalog (Product rows)
//   - a floor plan for the first GRB store (Placement rows on a 1000x640 canvas)
//   - the TCC WALL BAY 1 instruction sheet (GuideFixture) with the REAL
//     knife-wall directives, ~10 knives merchandised across 2 rows, and 1–2
//     "what good looks like" example images copied into StorageService.
// Idempotent: every row upserts on its natural key, so re-running is a no-op
// beyond timestamps. SECURITY: example image bytes are referenced by key only.
// ═══════════════════════════════════════════════════════════════════════════

// The real TCC fixture library for the org. kind ∈ bay|table|stand|window|dais|trolley.
const GUIDE_FIXTURES: { name: string; kind: string }[] = [
  { name: 'TCC WALL BAY 1', kind: 'bay' },
  { name: 'TCC WALL BAY 2', kind: 'bay' },
  { name: 'TCC WALL BAY 3', kind: 'bay' },
  { name: 'TCC WALL BAY 4', kind: 'bay' },
  { name: 'TCC WALL BAY 5', kind: 'bay' },
  { name: 'TCC WALL BAY 6', kind: 'bay' },
  { name: 'TCC WALL BAY 7', kind: 'bay' },
  { name: 'COOKSET BULKSTACK', kind: 'stand' },
  { name: 'COOKWEAR SET BULK STACK', kind: 'stand' },
  { name: 'KNIFE BLOCK BULK STACK', kind: 'stand' },
  { name: 'ELECTRICAL STAND 1', kind: 'stand' },
  { name: 'ELECTRICAL STAND 2', kind: 'stand' },
  { name: 'FREE STANDER 1 (FRONT)', kind: 'stand' },
  { name: 'FREE STANDER 1 (BACK)', kind: 'stand' },
  { name: 'FREE STANDER 2 (FRONT)', kind: 'stand' },
  { name: 'FREE STANDER 2 (BACK)', kind: 'stand' },
  { name: 'FREE STANDER 3 (FRONT)', kind: 'stand' },
  { name: 'FREE STANDER 3 (BACK)', kind: 'stand' },
  { name: 'QUAD STAND 1', kind: 'stand' },
  { name: 'KA STAND 1', kind: 'stand' },
  { name: 'KA STAND 2', kind: 'stand' },
  { name: 'MINI DAIS 1', kind: 'dais' },
  { name: 'MINI DAIS 10', kind: 'dais' },
  { name: 'TROLLEY 1', kind: 'trolley' },
  { name: 'TROLLEY 2', kind: 'trolley' },
  { name: 'TROLLEY 3', kind: 'trolley' },
  { name: 'WINDOW DISPLAY', kind: 'window' },
  { name: 'FRY WALL BAY 01', kind: 'bay' },
];

// Real TCC catalog — Baccarat & Andre Verdier knives (category 'Knives').
// sku codes follow the TCC web style (epoch-ish base + dash suffix). imageUrl
// left null on purpose (the catalog feed wires real imagery later).
const GUIDE_PRODUCTS: {
  sku: string;
  name: string;
  brand: string;
  category: string;
  color?: string;
}[] = [
  { sku: '1749771144-75', name: 'Baccarat Damashiro EMPEROR Makoto 7 Piece Knife Block', brand: 'Baccarat', category: 'Knives', color: 'Black' },
  { sku: '1749771144-61', name: 'Baccarat Damashiro EMPEROR Nanashi Knife Block 6 Piece', brand: 'Baccarat', category: 'Knives', color: 'Black' },
  { sku: '1749771144-20', name: 'Baccarat Damashiro EMPEROR Bread Knife 20cm', brand: 'Baccarat', category: 'Knives', color: 'Steel' },
  { sku: '1749771144-15', name: 'Baccarat Damashiro EMPEROR Chefs Knife 15cm', brand: 'Baccarat', category: 'Knives', color: 'Steel' },
  { sku: '1749771144-21', name: 'Baccarat Damashiro EMPEROR Chefs Knife 20cm', brand: 'Baccarat', category: 'Knives', color: 'Steel' },
  { sku: '1749771144-17', name: 'Baccarat Damashiro EMPEROR Cleaver 17cm', brand: 'Baccarat', category: 'Knives', color: 'Steel' },
  { sku: '1749771144-14', name: 'Baccarat Damashiro EMPEROR All Purpose Try Me Knife 14.5cm', brand: 'Baccarat', category: 'Knives', color: 'Steel' },
  { sku: '1749771201-14', name: 'Baccarat iconiX Fullen 14 Piece Knife Block', brand: 'Baccarat', category: 'Knives', color: 'Black' },
  { sku: '1749771201-07', name: 'Baccarat iconiX Straub Knife Block 7 Piece', brand: 'Baccarat', category: 'Knives', color: 'Black' },
  { sku: '1749771201-06', name: 'Baccarat iconiX Holz Knife Block 6 Piece', brand: 'Baccarat', category: 'Knives', color: 'Wood' },
  { sku: '1749771201-31', name: 'Baccarat iconiX Carving Knife Set', brand: 'Baccarat', category: 'Knives', color: 'Steel' },
  { sku: '1749771201-20', name: 'Baccarat iconiX Sharpening Steel 20cm', brand: 'Baccarat', category: 'Knives', color: 'Steel' },
  { sku: '1749771201-17', name: 'Baccarat iconiX Carving Fork 17cm', brand: 'Baccarat', category: 'Knives', color: 'Steel' },
  { sku: '1749772050-06', name: 'Andre Verdier Debutant Set of 6 Serrated Knives Olive Wood', brand: 'Andre Verdier', category: 'Knives', color: 'Olive Wood' },
  { sku: '1749771144-10', name: 'Baccarat Damashiro Bodo 10 Piece Japanese Steel Knife Block with Chopping Board', brand: 'Baccarat', category: 'Knives', color: 'Wood' },
];

// The REAL TCC knife-wall directives (verbatim from the MSP2 guide).
const WALL_BAY_1_NOTES = [
  '1. Always display A7 sharps warning in acrylic in 2nd cabinet only on far-left side.',
  '2. All stores to use the 4 magnets displayed as shown across the top of each knife cabinet. Knives to face loose knife cabinets.',
  '3. All knife blocks on display to have white RRP A7 ticket displayed in an acrylic in front of knife block.',
  '4. When a knife block is on sale, place the sale price ticket in front of RRP ticket slipped into acrylic stand. EG Below yellow or red.',
].join('\n');

// Floor-plan layout on a ~1000x640 canvas. Wall bays = wide boxes along the top
// edge; stands/standers/trolleys/dais = mid boxes; window = tall box on the
// right; bulkstacks near the entrance (bottom-left). x,y are top-left; w,h px.
type PlacementSpec = {
  fixtureName: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  applicable?: boolean;
};

function floorPlanFor(): PlacementSpec[] {
  const specs: PlacementSpec[] = [];
  const push = (s: PlacementSpec) => specs.push(s);

  // Row of 7 wall bays along the top edge (~110x40, 10px gutter).
  const bayW = 110;
  const bayH = 40;
  const bayGap = 10;
  const bayY = 12;
  let bayX = 16;
  for (let i = 1; i <= 7; i++) {
    push({ fixtureName: `TCC WALL BAY ${i}`, label: `TCC Wall Bay ${i}`, x: bayX, y: bayY, w: bayW, h: bayH });
    bayX += bayW + bayGap;
  }
  // Fry wall bay caps the top-right run.
  push({ fixtureName: 'FRY WALL BAY 01', label: 'Fry Wall Bay 01', x: bayX, y: bayY, w: bayW, h: bayH });

  // Tall window display on the right edge.
  push({ fixtureName: 'WINDOW DISPLAY', label: 'Window Display', x: 880, y: 80, w: 100, h: 470 });

  // Mid-floor fixtures (~90x120) on a loose grid.
  const midW = 90;
  const midH = 120;
  const mid: { name: string; label: string; col: number; rowIdx: number }[] = [
    { name: 'FREE STANDER 1 (FRONT)', label: 'Free Stander 1 (Front)', col: 0, rowIdx: 0 },
    { name: 'FREE STANDER 1 (BACK)', label: 'Free Stander 1 (Back)', col: 0, rowIdx: 1 },
    { name: 'FREE STANDER 2 (FRONT)', label: 'Free Stander 2 (Front)', col: 1, rowIdx: 0 },
    { name: 'FREE STANDER 2 (BACK)', label: 'Free Stander 2 (Back)', col: 1, rowIdx: 1 },
    { name: 'FREE STANDER 3 (FRONT)', label: 'Free Stander 3 (Front)', col: 2, rowIdx: 0 },
    { name: 'FREE STANDER 3 (BACK)', label: 'Free Stander 3 (Back)', col: 2, rowIdx: 1 },
    { name: 'QUAD STAND 1', label: 'Quad Stand 1', col: 3, rowIdx: 0 },
    { name: 'KA STAND 1', label: 'KA Stand 1', col: 3, rowIdx: 1 },
    { name: 'KA STAND 2', label: 'KA Stand 2', col: 4, rowIdx: 0 },
    { name: 'ELECTRICAL STAND 1', label: 'Electrical Stand 1', col: 4, rowIdx: 1 },
    { name: 'ELECTRICAL STAND 2', label: 'Electrical Stand 2', col: 5, rowIdx: 0 },
    { name: 'MINI DAIS 1', label: 'Mini Dais 1', col: 5, rowIdx: 1 },
  ];
  const midX0 = 40;
  const midY0 = 110;
  const midColGap = 50;
  const midRowGap = 60;
  for (const m of mid) {
    push({
      fixtureName: m.name,
      label: m.label,
      x: midX0 + m.col * (midW + midColGap),
      y: midY0 + m.rowIdx * (midH + midRowGap),
      w: midW,
      h: midH,
    });
  }

  // Trolleys + the second mini dais on a lower band.
  const lowY = 400;
  push({ fixtureName: 'TROLLEY 1', label: 'Trolley 1', x: 320, y: lowY, w: 80, h: 80 });
  push({ fixtureName: 'TROLLEY 2', label: 'Trolley 2', x: 420, y: lowY, w: 80, h: 80 });
  push({ fixtureName: 'TROLLEY 3', label: 'Trolley 3', x: 520, y: lowY, w: 80, h: 80 });
  push({ fixtureName: 'MINI DAIS 10', label: 'Mini Dais 10', x: 640, y: lowY, w: 90, h: 90 });

  // Bulkstacks near the entrance (bottom-left), where shoppers enter.
  push({ fixtureName: 'COOKSET BULKSTACK', label: 'Cookset Bulkstack', x: 40, y: 510, w: 110, h: 100 });
  push({ fixtureName: 'COOKWEAR SET BULK STACK', label: 'Cookwear Set Bulk Stack', x: 170, y: 510, w: 110, h: 100 });
  push({ fixtureName: 'KNIFE BLOCK BULK STACK', label: 'Knife Block Bulk Stack', x: 300, y: 510, w: 110, h: 100 });

  // Default rotation 0 / applicable true; the caller stamps `order` by index.
  return specs.map((s) => ({ rotation: 0, applicable: true, ...s }));
}

async function seedCreateGuide(ctx: {
  orgId: string;
  campaignId: string;
  stores: { id: string; name: string }[];
}): Promise<void> {
  const { orgId, campaignId, stores } = ctx;
  console.log('\nSeeding CREATE GUIDE (fixtures · catalog · floor plan · guide)…');

  // --- Fixture library -----------------------------------------------------
  const fixtureByName = new Map<string, string>();
  for (const f of GUIDE_FIXTURES) {
    const fixture = await prisma.fixture.upsert({
      where: { orgId_name: { orgId, name: f.name } },
      update: { kind: f.kind },
      create: { orgId, name: f.name, kind: f.kind },
    });
    fixtureByName.set(f.name, fixture.id);
  }
  console.log(`  fixtures: ${GUIDE_FIXTURES.length} in library`);

  // --- Product catalog -----------------------------------------------------
  const productBySku = new Map<string, string>();
  for (const p of GUIDE_PRODUCTS) {
    const product = await prisma.product.upsert({
      where: { orgId_sku: { orgId, sku: p.sku } },
      update: { name: p.name, brand: p.brand, category: p.category, color: p.color ?? null },
      create: {
        orgId,
        sku: p.sku,
        name: p.name,
        brand: p.brand,
        category: p.category,
        color: p.color ?? null,
        imageUrl: null,
      },
    });
    productBySku.set(p.sku, product.id);
  }
  console.log(`  products: ${GUIDE_PRODUCTS.length} in catalog`);

  // --- Floor plan for the first GRB store (Marion) -------------------------
  const planStore = stores[0];
  if (!planStore) {
    console.warn('  ! no stores to place fixtures on — skipping floor plan');
    return;
  }
  const specs = floorPlanFor();
  let placed = 0;
  let order = 0;
  for (const s of specs) {
    const fixtureId = fixtureByName.get(s.fixtureName);
    if (!fixtureId) {
      console.warn(`  ! unknown fixture in plan: ${s.fixtureName}`);
      continue;
    }
    const data = {
      x: s.x,
      y: s.y,
      w: s.w,
      h: s.h,
      rotation: s.rotation ?? 0,
      applicable: s.applicable ?? true,
      label: s.label,
      order: order++,
    };
    await prisma.placement.upsert({
      where: { storeId_campaignId_fixtureId: { storeId: planStore.id, campaignId, fixtureId } },
      update: data,
      create: { orgId, storeId: planStore.id, campaignId, fixtureId, ...data },
    });
    placed++;
  }
  console.log(`  placements: ${placed} on ${planStore.name}'s floor plan (1000x640)`);

  // --- Guide sheet for TCC WALL BAY 1 (notes + merchandise + examples) ------
  const wallBay1Id = fixtureByName.get('TCC WALL BAY 1');
  if (!wallBay1Id) {
    console.warn('  ! TCC WALL BAY 1 missing — skipping guide-fixture sheet');
    return;
  }
  const guideFixture = await prisma.guideFixture.upsert({
    where: { campaignId_fixtureId: { campaignId, fixtureId: wallBay1Id } },
    update: { notes: WALL_BAY_1_NOTES, order: 0 },
    create: { orgId, campaignId, fixtureId: wallBay1Id, notes: WALL_BAY_1_NOTES, order: 0 },
  });

  // Merchandise ~10 knives across 2 rows. Re-seeding: clear prior rows for this
  // guide-fixture so we don't pile up duplicates (no natural key on Merchandise).
  await prisma.merchandise.deleteMany({ where: { guideFixtureId: guideFixture.id } });
  const merchPlan: { row: string; skus: string[] }[] = [
    {
      row: 'Top rack',
      skus: ['1749771144-75', '1749771144-61', '1749771201-14', '1749771201-07', '1749771201-06', '1749771144-10'],
    },
    {
      row: 'New row',
      skus: ['1749771144-20', '1749771144-15', '1749771144-21', '1749771144-17', '1749771201-31', '1749772050-06'],
    },
  ];
  let merchCount = 0;
  for (const block of merchPlan) {
    let order = 0;
    for (const sku of block.skus) {
      const productId = productBySku.get(sku);
      if (!productId) {
        console.warn(`  ! merchandise sku not in catalog: ${sku}`);
        continue;
      }
      await prisma.merchandise.create({
        data: { orgId, guideFixtureId: guideFixture.id, productId, row: block.row, order: order++ },
      });
      merchCount++;
    }
  }

  // Example "what good looks like" images. Copy sample bytes into StorageService
  // under an examples/ prefix (mirrors StorageService.put). Idempotent: clear
  // prior seeded example rows first. SECURITY: reference by key only.
  await prisma.exampleImage.deleteMany({ where: { guideFixtureId: guideFixture.id } });
  const examplePlan: { image: string; caption: string; bestInClass: boolean }[] = [
    { image: 'directive-01.png', caption: 'Knife wall — magnets across the top, blocks fronted with RRP A7 tickets.', bestInClass: true },
    { image: 'directive-02.png', caption: 'Sale ticket slipped in front of the RRP ticket in the acrylic stand.', bestInClass: false },
  ];
  let exampleCount = 0;
  for (const ex of examplePlan) {
    const abs = sample(ex.image);
    if (!abs) {
      console.warn(`  ! example sample missing, skipping: ${ex.image}`);
      continue;
    }
    const { key, bytes } = await storeSample(abs, 'examples');
    await prisma.exampleImage.create({
      data: {
        orgId,
        guideFixtureId: guideFixture.id,
        storageKey: key,
        caption: ex.caption,
        bestInClass: ex.bestInClass,
      },
    });
    exampleCount++;
    console.log(`  example: TCC WALL BAY 1 -> ${key} (${bytes} B)`);
  }

  console.log(
    `\nDone (create guide). ${GUIDE_FIXTURES.length} fixtures, ${GUIDE_PRODUCTS.length} products, ${placed} placements, 1 guide sheet (${merchCount} merchandised, ${exampleCount} examples).`,
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
