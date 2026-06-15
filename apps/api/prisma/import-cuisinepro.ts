// =============================================================================
// Cuisine::pro catalog import — replaces the org's product catalog wholesale.
// =============================================================================
//
// Run from apps/api:   pnpm exec tsx prisma/import-cuisinepro.ts
//
// Source: prisma/seed-data/cuisinepro-catalog.json, extracted from the
// Cuisine::pro Master Catalog v10 xlsx (Pricing + Web Copy tabs). Per SKU:
//   - name        = Pricing "Product Name" (the VM label)
//   - webTitle    = Web Copy "Product Title" (full retail title)
//   - rrp         = USD MSRP, salePrice = USD MAP (cuisinepro.com pricing;
//                   CAD columns are kept in the JSON but not imported)
//   - saleWave    = SALE_1 / SALE_2 / BOTH from the "Sale 1"/"Sale 2" promo
//                   flags (ON PROMO vs FULL RRP); null = never on promo
//   - imageUrl    = the Shopify CDN main image from the Web Copy =IMAGE() formula
//
// DESTRUCTIVE: deletes every existing product in the org first. Product
// deletes cascade to Merchandise, FixtureProduct, and SalesEntry — guide
// placements and logged sales for the old catalog are removed with it.
//
// Verified-data rule: rows with no price in the Pricing tab (3 Stone X² SKUs)
// import with rrp/salePrice null rather than invented values; 7001236 has no
// image in any local export (known catalog gap) and imports without one.
// =============================================================================

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const ORG_SLUG = process.env.WALLY_ORG_SLUG ?? 'grb';
const CATALOG_JSON = join(__dirname, 'seed-data', 'cuisinepro-catalog.json');

interface CatalogRow {
  sku: string;
  name: string | null;
  range: string | null;
  category: string | null;
  class: string | null;
  usdMsrp: number | null;
  usdMap: number | null;
  cadMsrp: number | null;
  cadMap: number | null;
  saleWave: 'SALE_1' | 'SALE_2' | 'BOTH' | null;
  webTitle: string | null;
  imageUrl: string | null;
}

// tsx does not auto-load .env. Load apps/api/.env ourselves (mirrors seed.ts).
const __envPath = join(__dirname, '..', '.env');
if (
  !process.env.DATABASE_URL &&
  existsSync(__envPath) &&
  typeof process.loadEnvFile === 'function'
) {
  process.loadEnvFile(__envPath);
}

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set — export it or fill apps/api/.env');
}
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url }),
});

async function main(): Promise<void> {
  const rows = JSON.parse(readFileSync(CATALOG_JSON, 'utf8')) as CatalogRow[];

  const org = await prisma.org.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`org "${ORG_SLUG}" not found`);

  const removed = await prisma.product.deleteMany({
    where: { orgId: org.id },
  });

  const created = await prisma.product.createMany({
    data: rows
      .filter((r) => r.sku && r.name)
      .map((r) => ({
        orgId: org.id,
        sku: r.sku,
        name: r.name as string,
        webTitle: r.webTitle,
        brand: 'Cuisine::pro',
        range: r.range,
        category: r.category,
        imageUrl: r.imageUrl,
        rrp: r.usdMsrp,
        salePrice: r.usdMap,
        saleWave: r.saleWave,
        gwp: false,
      })),
  });

  const waves = await prisma.product.groupBy({
    by: ['saleWave'],
    where: { orgId: org.id },
    _count: true,
  });
  console.log(
    `org "${ORG_SLUG}": removed ${removed.count} products, imported ${created.count}`,
  );
  for (const w of waves) {
    console.log(`  saleWave=${w.saleWave ?? 'none'}: ${w._count}`);
  }
  const unpriced = await prisma.product.count({
    where: { orgId: org.id, rrp: null },
  });
  const noImage = await prisma.product.count({
    where: { orgId: org.id, imageUrl: null },
  });
  console.log(`  without price: ${unpriced}, without image: ${noImage}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
