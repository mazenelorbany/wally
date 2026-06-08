// =============================================================================
// relayout-myer-floor — restyle EXISTING Myer placements into a real layout.
// =============================================================================
//
// The Myer concession floor maps were seeded as a uniform `i % 4` grid. This
// one-shot script rewrites each placement's geometry (x/y/w/h/rotation) to the
// believable department layout in floor-layout.ts, IN PLACE — it only UPDATEs
// Placement rows, so captures, submissions, scores and every other bit of demo
// state are preserved (unlike a full reseed).
//
// Scoped to the Myer campaign (key MSP2-2026) so the GRB store's hand-designed
// floor plan (seed.ts → floorPlanFor) is never touched. Idempotent: re-running
// just re-applies the same slots.
//
// Run:  pnpm --filter @wally/api exec tsx prisma/relayout-myer-floor.ts
// =============================================================================

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { layoutFor } from './floor-layout';

const CAMPAIGN_KEY = 'MSP2-2026';

// Load apps/api/.env so DATABASE_URL is present (same mechanism as the seeds).
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

async function main(): Promise<void> {
  const campaigns = await prisma.campaign.findMany({
    where: { key: CAMPAIGN_KEY },
    select: { id: true },
  });
  if (campaigns.length === 0) {
    throw new Error(`No campaign with key ${CAMPAIGN_KEY} — run the Myer seed first.`);
  }

  let updated = 0;
  let stores = 0;
  for (const c of campaigns) {
    const placements = await prisma.placement.findMany({
      where: { campaignId: c.id },
      orderBy: [{ storeId: 'asc' }, { order: 'asc' }, { id: 'asc' }],
      select: { id: true, storeId: true },
    });

    // Group by store so each store's fixtures get a full layout in placement order.
    const byStore = new Map<string, string[]>();
    for (const p of placements) {
      const list = byStore.get(p.storeId) ?? [];
      list.push(p.id);
      byStore.set(p.storeId, list);
    }

    for (const [, ids] of byStore) {
      const slots = layoutFor(ids.length);
      for (let i = 0; i < ids.length; i++) {
        const s = slots[i]!;
        await prisma.placement.update({
          where: { id: ids[i]! },
          data: { x: s.x, y: s.y, w: s.w, h: s.h, rotation: s.rotation ?? 0 },
        });
        updated++;
      }
      stores++;
    }
  }

  console.log(
    `relayout: updated ${updated} placements across ${stores} store(s) in ${campaigns.length} campaign(s) [${CAMPAIGN_KEY}]`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
