// =============================================================================
// migrate-myer-merch — re-home the Myer planogram onto the real floor-plan
// fixtures imported by seed-restore-myer.ts.
//
// WHY: seed-restore-myer rebuilt every Myer store's floor plan against the REAL
// ReStore fixture taxonomy (Appliance Stand, Display Tables, Vm Table, …) and
// re-pointed all placements at those new fixtures — but it never moved the
// existing Merchandise rows off the original demo fixtures (VM TABLE 1/2/3,
// COOKSET BULKSTACK, ELECTRICAL STAND 1, FRY WALL BAY 01). The Sales Log joins
// placements ↔ guide-fixtures by fixtureId, so with the planogram stranded on
// fixtures no store is placed on, "Log Sales" renders empty for every Myer
// store. This moves each product onto the new fixture it belongs to.
//
// Mapping (confirmed with the owner — there is NO canonical old→new map in the
// data; the new set is a different real-world taxonomy, not renames):
//   VM TABLE 1 (Le Connoisseur)      → Vm Table
//   VM TABLE 2 (NOOK)                → Display Tables
//   VM TABLE 3 (iD3 cookset/loose)   → Display Tables
//   COOKSET BULKSTACK                → The Cookshop Bulk Stack
//   FRY WALL BAY 01                  → The Cookshop Bulk Stack
//   ELECTRICAL STAND 1               → Appliance Stand 1
//   (TCC WALL BAY 1 is empty — nothing to move)
//
// Scope: ONLY the Myer guide campaign (MSP2-2026). Resolves fixtures by their
// org-unique name, so it is deterministic. Idempotent: after a run the old
// guide-fixtures hold 0 merchandise, so a re-run moves nothing. When a product
// would land twice on the same target (e.g. it sat on both VM TABLE 2 and 3),
// the duplicate is dropped so each product appears once per fixture.
//
// Dry run (prints the plan, writes nothing):   DRY_RUN=1 tsx prisma/migrate-myer-merch.ts
// Apply:                                                  tsx prisma/migrate-myer-merch.ts
// =============================================================================

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const __envPath = join(__dirname, '..', '.env');
if (!process.env.DATABASE_URL && existsSync(__envPath) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(__envPath);
}
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (copy apps/api/.env.example).`);
  return v;
}

const DRY_RUN = !!process.env.DRY_RUN;
const CAMPAIGN_KEY = 'MSP2-2026';

// old fixture name → new fixture name (both org-unique).
const MAPPING: Array<[string, string]> = [
  ['VM TABLE 1', 'Vm Table'],
  ['VM TABLE 2', 'Display Tables'],
  ['VM TABLE 3', 'Display Tables'],
  ['COOKSET BULKSTACK', 'The Cookshop Bulk Stack'],
  ['FRY WALL BAY 01', 'The Cookshop Bulk Stack'],
  ['ELECTRICAL STAND 1', 'Appliance Stand 1'],
];

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: requireEnv('DATABASE_URL') }),
});

async function main(): Promise<void> {
  const campaign = await prisma.campaign.findFirst({
    where: { key: CAMPAIGN_KEY },
    select: { id: true, orgId: true, name: true },
  });
  if (!campaign) throw new Error(`Campaign ${CAMPAIGN_KEY} not found.`);
  const { id: campaignId, orgId } = campaign;
  console.log(`Campaign: ${campaign.name} (${campaignId})\n`);

  // Resolve every fixture named in the mapping → its guide-fixture in this
  // campaign. Target guide-fixtures are upserted so the move always has a home.
  const guideFixtureIdByName = new Map<string, string>();
  const targetNames = new Set(MAPPING.map(([, to]) => to));
  for (const name of new Set(MAPPING.flat())) {
    const fixture = await prisma.fixture.findFirst({
      where: { orgId, name },
      select: { id: true },
    });
    if (!fixture) {
      if (targetNames.has(name)) throw new Error(`Target fixture "${name}" not found.`);
      console.log(`  · source fixture "${name}" missing — skipping`);
      continue;
    }
    let gf = await prisma.guideFixture.findUnique({
      where: { campaignId_fixtureId: { campaignId, fixtureId: fixture.id } },
      select: { id: true },
    });
    if (!gf && targetNames.has(name) && !DRY_RUN) {
      gf = await prisma.guideFixture.create({
        data: { orgId, campaignId, fixtureId: fixture.id },
        select: { id: true },
      });
    }
    if (gf) guideFixtureIdByName.set(name, gf.id);
  }

  // Build the plan: which merchandise rows move where.
  type Move = { from: string; to: string; toGf: string; productId: string; merchId: string; row: string | null };
  const moves: Move[] = [];
  const targetProductSeen = new Map<string, Set<string>>(); // toGf → productIds kept
  const dropped: Array<{ product: string; from: string; to: string }> = [];

  for (const [fromName, toName] of MAPPING) {
    const fromGf = guideFixtureIdByName.get(fromName);
    const toGf = guideFixtureIdByName.get(toName);
    if (!fromGf || !toGf) continue;
    const merch = await prisma.merchandise.findMany({
      where: { guideFixtureId: fromGf },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, productId: true, row: true, product: { select: { sku: true } } },
    });
    let seen = targetProductSeen.get(toGf);
    if (!seen) {
      // Pre-load products already on the target so we never duplicate.
      const existing = await prisma.merchandise.findMany({
        where: { guideFixtureId: toGf },
        select: { productId: true },
      });
      seen = new Set(existing.map((m) => m.productId));
      targetProductSeen.set(toGf, seen);
    }
    for (const m of merch) {
      if (seen.has(m.productId)) {
        dropped.push({ product: m.product.sku, from: fromName, to: toName });
        continue;
      }
      seen.add(m.productId);
      moves.push({ from: fromName, to: toName, toGf, productId: m.productId, merchId: m.id, row: m.row });
    }
  }

  // Report the plan.
  const byTarget = new Map<string, number>();
  for (const mv of moves) byTarget.set(mv.to, (byTarget.get(mv.to) ?? 0) + 1);
  console.log(`Plan — ${moves.length} merchandise rows to move:`);
  for (const [to, n] of byTarget) console.log(`  → ${to}: ${n}`);
  if (dropped.length) {
    console.log(`\n  ${dropped.length} duplicate(s) dropped (product already on target):`);
    for (const d of dropped) console.log(`    · ${d.product} (${d.from} → ${d.to})`);
  }

  if (DRY_RUN) {
    console.log('\nDRY_RUN=1 — no writes performed.');
    return;
  }

  // Apply atomically. Re-base `order` per target so merged fixtures stay stable.
  await prisma.$transaction(async (tx) => {
    const orderByTarget = new Map<string, number>();
    for (const mv of moves) {
      const next = orderByTarget.get(mv.toGf) ?? 0;
      orderByTarget.set(mv.toGf, next + 1);
      await tx.merchandise.update({
        where: { id: mv.merchId },
        data: { guideFixtureId: mv.toGf, order: next },
      });
    }
    // Delete duplicates we chose not to move (they'd otherwise stay orphaned on
    // the old fixture and resurface if the old fixture were ever re-placed).
    if (dropped.length) {
      // dropped rows are still on their old guide-fixture; remove them.
      // Re-resolve their ids: anything left on a source GF after the moves.
      for (const [fromName] of MAPPING) {
        const fromGf = guideFixtureIdByName.get(fromName);
        if (!fromGf) continue;
        await tx.merchandise.deleteMany({ where: { guideFixtureId: fromGf } });
      }
    }
  });
  console.log(`\nApplied: moved ${moves.length} rows.`);

  // Verify against both Adelaide stores (the reported symptom).
  await verify(orgId, campaignId);
}

async function verify(orgId: string, campaignId: string): Promise<void> {
  const stores = await prisma.store.findMany({
    where: { orgId, name: { contains: 'Adelaide City Myer' } },
    select: { id: true, name: true },
  });
  const gfs = await prisma.guideFixture.findMany({
    where: { orgId, campaignId },
    include: { _count: { select: { merchandise: true } } },
  });
  const merchByFixture = new Map(gfs.map((g) => [g.fixtureId, g._count.merchandise]));
  console.log('\nVerification:');
  for (const s of stores) {
    const placements = await prisma.placement.findMany({
      where: { storeId: s.id, campaignId, applicable: true },
      select: { fixtureId: true },
    });
    const loggable = placements.reduce((sum, p) => sum + (merchByFixture.get(p.fixtureId) ?? 0), 0);
    console.log(`  ${s.name}: ${loggable} products now loggable across ${placements.length} fixtures`);
  }
}

main()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
