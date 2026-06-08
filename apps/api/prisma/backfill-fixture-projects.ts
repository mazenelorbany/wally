// One-off backfill: assign every existing Fixture to a project now that the
// library is project-scoped (Fixture.projectId; null = shared across projects).
//
// Rules (idempotent — safe to re-run):
//   • Derive the project a fixture touches from its placements (store.projectId)
//     and guide sheets (campaign.projectId).
//   • Exactly one project  → own it there.
//   • No project (unplaced) → "Ambiente …" names → Ambiente; everything else
//     → Myer (every unplaced fixture in this org is a Myer/TCC library entry).
//   • More than one project → home it to Myer if Myer is one of them (else the
//     first), and DROP its placements on the other project's stores — this is
//     the "VM TABLE 1 → Myer, drop the Ambiente placement" decision.
//
// After this, no fixture is left shared (projectId null); sharing is opt-in
// going forward via the Add/Edit dialog.
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const __envPath = join(__dirname, '..', '.env');
if (
  !process.env.DATABASE_URL &&
  existsSync(__envPath) &&
  typeof process.loadEnvFile === 'function'
) {
  process.loadEnvFile(__envPath);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const MYER_PROJECT_ID = 'seed-project-myer';
const AMBIENTE_PROJECT_ID = 'seed-project-ambiente';

async function main() {
  const projects = await prisma.project.findMany({
    select: { id: true, name: true },
  });
  const pName = new Map(projects.map((p) => [p.id, p.name]));
  const myer = projects.find((p) => p.id === MYER_PROJECT_ID);
  if (!myer) throw new Error('Myer project not found — run the main seed first.');

  const fixtures = await prisma.fixture.findMany({
    where: { archivedAt: null },
    select: {
      id: true,
      name: true,
      projectId: true,
      placements: { select: { id: true, store: { select: { projectId: true } } } },
      guideFixtures: { select: { campaign: { select: { projectId: true } } } },
    },
    orderBy: { name: 'asc' },
  });

  let assigned = 0;
  let droppedPlacements = 0;
  let unchanged = 0;

  for (const f of fixtures) {
    const touched = new Set<string>();
    for (const p of f.placements) if (p.store.projectId) touched.add(p.store.projectId);
    for (const g of f.guideFixtures)
      if (g.campaign.projectId) touched.add(g.campaign.projectId);

    let target: string;
    if (touched.size === 1) {
      target = [...touched][0];
    } else if (touched.size === 0) {
      target = f.name.startsWith('Ambiente') ? AMBIENTE_PROJECT_ID : MYER_PROJECT_ID;
    } else {
      // Multi-project: home to Myer when present, else the first project.
      target = touched.has(MYER_PROJECT_ID) ? MYER_PROJECT_ID : [...touched][0];
      // Drop placements that live in a different project (the stray ones).
      const stray = f.placements.filter(
        (p) => p.store.projectId && p.store.projectId !== target,
      );
      if (stray.length) {
        await prisma.placement.deleteMany({
          where: { id: { in: stray.map((p) => p.id) } },
        });
        droppedPlacements += stray.length;
        console.log(
          `  drop ${stray.length} placement(s) on ${[
            ...new Set(stray.map((p) => pName.get(p.store.projectId!) ?? p.store.projectId)),
          ].join(', ')} for "${f.name}"`,
        );
      }
    }

    if (f.projectId === target) {
      unchanged++;
      continue;
    }
    await prisma.fixture.update({ where: { id: f.id }, data: { projectId: target } });
    assigned++;
    console.log(`  ${f.name} → ${pName.get(target) ?? target}`);
  }

  const byProject = await prisma.fixture.groupBy({
    by: ['projectId'],
    where: { archivedAt: null },
    _count: true,
  });
  console.log('\nDone.');
  console.log(`  assigned: ${assigned}, unchanged: ${unchanged}, dropped placements: ${droppedPlacements}`);
  for (const row of byProject) {
    console.log(`  ${row.projectId ? pName.get(row.projectId) ?? row.projectId : 'SHARED (null)'}: ${row._count}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
