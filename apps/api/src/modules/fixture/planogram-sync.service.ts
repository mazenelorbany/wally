import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

// =============================================================================
// PlanogramSyncService — keeps a fixture's default set (FixtureProduct) and
// every guide sheet's merchandise (Merchandise) as mirrors of each other.
//
// The library default set is the source of truth: any edit to it is pushed to
// all GuideFixtures for that fixture, and any edit on a guide sheet is first
// written back to the default set and then pushed out — so a planogram change
// made anywhere applies everywhere.
//
// Sync reconciles in place (delete missing / update drifted / create absent)
// instead of wipe-and-recreate, so row ids stay stable for clients holding
// fixtureProductIds / merchandiseIds across a mutation.
// =============================================================================

type PlanogramRow = { productId: string; row: string | null; order: number };

@Injectable()
export class PlanogramSyncService {
  constructor(private readonly prisma: PrismaService) {}

  /** Mirror the fixture's default set onto every guide sheet that uses it. */
  async pushDefaultsToGuides(orgId: string, fixtureId: string): Promise<void> {
    const [defaults, sheets] = await Promise.all([
      this.prisma.fixtureProduct.findMany({
        where: { fixtureId, orgId },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        select: { productId: true, row: true, order: true },
      }),
      this.prisma.guideFixture.findMany({
        where: { fixtureId, orgId },
        select: { id: true },
      }),
    ]);
    for (const sheet of sheets) {
      await this.reconcileSheet(orgId, sheet.id, defaults);
    }
  }

  /**
   * Adopt a guide sheet's planogram as the fixture's default set, then push it
   * to every sheet for that fixture (the source sheet reconciles to a no-op).
   */
  async pullGuideIntoDefaults(
    orgId: string,
    guideFixtureId: string,
  ): Promise<void> {
    const gf = await this.prisma.guideFixture.findFirst({
      where: { id: guideFixtureId, orgId },
      select: {
        fixtureId: true,
        merchandise: {
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
          select: { productId: true, row: true, order: true },
        },
      },
    });
    if (!gf) return;

    // FixtureProduct is unique on (fixtureId, productId); a product placed
    // twice on a sheet collapses to its first facing.
    const seen = new Set<string>();
    const rows = gf.merchandise.filter((m) =>
      seen.has(m.productId) ? false : (seen.add(m.productId), true),
    );

    const existing = await this.prisma.fixtureProduct.findMany({
      where: { fixtureId: gf.fixtureId, orgId },
      select: { id: true, productId: true, row: true, order: true },
    });
    const byProduct = new Map(existing.map((fp) => [fp.productId, fp]));
    const wanted = new Set(rows.map((r) => r.productId));

    const ops = [];
    const stale = existing.filter((fp) => !wanted.has(fp.productId));
    if (stale.length > 0) {
      ops.push(
        this.prisma.fixtureProduct.deleteMany({
          where: { id: { in: stale.map((fp) => fp.id) } },
        }),
      );
    }
    const creates = [];
    for (const r of rows) {
      const fp = byProduct.get(r.productId);
      if (!fp) {
        creates.push({
          orgId,
          fixtureId: gf.fixtureId,
          productId: r.productId,
          row: r.row,
          order: r.order,
        });
      } else if (fp.row !== r.row || fp.order !== r.order) {
        ops.push(
          this.prisma.fixtureProduct.update({
            where: { id: fp.id },
            data: { row: r.row, order: r.order },
          }),
        );
      }
    }
    if (creates.length > 0) {
      ops.push(this.prisma.fixtureProduct.createMany({ data: creates }));
    }
    if (ops.length > 0) await this.prisma.$transaction(ops);

    await this.pushDefaultsToGuides(orgId, gf.fixtureId);
  }

  /** Make one guide sheet's merchandise match the given default-set rows. */
  private async reconcileSheet(
    orgId: string,
    guideFixtureId: string,
    defaults: PlanogramRow[],
  ): Promise<void> {
    const existing = await this.prisma.merchandise.findMany({
      where: { guideFixtureId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, productId: true, row: true, order: true },
    });

    // First facing of each product survives; duplicates are pruned.
    const byProduct = new Map<string, (typeof existing)[number]>();
    const toDelete: string[] = [];
    for (const m of existing) {
      if (byProduct.has(m.productId)) toDelete.push(m.id);
      else byProduct.set(m.productId, m);
    }
    const wanted = new Set(defaults.map((d) => d.productId));
    for (const m of byProduct.values()) {
      if (!wanted.has(m.productId)) toDelete.push(m.id);
    }

    const ops = [];
    if (toDelete.length > 0) {
      ops.push(
        this.prisma.merchandise.deleteMany({
          where: { id: { in: toDelete } },
        }),
      );
    }
    const creates = [];
    for (const d of defaults) {
      const m = byProduct.get(d.productId);
      if (!m) {
        creates.push({
          orgId,
          guideFixtureId,
          productId: d.productId,
          row: d.row,
          order: d.order,
        });
      } else if (m.row !== d.row || m.order !== d.order) {
        ops.push(
          this.prisma.merchandise.update({
            where: { id: m.id },
            data: { row: d.row, order: d.order },
          }),
        );
      }
    }
    if (creates.length > 0) {
      ops.push(this.prisma.merchandise.createMany({ data: creates }));
    }
    if (ops.length > 0) await this.prisma.$transaction(ops);
  }
}
