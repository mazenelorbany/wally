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
//   - 32 real Myer stores, each with StoreFixture applicability rows:
//     storefront applicable everywhere; vm_table 1/2 a per-store mix of
//     applicable / not-applicable; doorbuster applicable.
//   - The real 122-product Baccarat catalog (myer-baccarat-products.json joined
//     to baccarat-web-enrichment.json), merchandised across the guide fixtures.
//   - Tasks, sample sales (SalesEntry), and compliance flags (FixtureCapture)
//     on a few showcase stores so the manager + money-map views have data.
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
  CaptureVerdict,
  PhotoStatus,
  PrismaClient,
  ProjectKind,
  Role,
  SubmissionStatus,
  TaskKind,
  TaskStatus,
} from '@prisma/client';
import YAML from 'yaml';

import {
  fixtureForProduct,
  loadCampaignMeta,
  loadProducts,
  rowForProduct,
  type MyerProduct,
} from './seed-myer';

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

// ───────────────────────────────────────────── projects (top-level containers)
// Two demoable projects: the existing Myer retail campaign (RETAIL — attaches the
// 32 stores + MSP2-2026), and a fully-seeded Ambiente tradeshow stand setup
// (TRADESHOW — its own venue, guide campaign, booth fixtures, placements, guide
// sheets with reference images, and a few captures). Deterministic ids so the
// upserts are idempotent across re-runs.
const MYER_PROJECT_ID = 'seed-project-myer';
const AMBIENTE_PROJECT_ID = 'seed-project-ambiente';
const AMBIENTE_VENUE_REF = 'AMBIENTE-BOOTH';
const AMBIENTE_VENUE_STORE_ID = `seed-store-${AMBIENTE_VENUE_REF}`;
const AMBIENTE_CAMPAIGN_KEY = 'AMBIENTE-SS26';

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

/** Deterministic 0..1 from a string (FNV-1a) — stable illustrative figures across re-seeds. */
function unitHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 100_000) / 100_000;
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

// ───────────────────────────────────────────── the 32 real Myer stores
// Myer is the only retailer in scope. A store's `brand` is the concession fascia
// the storefront rubric grades; the floor plan splits departments per-fixture
// (The Custom Chef vs The Cook Shop), so brand here just alternates for variety.
// externalRef is MYER-<UPPER-SLUG>; the seeded id is `seed-store-<externalRef>`
// so the floor-plan loop seeds a plan for every store deterministically.
const CUSTOM_CHEF = 'The Custom Chef';
const COOK_SHOP = 'The Cook Shop';

const MYER_STORE_NAMES = [
  'Adelaide City Myer',
  'Belconnen Myer',
  'Bondi Myer',
  'Canberra City Myer',
  'Castle Hill Myer',
  'Chadstone Myer',
  'Charlestown Myer',
  'Chatswood Myer',
  'Chermside Myer',
  'Doncaster Myer',
  'Eastgardens Myer',
  'Eastland Myer',
  'Erina Myer',
  'Garden City Myer',
  'Highpoint Myer',
  'Indooroopilly Myer',
  'Joondalup Myer',
  'Karrinyup Myer',
  'Liverpool Myer',
  'Macquarie Myer',
  'Marion Myer',
  'Maroochydore Myer',
  'Melbourne City Myer',
  'Miranda Myer',
  'Northland Myer',
  'Parramatta Myer',
  'Perth City Myer',
  'Robina Myer',
  'Southland Myer',
  'Sydney City Myer',
  'Tea Tree Plaza Myer',
  'Warringah Myer',
] as const;

/** "Tea Tree Plaza Myer" → "TEA-TREE-PLAZA-MYER" */
function slugUpper(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const STORES = MYER_STORE_NAMES.map((name, i) => ({
  name,
  // Alternate the fascia for variety; the floor plan is what actually splits
  // departments per-fixture, so this is cosmetic.
  brand: i % 2 === 0 ? CUSTOM_CHEF : COOK_SHOP,
  externalRef: `MYER-${slugUpper(name)}`,
}));

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
  // A second VM table that not every store carries (deterministic by name so
  // re-seeds are stable): a couple of stores read "we don't have that table".
  const carriesTable2 = unitHash(`table2|${storeName}`) > 0.15;
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
  // KEEP the key MSP2-2026: rubric YAML filenames + the scoring stamp
  // ("storefront.MSP2-2026.v1") and rollup.spec.ts all key off it. We update
  // only the display name to the real Myer Sale 3 campaign from the JSON.
  const campaignMeta = loadCampaignMeta();
  const campaign = await prisma.campaign.upsert({
    where: { orgId_key: { orgId: org.id, key: CAMPAIGN_KEY } },
    update: { status: CampaignStatus.ACTIVE, name: campaignMeta.name },
    create: {
      orgId: org.id,
      key: CAMPAIGN_KEY,
      name: campaignMeta.name,
      status: CampaignStatus.ACTIVE,
      startsAt: new Date('2026-06-01T00:00:00Z'),
      endsAt: new Date('2026-07-06T23:59:59Z'),
    },
  });
  console.log(`  campaign: ${campaign.key} — "${campaign.name}" (${campaign.status})`);

  // --- Myer project (RETAIL) — the container for the 32 stores + MSP2 guide --
  // Upsert on the deterministic id so re-runs are a no-op. Attach the MSP2-2026
  // campaign to it now; the 32 stores get attached after they're seeded below.
  const myerProject = await prisma.project.upsert({
    where: { id: MYER_PROJECT_ID },
    update: { orgId: org.id, name: 'Myer', slug: 'myer', kind: ProjectKind.RETAIL },
    create: {
      id: MYER_PROJECT_ID,
      orgId: org.id,
      name: 'Myer',
      slug: 'myer',
      kind: ProjectKind.RETAIL,
    },
  });
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { projectId: myerProject.id },
  });
  console.log(`  project: Myer (${myerProject.id}, RETAIL) ← campaign ${campaign.key}`);

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

  // Prune stores left over from an earlier seed (the old 7 GRB stores keyed
  // GRB-*). The current seed owns the MYER-* set plus the Ambiente tradeshow
  // venue (seeded below); anything else under this org is stale. Cascades clean
  // their placements / submissions / sales / captures / tasks. Keeps re-runs
  // converging on exactly the 32 Myer stores + 1 Ambiente venue.
  const keepStoreRefs = [...STORES.map((s) => s.externalRef), AMBIENTE_VENUE_REF];
  const prunedStores = await prisma.store.deleteMany({
    where: { orgId: org.id, NOT: { externalRef: { in: keepStoreRefs } } },
  });
  if (prunedStores.count > 0) {
    console.log(`  pruned ${prunedStores.count} stale store(s) from a prior seed`);
  }

  // Attach all 32 Myer stores to the Myer project (idempotent updateMany on the
  // owned MYER-* externalRefs — never touches the Ambiente venue).
  const attachedStores = await prisma.store.updateMany({
    where: { orgId: org.id, externalRef: { in: STORES.map((s) => s.externalRef) } },
    data: { projectId: myerProject.id },
  });
  console.log(`  project Myer ← ${attachedStores.count} stores attached`);

  // --- Submissions + Photos (real bytes into storage, PENDING ScoreJobs) ----
  // We seed a handful so the queue + console aren't empty on first boot. The
  // worker scores them for real — we never fabricate a Verdict.
  //
  // Plan (exercises every store-rollup branch the console renders):
  //   Chadstone Myer      — storefront + door buster submitted (two to score)
  //   Melbourne City Myer — storefront only (one scored fixture; rest "missing")
  //   Sydney City Myer    — storefront submitted (a third store in the queue)
  const seedPlan: {
    store: string;
    status: SubmissionStatus;
    photos: { fixtureKey: string; image: string }[];
  }[] = [
    {
      store: 'Chadstone Myer',
      status: SubmissionStatus.SUBMITTED,
      photos: [
        { fixtureKey: 'storefront', image: 'msp2img-01.png' },
        { fixtureKey: 'doorbuster', image: 'msp2img-06.png' },
      ],
    },
    {
      store: 'Melbourne City Myer',
      status: SubmissionStatus.PARTIAL,
      photos: [{ fixtureKey: 'storefront', image: 'msp2img-05.png' }],
    },
    {
      store: 'Sydney City Myer',
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

  // --- Bulletins (the sale memo every Myer store reads + acknowledges) -------
  await seedBulletins({
    orgId: org.id,
    projectId: myerProject.id,
    campaignId: campaign.id,
    stores,
    ackUserId: admin.id,
  });

  // --- Ambiente project (TRADESHOW) — a full booth setup, seeded end-to-end --
  await seedAmbiente({ orgId: org.id });

  // --- Dev users for the access demo --------------------------------------
  // A read-only VIEWER, and a setup-crew STORE_MANAGER bound to the Ambiente
  // venue. Upsert on email so re-runs are idempotent.
  const viewer = await prisma.user.upsert({
    where: { email: 'viewer@dev.local' },
    update: { orgId: org.id, role: Role.VIEWER, name: 'Read-only Viewer', storeId: null },
    create: {
      orgId: org.id,
      email: 'viewer@dev.local',
      name: 'Read-only Viewer',
      role: Role.VIEWER,
    },
  });
  const setupCrew = await prisma.user.upsert({
    where: { email: 'setup@ambiente.dev' },
    update: {
      orgId: org.id,
      role: Role.STORE_MANAGER,
      name: 'Ambiente Setup Crew',
      storeId: AMBIENTE_VENUE_STORE_ID,
    },
    create: {
      orgId: org.id,
      email: 'setup@ambiente.dev',
      name: 'Ambiente Setup Crew',
      role: Role.STORE_MANAGER,
      storeId: AMBIENTE_VENUE_STORE_ID,
    },
  });
  console.log(
    `  dev users: ${viewer.email} (VIEWER), ${setupCrew.email} (STORE_MANAGER @ Ambiente venue)`,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// BULLETINS — the "sale memo" head office pushes to every store for a campaign.
// ───────────────────────────────────────────────────────────────────────────
// Seeds a realistic feed for the Myer project: a pinned setup memo (published,
// most stores have read it), a planogram-update notice (published, a few reads),
// and a teardown checklist still in Draft. Acks are spread across the first N
// stores so the studio's "Acknowledged x/y" rollup renders a partial bar.
// Idempotent: bulletins upsert on a fixed id; acks upsert on (bulletinId,storeId).
// ═══════════════════════════════════════════════════════════════════════════
async function seedBulletins(ctx: {
  orgId: string;
  projectId: string;
  campaignId: string;
  stores: { id: string; name: string }[];
  ackUserId: string;
}): Promise<void> {
  const { orgId, projectId, campaignId, stores, ackUserId } = ctx;
  console.log('\nSeeding BULLETINS (Myer sale memo + read receipts)…');

  const specs: {
    id: string;
    title: string;
    body: string;
    pinned: boolean;
    startsAt?: Date;
    endsAt?: Date;
    publishedAt: Date | null;
    /** How many of the first stores have acknowledged (published only). */
    ackStores: number;
  }[] = [
    {
      id: 'seed-bulletin-myer-setup',
      title: 'MSP2 2026 · Sale 3 — store setup memo',
      body: [
        'Sale 3 goes live Friday. Have every fixture reset before doors open.',
        '',
        '• VM Tables 1–3: lead with the Le Connoisseur range, NOOK second, iD3 on the end cap.',
        '• TCC Wall Bays 1–7: A7 sharps warning in the 2nd cabinet, far-left, acrylic only.',
        '• All knife blocks: white RRP A7 ticket in the acrylic in front; sale ticket in front of RRP.',
        '• Pull all Sale 2 signage the night before — no mixed pricing on the floor.',
        '',
        'Submit your storefront + door-buster photos by end of day Friday.',
      ].join('\n'),
      pinned: true,
      startsAt: new Date('2026-02-06T00:00:00Z'),
      endsAt: new Date('2026-02-20T00:00:00Z'),
      publishedAt: new Date('2026-02-03T08:00:00Z'),
      ackStores: Math.min(20, stores.length),
    },
    {
      id: 'seed-bulletin-myer-id3',
      title: 'New Baccarat iD3 range — planogram update',
      body: [
        'The iD3 knife range lands this week. Updated planograms are on TCC Wall Bay 1 and the VM tables.',
        '',
        'Face all iD3 blocks forward, magnets across the top of each cabinet, loose knives facing the cabinet.',
        'Check the attached layout before you build the wall.',
      ].join('\n'),
      pinned: false,
      publishedAt: new Date('2026-02-04T09:30:00Z'),
      ackStores: Math.min(7, stores.length),
    },
    {
      id: 'seed-bulletin-myer-teardown',
      title: 'End-of-sale teardown checklist (draft)',
      body: [
        'Draft — do not action yet. Posting the teardown checklist closer to the sale end date.',
        '',
        'Will cover: signage removal, fixture reset to core range, and the stock-return process.',
      ].join('\n'),
      pinned: false,
      publishedAt: null,
      ackStores: 0,
    },
  ];

  let created = 0;
  let ackCount = 0;
  for (const s of specs) {
    const data = {
      orgId,
      projectId,
      campaignId,
      title: s.title,
      body: s.body,
      pinned: s.pinned,
      startsAt: s.startsAt ?? null,
      endsAt: s.endsAt ?? null,
      publishedAt: s.publishedAt,
    };
    await prisma.bulletin.upsert({
      where: { id: s.id },
      update: data,
      create: { id: s.id, ...data },
    });
    created++;

    // Read receipts — only meaningful once published.
    if (s.publishedAt && s.ackStores > 0) {
      const ackTargets = stores.slice(0, s.ackStores);
      for (const store of ackTargets) {
        await prisma.bulletinAck.upsert({
          where: { bulletinId_storeId: { bulletinId: s.id, storeId: store.id } },
          update: {},
          create: { bulletinId: s.id, storeId: store.id, userId: ackUserId },
        });
        ackCount++;
      }
    }
  }
  console.log(`  bulletins: ${created} (${ackCount} read receipts across stores)`);
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
// Myer is the only retailer in scope, so every store is one floor plan split
// into two departments: "The Custom Chef" (TCC — knives, chef tools, free
// standers) and "The Cook Shop" (cookware, cooksets, appliances). The split
// follows the real "VM GUIDE SALE 3" floor plan (TCC block vs Cook Shop block).
// (CUSTOM_CHEF / COOK_SHOP are declared alongside STORES above.)
const GUIDE_FIXTURES: { name: string; kind: string; department: string }[] = [
  // VM promo tables — where the headline Baccarat ranges merchandise this sale
  // (Le Connoisseur / NOOK / ID3). Shared department; rendered as Cook Shop.
  { name: 'VM TABLE 1', kind: 'table', department: COOK_SHOP },
  { name: 'VM TABLE 2', kind: 'table', department: COOK_SHOP },
  { name: 'VM TABLE 3', kind: 'table', department: COOK_SHOP },
  { name: 'TCC WALL BAY 1', kind: 'bay', department: CUSTOM_CHEF },
  { name: 'TCC WALL BAY 2', kind: 'bay', department: CUSTOM_CHEF },
  { name: 'TCC WALL BAY 3', kind: 'bay', department: CUSTOM_CHEF },
  { name: 'TCC WALL BAY 4', kind: 'bay', department: CUSTOM_CHEF },
  { name: 'TCC WALL BAY 5', kind: 'bay', department: CUSTOM_CHEF },
  { name: 'TCC WALL BAY 6', kind: 'bay', department: CUSTOM_CHEF },
  { name: 'TCC WALL BAY 7', kind: 'bay', department: CUSTOM_CHEF },
  { name: 'COOKSET BULKSTACK', kind: 'stand', department: COOK_SHOP },
  { name: 'COOKWEAR SET BULK STACK', kind: 'stand', department: COOK_SHOP },
  { name: 'KNIFE BLOCK BULK STACK', kind: 'stand', department: CUSTOM_CHEF },
  { name: 'ELECTRICAL STAND 1', kind: 'stand', department: CUSTOM_CHEF },
  { name: 'ELECTRICAL STAND 2', kind: 'stand', department: CUSTOM_CHEF },
  { name: 'FREE STANDER 1 (FRONT)', kind: 'stand', department: CUSTOM_CHEF },
  { name: 'FREE STANDER 1 (BACK)', kind: 'stand', department: CUSTOM_CHEF },
  { name: 'FREE STANDER 2 (FRONT)', kind: 'stand', department: CUSTOM_CHEF },
  { name: 'FREE STANDER 2 (BACK)', kind: 'stand', department: CUSTOM_CHEF },
  { name: 'FREE STANDER 3 (FRONT)', kind: 'stand', department: CUSTOM_CHEF },
  { name: 'FREE STANDER 3 (BACK)', kind: 'stand', department: CUSTOM_CHEF },
  { name: 'QUAD STAND 1', kind: 'stand', department: COOK_SHOP },
  { name: 'KA STAND 1', kind: 'stand', department: COOK_SHOP },
  { name: 'KA STAND 2', kind: 'stand', department: COOK_SHOP },
  { name: 'MINI DAIS 1', kind: 'dais', department: COOK_SHOP },
  { name: 'MINI DAIS 10', kind: 'dais', department: COOK_SHOP },
  { name: 'TROLLEY 1', kind: 'trolley', department: COOK_SHOP },
  { name: 'TROLLEY 2', kind: 'trolley', department: COOK_SHOP },
  { name: 'TROLLEY 3', kind: 'trolley', department: COOK_SHOP },
  { name: 'WINDOW DISPLAY', kind: 'window', department: CUSTOM_CHEF },
  { name: 'FRY WALL BAY 01', kind: 'bay', department: COOK_SHOP },
];

// Real TCC catalog — Baccarat & Andre Verdier knives (category 'Knives').
// sku codes follow the TCC web style (epoch-ish base + dash suffix). imageUrl
// left null on purpose (the catalog feed wires real imagery later).
//
// NOTE: the product catalog is no longer hardcoded here — the real 122-product
// Baccarat catalog is loaded from the seed-data JSONs (myer-baccarat-products +
// baccarat-web-enrichment) via ./seed-myer and seeded in seedCreateGuide().

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

  // VM promo tables — the headline Baccarat ranges (LE CON / NOOK / ID3) sit on
  // these three tables this sale. Placed centre-floor so they read as the hero
  // tables on the money map.
  const tableY = 290;
  push({ fixtureName: 'VM TABLE 1', label: 'VM Table 1 · Le Connoisseur', x: 320, y: tableY, w: 120, h: 90 });
  push({ fixtureName: 'VM TABLE 2', label: 'VM Table 2 · NOOK', x: 460, y: tableY, w: 120, h: 90 });
  push({ fixtureName: 'VM TABLE 3', label: 'VM Table 3 · iD3', x: 600, y: tableY, w: 120, h: 90 });

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
      update: { kind: f.kind, department: f.department },
      create: { orgId, name: f.name, kind: f.kind, department: f.department },
    });
    fixtureByName.set(f.name, fixture.id);
  }
  console.log(`  fixtures: ${GUIDE_FIXTURES.length} in library`);

  // --- Product catalog (real 122 Baccarat products from the seed-data JSONs) -
  // Joined product sheet × web enrichment. Upsert on (orgId, sku) so re-runs
  // refresh rather than duplicate. We keep the parsed product alongside its db
  // id so the sales seeder can read salePrice/rrp without a re-query.
  const myerProducts = loadProducts();
  const productBySku = new Map<string, string>();
  const productInfoBySku = new Map<string, MyerProduct>();
  for (const p of myerProducts) {
    const product = await prisma.product.upsert({
      where: { orgId_sku: { orgId, sku: p.sku } },
      update: {
        name: p.name,
        webTitle: p.webTitle,
        brand: p.brand,
        range: p.range,
        category: p.category,
        imageUrl: p.imageUrl,
        rrp: p.rrp,
        salePrice: p.salePrice,
      },
      create: {
        orgId,
        sku: p.sku,
        name: p.name,
        webTitle: p.webTitle,
        brand: p.brand,
        range: p.range,
        category: p.category,
        imageUrl: p.imageUrl,
        rrp: p.rrp,
        salePrice: p.salePrice,
      },
    });
    productBySku.set(p.sku, product.id);
    productInfoBySku.set(p.sku, p);
  }
  // Prune products from an earlier seed (the old 15 hardcoded knife SKUs). The
  // current catalog owns exactly the loaded PCP-* skus; cascades clean their
  // merchandise + sales entries. Keeps re-runs converging on exactly 122.
  const keepSkus = myerProducts.map((p) => p.sku);
  const prunedProducts = await prisma.product.deleteMany({
    where: { orgId, NOT: { sku: { in: keepSkus } } },
  });
  if (prunedProducts.count > 0) {
    console.log(`  pruned ${prunedProducts.count} stale product(s) from a prior seed`);
  }
  console.log(`  products: ${myerProducts.length} in catalog (real Baccarat)`);

  // --- Floor plan placements for EVERY GRB store ---------------------------
  // Same layout per store for the demo (stores can drag to reposition); the real
  // product would import each store's true layout.
  if (stores.length === 0) {
    console.warn('  ! no stores to place fixtures on — skipping floor plan');
    return;
  }
  const specs = floorPlanFor();
  let placed = 0;
  for (const planStore of stores) {
    let order = 0;
    for (const s of specs) {
      const fixtureId = fixtureByName.get(s.fixtureName);
      if (!fixtureId) {
        console.warn(`  ! unknown fixture in plan: ${s.fixtureName}`);
        continue;
      }
      // Illustrative period sales (deterministic so re-seeds are stable). Wall
      // bays pull the most; bulkstacks mid; dais/trolleys least. Not real POS.
      const u = unitHash(`${planStore.name}|${s.fixtureName}`);
      const n = s.fixtureName.toUpperCase();
      const base = n.includes('WALL BAY')
        ? 95_000
        : n.includes('BULK')
          ? 55_000
          : n.includes('WINDOW')
            ? 70_000
            : n.includes('STANDER') || n.includes('STAND')
              ? 38_000
              : 22_000;
      const revenue = Math.round((base * (0.55 + u * 0.9)) / 50) * 50;
      const units = Math.max(1, Math.round(revenue / (90 + u * 140)));
      const data = {
        x: s.x,
        y: s.y,
        w: s.w,
        h: s.h,
        rotation: s.rotation ?? 0,
        applicable: s.applicable ?? true,
        label: s.label,
        order: order++,
        revenue,
        units,
      };
      await prisma.placement.upsert({
        where: { storeId_campaignId_fixtureId: { storeId: planStore.id, campaignId, fixtureId } },
        update: data,
        create: { orgId, storeId: planStore.id, campaignId, fixtureId, ...data },
      });
      placed++;
    }
  }
  console.log(`  placements: ${placed} across ${stores.length} stores' floor plans (1000x640)`);

  // --- Guide sheets + merchandise (real products across many fixtures) ------
  // Distribute the 122 products across guide-fixtures by range (see
  // fixtureForProduct in ./seed-myer): LE CON → VM Table 1, NOOK → VM Table 2,
  // ID3/loose → VM Table 3, cooksets → Cookset Bulkstack, appliances →
  // Electrical Stand 1, GRYLT → Fry Wall Bay, leftovers spread across wall bays.
  // Each merchandised fixture gets a GuideFixture sheet; products group into
  // shelf rows. Idempotent: we clear prior Merchandise per guide-fixture first.

  // 1) Group every product under its target guide-fixture name.
  const bySheet = new Map<string, MyerProduct[]>();
  const unplaced: string[] = [];
  // Always keep the knife-wall sheet (TCC WALL BAY 1) — it carries the real
  // directives + the "what good looks like" example gallery, even though the
  // Baccarat sale catalog has no knife SKUs to merchandise onto it.
  bySheet.set('TCC WALL BAY 1', []);
  for (const p of myerProducts) {
    const fixtureName = fixtureForProduct(p);
    if (!fixtureByName.has(fixtureName)) {
      unplaced.push(p.sku);
      continue;
    }
    const arr = bySheet.get(fixtureName) ?? [];
    arr.push(p);
    bySheet.set(fixtureName, arr);
  }

  // 2) Notes per fixture: the real knife-wall directives on TCC WALL BAY 1; a
  //    short merchandising note elsewhere. fixtureId → guideFixtureId so the
  //    sales seeder can denormalise SalesEntry.fixtureId from a product.
  const guideFixtureIdByFixtureName = new Map<string, string>();
  const fixtureNameByProductSku = new Map<string, string>();
  let merchCount = 0;
  let sheetCount = 0;
  let sheetOrder = 0;
  // Sort sheet names for a stable order across re-runs.
  for (const fixtureName of [...bySheet.keys()].sort()) {
    const fixtureId = fixtureByName.get(fixtureName)!;
    const notes =
      fixtureName === 'TCC WALL BAY 1'
        ? WALL_BAY_1_NOTES
        : `Merchandise the ${fixtureName} per the VM guide — full-front facings, RRP + sale tickets in acrylics, newest ranges at eye level.`;
    const guideFixture = await prisma.guideFixture.upsert({
      where: { campaignId_fixtureId: { campaignId, fixtureId } },
      update: { notes, order: sheetOrder },
      create: { orgId, campaignId, fixtureId, notes, order: sheetOrder },
    });
    sheetOrder++;
    sheetCount++;
    guideFixtureIdByFixtureName.set(fixtureName, guideFixture.id);

    // Clear prior merchandise for this sheet (no natural key on Merchandise).
    await prisma.merchandise.deleteMany({ where: { guideFixtureId: guideFixture.id } });
    // Order products within the sheet by row band then sku for stability.
    const items = [...bySheet.get(fixtureName)!].sort((a, b) =>
      a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0,
    );
    const orderByRow = new Map<string, number>();
    for (const p of items) {
      const row = rowForProduct(p);
      const order = orderByRow.get(row) ?? 0;
      orderByRow.set(row, order + 1);
      await prisma.merchandise.create({
        data: {
          orgId,
          guideFixtureId: guideFixture.id,
          productId: productBySku.get(p.sku)!,
          row,
          order,
        },
      });
      fixtureNameByProductSku.set(p.sku, fixtureName);
      merchCount++;
    }
  }
  // Prune guide sheets from a prior seed that this run no longer owns (cascades
  // their merchandise + example images). Keeps the sheet set converging.
  const keepGuideIds = [...guideFixtureIdByFixtureName.values()];
  const prunedSheets = await prisma.guideFixture.deleteMany({
    where: { campaignId, NOT: { id: { in: keepGuideIds } } },
  });
  console.log(
    `  merchandise: ${merchCount} products across ${sheetCount} guide sheets` +
      (unplaced.length ? ` (${unplaced.length} unplaced)` : '') +
      (prunedSheets.count > 0 ? ` (pruned ${prunedSheets.count} stale sheet[s])` : ''),
  );

  // 3) Example "what good looks like" images on the knife-wall sheet (unchanged
  //    behaviour). Copy sample bytes into StorageService under examples/; clear
  //    prior seeded rows first. SECURITY: reference by key only.
  const wallBay1GuideId = guideFixtureIdByFixtureName.get('TCC WALL BAY 1');
  let exampleCount = 0;
  if (wallBay1GuideId) {
    await prisma.exampleImage.deleteMany({ where: { guideFixtureId: wallBay1GuideId } });
    const examplePlan: { image: string; caption: string; bestInClass: boolean }[] = [
      { image: 'directive-01.png', caption: 'Knife wall — magnets across the top, blocks fronted with RRP A7 tickets.', bestInClass: true },
      { image: 'directive-02.png', caption: 'Sale ticket slipped in front of the RRP ticket in the acrylic stand.', bestInClass: false },
    ];
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
          guideFixtureId: wallBay1GuideId,
          storageKey: key,
          caption: ex.caption,
          bestInClass: ex.bestInClass,
        },
      });
      exampleCount++;
      console.log(`  example: TCC WALL BAY 1 -> ${key} (${bytes} B)`);
    }
  }

  // 4) Tasks · sample sales · compliance flags for a few showcase stores.
  await seedManagerWorkspace({
    orgId,
    campaignId,
    stores,
    fixtureByName,
    fixtureNameByProductSku,
    productBySku,
    productInfoBySku,
  });

  console.log(
    `\nDone (create guide). ${GUIDE_FIXTURES.length} fixtures, ${myerProducts.length} products, ${placed} placements, ${sheetCount} guide sheets (${merchCount} merchandised, ${exampleCount} examples).`,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STORE-MANAGER workspace — tasks, sample sales, and compliance flags.
// ───────────────────────────────────────────────────────────────────────────
// Seeds a realistic manager workload on a FEW showcase stores (not all 32):
//   - Task rows (UPLOAD_PHOTO / LOG_SALES / GENERAL), a mix of seen/unseen.
//   - SalesEntry rows on ~2 stores so their money map shows REAL logged sales
//     (illustrative:false) while every other store keeps the illustrative
//     placement fallback.
//   - FixtureCapture rows on ~3 stores for floor-map variety: some needsPhoto
//     todos, a few scored PASS/NEEDS_REVIEW/FAIL. Most fixtures stay un-captured
//     (so they read as "todo" by default).
// Everything upserts on a deterministic id / natural key, so re-runs are safe.
// ═══════════════════════════════════════════════════════════════════════════
async function seedManagerWorkspace(ctx: {
  orgId: string;
  campaignId: string;
  stores: { id: string; name: string }[];
  fixtureByName: Map<string, string>;
  fixtureNameByProductSku: Map<string, string>;
  productBySku: Map<string, string>;
  productInfoBySku: Map<string, MyerProduct>;
}): Promise<void> {
  const {
    orgId,
    campaignId,
    stores,
    fixtureByName,
    fixtureNameByProductSku,
    productBySku,
    productInfoBySku,
  } = ctx;

  const byName = (name: string) => stores.find((s) => s.name === name);
  // Showcase stores: the org's first store + a fixed, recognisable set.
  const firstStore = stores[0];
  const showcaseNames = [
    firstStore?.name,
    'Chadstone Myer',
    'Melbourne City Myer',
    'Sydney City Myer',
    'Bondi Myer',
  ].filter((n): n is string => Boolean(n));
  // De-dup while keeping order (first store might already be in the list).
  const showcaseStores = [...new Set(showcaseNames)]
    .map((n) => byName(n))
    .filter((s): s is { id: string; name: string } => Boolean(s));

  // --- Tasks ---------------------------------------------------------------
  // A small, realistic backlog per showcase store. Deterministic id
  // `seed-task-<storeRef>-<n>` so re-runs upsert in place.
  type TaskSpec = {
    n: number;
    kind: TaskKind;
    title: string;
    body?: string;
    fixtureKey?: string;
    seen: boolean;
  };
  const taskSpecs: TaskSpec[] = [
    { n: 1, kind: TaskKind.UPLOAD_PHOTO, title: 'Upload Storefront photo', body: 'We need an updated storefront shot for Sale 3.', fixtureKey: 'storefront', seen: false },
    { n: 2, kind: TaskKind.UPLOAD_PHOTO, title: 'Upload VM Table 1 photo', body: 'Photograph the Le Connoisseur promo table once it is built.', fixtureKey: 'vm_table', seen: true },
    { n: 3, kind: TaskKind.LOG_SALES, title: 'Log week 1 sales', body: 'Log units sold for the Baccarat ranges for week 1 of Sale 3.', seen: false },
    { n: 4, kind: TaskKind.GENERAL, title: 'Confirm GWP stock', body: 'Confirm the free knife-block GWP is in stock at the door buster stack.', seen: true },
  ];
  let taskCount = 0;
  for (const store of showcaseStores) {
    for (const t of taskSpecs) {
      const id = `seed-task-${store.id}-${t.n}`;
      const data = {
        orgId,
        storeId: store.id,
        campaignId,
        kind: t.kind,
        status: TaskStatus.OPEN,
        title: t.title,
        body: t.body ?? null,
        fixtureKey: t.fixtureKey ?? null,
        seenAt: t.seen ? new Date('2026-06-02T09:00:00Z') : null,
      };
      await prisma.task.upsert({ where: { id }, update: data, create: { id, ...data } });
      taskCount++;
    }
  }
  console.log(`  tasks: ${taskCount} across ${showcaseStores.length} stores`);

  // --- Sample sales (SalesEntry) -------------------------------------------
  // For 1–2 stores, log REAL sales against a broad subset of merchandised
  // products. NOTE: the money map flips a whole store to "real" once it has ANY
  // SalesEntry, so we log across MANY products (every Nth sku) to avoid zeroing
  // the rest of that store's tiles. units 2..40 deterministic by sku; unitPrice
  // = salePrice ?? rrp ?? 0; fixtureId = the product's guide-fixture.
  const salesStores = [firstStore?.name, 'Chadstone Myer']
    .filter((n): n is string => Boolean(n))
    .map((n) => byName(n))
    .filter((s): s is { id: string; name: string } => Boolean(s));
  const merchSkus = [...fixtureNameByProductSku.keys()];
  // Sales are tracked per calendar DAY (SalesEntry.soldOn). Spread the seeded
  // rows across the first few days of the sale so the manager's daily view and
  // the money map both have real day-over-day variety (date-only, UTC midnight).
  const SALE_DAYS = [
    new Date('2026-02-06T00:00:00Z'),
    new Date('2026-02-07T00:00:00Z'),
    new Date('2026-02-08T00:00:00Z'),
  ];
  let salesCount = 0;
  for (const store of salesStores) {
    // ~70% of merchandised products get a sales row (deterministic by sku).
    const subset = merchSkus.filter((sku) => unitHash(`${store.name}|sale|${sku}`) < 0.7);
    for (const sku of subset) {
      const info = productInfoBySku.get(sku);
      const productId = productBySku.get(sku);
      const fixtureName = fixtureNameByProductSku.get(sku);
      if (!info || !productId || !fixtureName) continue;
      const fixtureId = fixtureByName.get(fixtureName) ?? null;
      const units = 2 + Math.floor(unitHash(`${store.name}|units|${sku}`) * 39); // 2..40
      const unitPrice = info.salePrice ?? info.rrp ?? 0;
      const revenue = Math.round(units * unitPrice * 100) / 100;
      const soldOn = SALE_DAYS[Math.floor(unitHash(`${store.name}|day|${sku}`) * SALE_DAYS.length)];
      await prisma.salesEntry.upsert({
        where: {
          storeId_campaignId_productId_soldOn: { storeId: store.id, campaignId, productId, soldOn },
        },
        update: { fixtureId, units, unitPrice, revenue },
        create: { orgId, storeId: store.id, campaignId, productId, fixtureId, units, unitPrice, revenue, soldOn },
      });
      salesCount++;
    }
  }
  console.log(
    `  sales: ${salesCount} entries across ${salesStores.map((s) => s.name).join(', ') || 'none'} (real money map)`,
  );

  // --- Compliance flags (FixtureCapture) -----------------------------------
  // For ~3 stores, seed a handful of captures across applicable fixtures to give
  // the floor map variety. A few needsPhoto todos (no photo), and 2–3 scored
  // verdicts (PASS / NEEDS_REVIEW / FAIL). Most fixtures stay un-captured.
  const captureStores = [firstStore?.name, 'Chadstone Myer', 'Bondi Myer']
    .filter((n): n is string => Boolean(n))
    .map((n) => byName(n))
    .filter((s): s is { id: string; name: string } => Boolean(s));
  const captureFixtureNames = ['VM TABLE 1', 'VM TABLE 2', 'VM TABLE 3', 'TCC WALL BAY 1', 'COOKSET BULKSTACK', 'ELECTRICAL STAND 1'];
  const verdictCycle = [
    { needsPhoto: true, verdict: null as CaptureVerdict | null, notes: null as string | null },
    { needsPhoto: false, verdict: CaptureVerdict.PASS, notes: 'Matches the guide: full facings, tickets in acrylics, ranges at eye level.' },
    { needsPhoto: false, verdict: CaptureVerdict.NEEDS_REVIEW, notes: 'Close, but the sale tickets are missing on two facings — please review.' },
    { needsPhoto: false, verdict: CaptureVerdict.FAIL, notes: 'Table is under-stocked vs the guide and the GWP signage is absent.' },
  ];
  const capturePromises: Promise<unknown>[] = [];
  for (const store of captureStores) {
    captureFixtureNames.forEach((fixtureName, i) => {
      const fixtureId = fixtureByName.get(fixtureName);
      if (!fixtureId) return;
      // Stagger which verdict each store/fixture gets so the map has variety.
      const cell = verdictCycle[(i + store.name.length) % verdictCycle.length];
      capturePromises.push(
        prisma.fixtureCapture.upsert({
          where: { storeId_campaignId_fixtureId: { storeId: store.id, campaignId, fixtureId } },
          update: {
            needsPhoto: cell.needsPhoto,
            storageKey: cell.verdict ? `captures/${store.id}/${campaignId}/${fixtureId}.png` : null,
            uploadedAt: cell.verdict ? new Date('2026-06-02T10:00:00Z') : null,
            verdict: cell.verdict,
            aiNotes: cell.notes,
            confidence: cell.verdict ? 0.82 : null,
            modelId: cell.verdict ? 'stub' : null,
            scoredAt: cell.verdict ? new Date('2026-06-02T10:01:00Z') : null,
          },
          create: {
            orgId,
            storeId: store.id,
            campaignId,
            fixtureId,
            needsPhoto: cell.needsPhoto,
            storageKey: cell.verdict ? `captures/${store.id}/${campaignId}/${fixtureId}.png` : null,
            uploadedAt: cell.verdict ? new Date('2026-06-02T10:00:00Z') : null,
            verdict: cell.verdict,
            aiNotes: cell.notes,
            confidence: cell.verdict ? 0.82 : null,
            modelId: cell.verdict ? 'stub' : null,
            scoredAt: cell.verdict ? new Date('2026-06-02T10:01:00Z') : null,
          },
        }),
      );
    });
  }
  await Promise.all(capturePromises);
  console.log(`  captures: ${capturePromises.length} across ${captureStores.map((s) => s.name).join(', ') || 'none'}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// AMBIENTE project — a tradeshow stand setup, seeded end-to-end.
// ───────────────────────────────────────────────────────────────────────────
// A TRADESHOW project (vs Myer's RETAIL) with its own venue (one "store"), its
// own guide (Campaign), six booth fixtures laid out on the 1000x640 canvas like
// a real stand, a GuideFixture sheet per fixture with VM setup notes + a "what
// good looks like" reference image, and a few FixtureCaptures (todo + scored) so
// the setup-status visualization has data. Everything upserts on deterministic
// ids / natural keys, so re-runs converge. Reuses storeSample()/sample() above
// for reference imagery (same StorageService key layout → signed URLs resolve).
// ═══════════════════════════════════════════════════════════════════════════

// Reference imagery for the booth guide sheets — reused sample assets from the
// POC samples dir (the same store the TCC WALL BAY 1 examples come from). One
// per fixture for variety; placeholder/reused imagery is fine for the demo as
// long as the signed URL resolves. Falls back gracefully if an asset is missing.
const AMBIENTE_REFERENCE_SAMPLES = [
  'directive-01.png',
  'directive-02.png',
  'directive-03.png',
  'directive-04.png',
  'msp2img-07.png',
  'msp2img-08.png',
];

// The six booth fixtures. kind ∈ bay|table|stand|window. department is null —
// these are tradeshow fixtures, not Myer departments. Deterministic ids so the
// fixture library upsert (on orgId+name) is stable across re-runs.
const AMBIENTE_FIXTURES: {
  id: string;
  name: string;
  kind: string;
  notes: string;
  // booth geometry on the 1000x640 canvas (x,y top-left; w,h px).
  x: number;
  y: number;
  w: number;
  h: number;
}[] = [
  {
    id: 'seed-fixture-ambiente-wall-left',
    name: 'Ambiente · Wall Left',
    kind: 'window',
    notes: [
      'BACK-LEFT WALL — the brand statement wall, first thing visitors read on approach.',
      '1. Hang the SS26 hero graphic centred, top edge at 2.2m; logo lock-up top-left.',
      '2. Spotlight wash from the truss: two heads at 30°, no hot spots on the print.',
      '3. Keep the wall product-free — this is pure brand. No shelves, no tickets.',
    ].join('\n'),
    x: 24,
    y: 70,
    w: 120,
    h: 480,
  },
  {
    id: 'seed-fixture-ambiente-wall-right',
    name: 'Ambiente · Wall Right',
    kind: 'bay',
    notes: [
      'BACK WALL (RIGHT RUN) — the merchandised range wall behind the stand.',
      '1. Four shelves, evenly spaced; newest SS26 range at eye level (shelf 2 from top).',
      '2. Full-front facings, labels forward; RRP tickets in acrylics, left-aligned.',
      '3. Backlight the top shelf only; leave a 200mm clear margin each end.',
    ].join('\n'),
    x: 170,
    y: 24,
    w: 540,
    h: 70,
  },
  {
    id: 'seed-fixture-ambiente-hero-table',
    name: 'Ambiente · Hero Table',
    kind: 'table',
    notes: [
      'HERO TABLE — centre of the stand, the showpiece every photo is taken around.',
      '1. One hero range only, built in a pyramid; tallest piece dead-centre.',
      '2. Single A5 story card on a riser at the back edge — no loose tickets on the cloth.',
      '3. Black table cloth, steamed, breaking just above the floor; nothing stored beneath.',
    ].join('\n'),
    x: 410,
    y: 250,
    w: 180,
    h: 130,
  },
  {
    id: 'seed-fixture-ambiente-display-bay-1',
    name: 'Ambiente · Display Bay 1',
    kind: 'bay',
    notes: [
      'DISPLAY BAY 1 (LEFT) — supporting range bay, left of the hero table.',
      '1. Three shelves; group by collection, one collection per shelf.',
      '2. Props minimal — let the product read; one small plant top-right only.',
      '3. Sale/launch tickets in acrylics, fronted, aligned to the shelf edge.',
    ].join('\n'),
    x: 250,
    y: 430,
    w: 150,
    h: 110,
  },
  {
    id: 'seed-fixture-ambiente-display-bay-2',
    name: 'Ambiente · Display Bay 2',
    kind: 'bay',
    notes: [
      'DISPLAY BAY 2 (RIGHT) — supporting range bay, right of the hero table.',
      '1. Mirror Bay 1: three shelves, collection per shelf, full-front facings.',
      '2. Keep the two bays visually balanced — same shelf heights, same ticket style.',
      '3. Restock from the back; never leave a gap at the front of a shelf.',
    ].join('\n'),
    x: 600,
    y: 430,
    w: 150,
    h: 110,
  },
  {
    id: 'seed-fixture-ambiente-demo-counter',
    name: 'Ambiente · Demo Counter',
    kind: 'stand',
    notes: [
      'DEMO COUNTER — front of stand, where the live demo + sign-ups happen.',
      '1. Face the aisle; leave 900mm clear behind for the demonstrator.',
      '2. One demo set out, clean and reset between demos; tablet for lead capture on the right.',
      '3. Stash boxes and consumables in the locked under-counter — nothing visible to visitors.',
    ].join('\n'),
    x: 410,
    y: 560,
    w: 180,
    h: 64,
  },
];

async function seedAmbiente(ctx: { orgId: string }): Promise<void> {
  const { orgId } = ctx;
  console.log('\nSeeding AMBIENTE (tradeshow project · venue · guide · booth)…');

  // --- Project (TRADESHOW) -------------------------------------------------
  const project = await prisma.project.upsert({
    where: { id: AMBIENTE_PROJECT_ID },
    update: { orgId, name: 'Ambiente', slug: 'ambiente', kind: ProjectKind.TRADESHOW },
    create: {
      id: AMBIENTE_PROJECT_ID,
      orgId,
      name: 'Ambiente',
      slug: 'ambiente',
      kind: ProjectKind.TRADESHOW,
    },
  });
  console.log(`  project: Ambiente (${project.id}, TRADESHOW)`);

  // --- Venue (one "store" — the booth) -------------------------------------
  const venue = await prisma.store.upsert({
    where: { id: AMBIENTE_VENUE_STORE_ID },
    update: {
      orgId,
      projectId: project.id,
      name: 'Ambiente Stand',
      brand: 'Tradeshow',
      externalRef: AMBIENTE_VENUE_REF,
    },
    create: {
      id: AMBIENTE_VENUE_STORE_ID,
      orgId,
      projectId: project.id,
      name: 'Ambiente Stand',
      brand: 'Tradeshow',
      externalRef: AMBIENTE_VENUE_REF,
    },
  });
  console.log(`  venue: ${venue.name} (${venue.id})`);

  // --- Guide campaign ------------------------------------------------------
  const campaign = await prisma.campaign.upsert({
    where: { orgId_key: { orgId, key: AMBIENTE_CAMPAIGN_KEY } },
    update: {
      projectId: project.id,
      name: 'Ambiente Stand — SS26',
      status: CampaignStatus.ACTIVE,
      startsAt: new Date('2026-02-06T00:00:00Z'),
      endsAt: new Date('2026-02-10T23:59:59Z'),
    },
    create: {
      orgId,
      projectId: project.id,
      key: AMBIENTE_CAMPAIGN_KEY,
      name: 'Ambiente Stand — SS26',
      status: CampaignStatus.ACTIVE,
      startsAt: new Date('2026-02-06T00:00:00Z'),
      endsAt: new Date('2026-02-10T23:59:59Z'),
    },
  });
  console.log(`  campaign: ${campaign.key} — "${campaign.name}" (${campaign.status})`);

  // --- Booth fixtures (library) + placements + guide sheets ----------------
  const fixtureIds: string[] = [];
  let placed = 0;
  let sheets = 0;
  for (let i = 0; i < AMBIENTE_FIXTURES.length; i++) {
    const f = AMBIENTE_FIXTURES[i];
    // Fixture library (upsert on orgId+name; department null — not a Myer dept).
    const fixture = await prisma.fixture.upsert({
      where: { orgId_name: { orgId, name: f.name } },
      update: { kind: f.kind, department: null },
      create: { id: f.id, orgId, name: f.name, kind: f.kind, department: null },
    });
    fixtureIds.push(fixture.id);

    // Placement on the booth canvas (1000x640).
    await prisma.placement.upsert({
      where: {
        storeId_campaignId_fixtureId: {
          storeId: venue.id,
          campaignId: campaign.id,
          fixtureId: fixture.id,
        },
      },
      update: {
        label: f.name.replace('Ambiente · ', ''),
        x: f.x,
        y: f.y,
        w: f.w,
        h: f.h,
        rotation: 0,
        applicable: true,
        order: i,
      },
      create: {
        orgId,
        storeId: venue.id,
        campaignId: campaign.id,
        fixtureId: fixture.id,
        label: f.name.replace('Ambiente · ', ''),
        x: f.x,
        y: f.y,
        w: f.w,
        h: f.h,
        rotation: 0,
        applicable: true,
        order: i,
      },
    });
    placed++;

    // Guide sheet (VM setup notes for this wall/bay/table).
    const guideFixture = await prisma.guideFixture.upsert({
      where: { campaignId_fixtureId: { campaignId: campaign.id, fixtureId: fixture.id } },
      update: { notes: f.notes, order: i },
      create: { orgId, campaignId: campaign.id, fixtureId: fixture.id, notes: f.notes, order: i },
    });
    sheets++;

    // Reference "what good looks like" image — reuse the same StorageService
    // mechanism the TCC WALL BAY 1 sheet uses (storeSample → examples/ key), so
    // the signed URL resolves. Cycle the available sample assets for variety.
    await prisma.exampleImage.deleteMany({ where: { guideFixtureId: guideFixture.id } });
    const sampleName = AMBIENTE_REFERENCE_SAMPLES[i % AMBIENTE_REFERENCE_SAMPLES.length];
    const abs = sample(sampleName);
    if (abs) {
      const { key } = await storeSample(abs, 'examples');
      await prisma.exampleImage.create({
        data: {
          orgId,
          guideFixtureId: guideFixture.id,
          storageKey: key,
          caption: `${f.name.replace('Ambiente · ', '')} — what good looks like at the stand.`,
          bestInClass: true,
        },
      });
    } else {
      console.warn(`  ! reference sample missing, skipping example for ${f.name}: ${sampleName}`);
    }
  }
  console.log(
    `  booth: ${fixtureIds.length} fixtures, ${placed} placements, ${sheets} guide sheets (each with a reference image)`,
  );

  // --- FixtureCaptures (setup-status data) ---------------------------------
  // Across the six fixtures: ~3 todo (needsPhoto, no photo, no verdict) and ~3
  // scored (PASS / NEEDS_REVIEW). storageKey on scored rows reuses a sample
  // placeholder so the verify view has a thumbnail; modelId 'stub'. Deterministic
  // upsert on (storeId, campaignId, fixtureId).
  const captureSampleAbs = sample('msp2img-02.png'); // reused placeholder thumbnail
  let scoredKey: string | null = null;
  if (captureSampleAbs) {
    scoredKey = (await storeSample(captureSampleAbs, 'captures')).key;
  }
  const captureCells: {
    needsPhoto: boolean;
    verdict: CaptureVerdict | null;
    aiNotes: string | null;
  }[] = [
    { needsPhoto: true, verdict: null, aiNotes: null }, // Wall Left — todo
    {
      needsPhoto: false,
      verdict: CaptureVerdict.PASS,
      aiNotes: 'Range wall reads clean: even shelves, full facings, tickets fronted in acrylics.',
    }, // Wall Right — scored PASS
    {
      needsPhoto: false,
      verdict: CaptureVerdict.NEEDS_REVIEW,
      aiNotes: 'Hero pyramid is slightly off-centre and the story card is leaning — please review.',
    }, // Hero Table — scored NEEDS_REVIEW
    { needsPhoto: true, verdict: null, aiNotes: null }, // Display Bay 1 — todo
    {
      needsPhoto: false,
      verdict: CaptureVerdict.PASS,
      aiNotes: 'Bay 2 mirrors Bay 1 well — matched shelf heights, balanced facings, no front gaps.',
    }, // Display Bay 2 — scored PASS
    { needsPhoto: true, verdict: null, aiNotes: null }, // Demo Counter — todo
  ];
  let captureCount = 0;
  for (let i = 0; i < fixtureIds.length; i++) {
    const cell = captureCells[i];
    const scored = cell.verdict !== null;
    const data = {
      needsPhoto: cell.needsPhoto,
      storageKey: scored ? scoredKey : null,
      uploadedAt: scored ? new Date('2026-02-05T09:00:00Z') : null,
      verdict: cell.verdict,
      aiNotes: cell.aiNotes,
      confidence: scored ? 0.84 : null,
      modelId: scored ? 'stub' : null,
      scoredAt: scored ? new Date('2026-02-05T09:01:00Z') : null,
    };
    await prisma.fixtureCapture.upsert({
      where: {
        storeId_campaignId_fixtureId: {
          storeId: venue.id,
          campaignId: campaign.id,
          fixtureId: fixtureIds[i],
        },
      },
      update: data,
      create: { orgId, storeId: venue.id, campaignId: campaign.id, fixtureId: fixtureIds[i], ...data },
    });
    captureCount++;
  }
  const todo = captureCells.filter((c) => c.verdict === null).length;
  console.log(
    `  captures: ${captureCount} (${todo} todo, ${captureCount - todo} scored PASS/NEEDS_REVIEW)`,
  );
  console.log(`\nDone (ambiente). 1 venue, 1 campaign, ${placed} placements, ${sheets} guide sheets.`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
