// =============================================================================
// cleanup-unused-fixtures — one-shot library hygiene after the Ambiente 2026
// planogram import.
// =============================================================================
//
// Run from apps/api:   pnpm exec tsx prisma/cleanup-unused-fixtures.ts
//
// Three moves, in order:
//   1. DELETE fixtures with ZERO references anywhere (no placements, no guide
//      sheets, no captures, no default products) — dead library entries left
//      behind by earlier Myer seeds (TROLLEY 1-3, FREE STANDER *, KA STAND *,
//      TCC WALL BAY 2-7, …). Nothing cascades because nothing references them.
//   2. DELETE the six archived SS26 placeholder fixtures ("Ambiente · Wall
//      Left" …). Their only references are the CLOSED AMBIENTE-SS26 demo
//      campaign's placements/guides/captures, which cascade away with them —
//      the real Ambiente 2026 planogram replaced all of it.
//   3. RE-HOME every remaining shared (projectId = null) fixture to the Myer
//      project. They are all Myer MSP2 fixtures; per the schema's own rule
//      ("Myer and Ambiente keep their own fixtures so the library and
//      floor-plan palette never mix") they should never have appeared in the
//      Ambiente palette.
//
// Idempotent: a second run finds nothing to delete and nothing shared left.
// =============================================================================

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const __envPath = join(__dirname, '..', '.env');
if (
  !process.env.DATABASE_URL &&
  existsSync(__envPath) &&
  typeof process.loadEnvFile === 'function'
) {
  process.loadEnvFile(__envPath);
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set — export it or fill apps/api/.env');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const MYER_PROJECT_ID = 'seed-project-myer';

// The SS26 placeholder booth, superseded by the real Ambiente 2026 planogram.
const SS26_PLACEHOLDER_IDS = [
  'seed-fixture-ambiente-wall-left',
  'seed-fixture-ambiente-wall-right',
  'seed-fixture-ambiente-hero-table',
  'seed-fixture-ambiente-display-bay-1',
  'seed-fixture-ambiente-display-bay-2',
  'seed-fixture-ambiente-demo-counter',
];

async function main(): Promise<void> {
  // --- 1. delete fully-unreferenced fixtures --------------------------------
  const all = await prisma.fixture.findMany({
    select: {
      id: true,
      name: true,
      projectId: true,
      _count: {
        select: {
          placements: true,
          guideFixtures: true,
          captures: true,
          defaultProducts: true,
        },
      },
    },
  });
  const dead = all.filter(
    (f) =>
      f._count.placements === 0 &&
      f._count.guideFixtures === 0 &&
      f._count.captures === 0 &&
      f._count.defaultProducts === 0,
  );
  if (dead.length) {
    await prisma.fixture.deleteMany({ where: { id: { in: dead.map((f) => f.id) } } });
    console.log(`deleted ${dead.length} unreferenced fixtures:`);
    for (const f of dead) console.log(`  - ${f.name}`);
  } else {
    console.log('no unreferenced fixtures to delete');
  }

  // --- 2. delete the SS26 placeholder booth ---------------------------------
  const placeholders = await prisma.fixture.findMany({
    where: { id: { in: SS26_PLACEHOLDER_IDS } },
    select: { id: true, name: true },
  });
  if (placeholders.length) {
    // Placements / guide sheets / captures of the closed SS26 demo cascade.
    await prisma.fixture.deleteMany({
      where: { id: { in: placeholders.map((f) => f.id) } },
    });
    console.log(`deleted ${placeholders.length} SS26 placeholder fixtures (demo booth):`);
    for (const f of placeholders) console.log(`  - ${f.name}`);
  } else {
    console.log('no SS26 placeholder fixtures left');
  }

  // --- 3. re-home remaining shared fixtures to Myer -------------------------
  const myer = await prisma.project.findUnique({ where: { id: MYER_PROJECT_ID } });
  if (!myer) throw new Error(`project ${MYER_PROJECT_ID} not found`);
  const rehomed = await prisma.fixture.updateMany({
    where: { projectId: null },
    data: { projectId: MYER_PROJECT_ID },
  });
  console.log(`re-homed ${rehomed.count} shared fixtures to the Myer project`);

  // --- summary ---------------------------------------------------------------
  const byProject = await prisma.fixture.groupBy({
    by: ['projectId'],
    _count: true,
  });
  for (const g of byProject) {
    console.log(`  ${g.projectId ?? 'SHARED'}: ${g._count} fixtures`);
  }
}

main()
  .catch((err) => {
    console.error('Cleanup failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
