// =============================================================================
// Backfill: FixtureCapturePhoto from existing single-photo captures.
// =============================================================================
//
// Run from apps/api (after the schema migration, BEFORE the new append-based
// upload path goes live):
//
//   tsx prisma/scripts/backfill-capture-photos.ts
//
// Multi-photo support adds a FixtureCapturePhoto gallery child to FixtureCapture
// while keeping FixtureCapture.storageKey as the COVER pointer. Pre-existing
// captures have a storageKey but no photo rows; this gives each one a single
// order=0 cover row so the invariant (storageKey === photos[order=0]) holds for
// legacy data and the gallery UI has something to show.
//
// Idempotent: skips any capture that already has at least one photo row, so it is
// safe to re-run.
// =============================================================================

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

// tsx does not auto-load .env — mirror prisma.config.ts / seed.ts.
const envPath = join(__dirname, '..', '..', '.env');
if (!process.env.DATABASE_URL && existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envPath);
}

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set (export it or add apps/api/.env)');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

async function main(): Promise<void> {
  // Captures that have a photo to backfill.
  const captures = await prisma.fixtureCapture.findMany({
    where: { storageKey: { not: null } },
    select: { id: true, orgId: true, storageKey: true, uploadedAt: true, createdAt: true },
  });

  let created = 0;
  let skipped = 0;
  for (const c of captures) {
    const existing = await prisma.fixtureCapturePhoto.count({ where: { captureId: c.id } });
    if (existing > 0) {
      skipped += 1;
      continue;
    }
    await prisma.fixtureCapturePhoto.create({
      data: {
        orgId: c.orgId,
        captureId: c.id,
        storageKey: c.storageKey!,
        order: 0,
        uploadedAt: c.uploadedAt ?? c.createdAt,
      },
    });
    created += 1;
  }

  console.log(
    `Backfill complete — ${captures.length} captures with a photo: ${created} cover rows created, ${skipped} already had photos.`,
  );
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
