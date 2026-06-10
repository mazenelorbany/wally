import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PlanogramSyncService } from './planogram-sync.service';

// =============================================================================
// PlanogramSyncService contract — the mirror invariant behind "edit anywhere,
// applies everywhere":
//   1. pushDefaultsToGuides reconciles every guide sheet to the fixture's
//      default set: stale facings deleted, drifted (row/order) updated, missing
//      created — and never wipe-and-recreates rows that already match (ids must
//      stay stable for clients holding merchandiseIds).
//   2. pullGuideIntoDefaults adopts a sheet's planogram as the default set
//      (deduping repeated products — the default set is unique per product)
//      and then pushes it back out to all sheets.
// Prisma is mocked at the method boundary (mirrors product.service.spec.ts).
// =============================================================================

const ORG = 'org_1';
const FIXTURE = 'fix_1';
const SHEET = 'gf_1';
const SIBLING = 'gf_2';

function makePrisma() {
  return {
    fixtureProduct: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
      update: vi.fn(async () => ({})),
    },
    guideFixture: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
    },
    merchandise: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
      update: vi.fn(async () => ({})),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

describe('PlanogramSyncService mirror contract', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: PlanogramSyncService;

  beforeEach(() => {
    prisma = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new PlanogramSyncService(prisma as any);
  });

  it('pushDefaultsToGuides deletes stale, updates drifted, creates missing — leaves matches alone', async () => {
    prisma.fixtureProduct.findMany.mockResolvedValueOnce([
      { productId: 'p1', row: 'Top', order: 0 }, // matches → untouched
      { productId: 'p2', row: 'Top', order: 1 }, // drifted on sheet → update
      { productId: 'p3', row: 'Mid', order: 1000 }, // absent on sheet → create
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    prisma.guideFixture.findMany.mockResolvedValueOnce([
      { id: SHEET },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    prisma.merchandise.findMany.mockResolvedValueOnce([
      { id: 'm1', productId: 'p1', row: 'Top', order: 0 },
      { id: 'm2', productId: 'p2', row: 'Bottom', order: 7 },
      { id: 'm4', productId: 'p4', row: 'Top', order: 2 }, // not in defaults → delete
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    await service.pushDefaultsToGuides(ORG, FIXTURE);

    expect(prisma.merchandise.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['m4'] } },
    });
    expect(prisma.merchandise.update).toHaveBeenCalledWith({
      where: { id: 'm2' },
      data: { row: 'Top', order: 1 },
    });
    expect(prisma.merchandise.update).toHaveBeenCalledTimes(1); // m1 untouched
    expect(prisma.merchandise.createMany).toHaveBeenCalledWith({
      data: [
        {
          orgId: ORG,
          guideFixtureId: SHEET,
          productId: 'p3',
          row: 'Mid',
          order: 1000,
        },
      ],
    });
  });

  it('pushDefaultsToGuides with an empty, already-matching sheet is a no-op', async () => {
    prisma.fixtureProduct.findMany.mockResolvedValueOnce([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.guideFixture.findMany.mockResolvedValueOnce([{ id: SHEET }] as any);
    prisma.merchandise.findMany.mockResolvedValueOnce([]);

    await service.pushDefaultsToGuides(ORG, FIXTURE);

    expect(prisma.merchandise.deleteMany).not.toHaveBeenCalled();
    expect(prisma.merchandise.createMany).not.toHaveBeenCalled();
    expect(prisma.merchandise.update).not.toHaveBeenCalled();
  });

  it('pullGuideIntoDefaults adopts the sheet (deduped) as the default set, then mirrors to all sheets', async () => {
    prisma.guideFixture.findFirst.mockResolvedValueOnce({
      fixtureId: FIXTURE,
      merchandise: [
        { productId: 'p1', row: 'Top', order: 0 },
        { productId: 'p1', row: 'Top', order: 1 }, // dup → collapses to first
        { productId: 'p2', row: 'Mid', order: 1000 },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // current defaults: p1 matches, p9 is stale
    prisma.fixtureProduct.findMany
      .mockResolvedValueOnce([
        { id: 'fp1', productId: 'p1', row: 'Top', order: 0 },
        { id: 'fp9', productId: 'p9', row: 'Old', order: 5 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any)
      // re-read inside the push step: the adopted default set
      .mockResolvedValueOnce([
        { productId: 'p1', row: 'Top', order: 0 },
        { productId: 'p2', row: 'Mid', order: 1000 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any);
    prisma.guideFixture.findMany.mockResolvedValueOnce([
      { id: SHEET },
      { id: SIBLING },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    // source sheet already matches; sibling is empty → gets both products
    prisma.merchandise.findMany
      .mockResolvedValueOnce([
        { id: 'm1', productId: 'p1', row: 'Top', order: 0 },
        { id: 'm2', productId: 'p2', row: 'Mid', order: 1000 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any)
      .mockResolvedValueOnce([]);

    await service.pullGuideIntoDefaults(ORG, SHEET);

    expect(prisma.fixtureProduct.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['fp9'] } },
    });
    expect(prisma.fixtureProduct.createMany).toHaveBeenCalledWith({
      data: [
        {
          orgId: ORG,
          fixtureId: FIXTURE,
          productId: 'p2',
          row: 'Mid',
          order: 1000,
        },
      ],
    });
    // the sibling sheet was mirrored too
    expect(prisma.merchandise.createMany).toHaveBeenCalledWith({
      data: [
        {
          orgId: ORG,
          guideFixtureId: SIBLING,
          productId: 'p1',
          row: 'Top',
          order: 0,
        },
        {
          orgId: ORG,
          guideFixtureId: SIBLING,
          productId: 'p2',
          row: 'Mid',
          order: 1000,
        },
      ],
    });
  });

  it('pullGuideIntoDefaults on an unknown / foreign sheet is a silent no-op', async () => {
    prisma.guideFixture.findFirst.mockResolvedValueOnce(null);
    await service.pullGuideIntoDefaults(ORG, 'gf_other_org');
    expect(prisma.fixtureProduct.deleteMany).not.toHaveBeenCalled();
    expect(prisma.fixtureProduct.createMany).not.toHaveBeenCalled();
  });
});
