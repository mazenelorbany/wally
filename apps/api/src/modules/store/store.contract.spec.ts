import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { CreateStoreSchema, UpdateStoreSchema } from './store.dto';
import { StoreService } from './store.service';

// =============================================================================
// Store directory contract — Batch 7 fixes, verified without a live DB.
//
// Covers:
//  1. projectId in-org validation: create/update reject a projectId that isn't a
//     project in the caller's org (404), accept one that is, and 400 on empty.
//  2. GET /stores/segments: returns the org's DISTINCT region/storeType/
//     areaManager values, trimmed + whitespace-collapsed + de-duped + sorted.
//  3. Segmentation normalization on write (trim + collapse internal whitespace).
//  4. deactivate/reactivate stamp/clear closedAt.
//
// Prisma is mocked at the store/project boundary the service actually touches.
// =============================================================================

const ORG = 'org_1';

function makePrisma(opts?: {
  /** project ids that exist in ORG (findFirst returns one of these). */
  projectsInOrg?: string[];
  /** rows returned by store.findMany for the segments() read. */
  segmentRows?: Array<{
    region: string | null;
    storeType: string | null;
    areaManager: string | null;
  }>;
}) {
  const projectsInOrg = new Set(opts?.projectsInOrg ?? []);
  const createData: Array<Record<string, unknown>> = [];
  const updateManyCalls: Array<Record<string, unknown>> = [];

  const prisma = {
    project: {
      findFirst: vi.fn(
        async ({ where }: { where: { id: string; orgId: string } }) =>
          where.orgId === ORG && projectsInOrg.has(where.id)
            ? { id: where.id }
            : null,
      ),
    },
    store: {
      findMany: vi.fn(async () => opts?.segmentRows ?? []),
      findFirst: vi.fn(async () => ({ id: 'store_1', orgId: ORG })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        createData.push(data);
        return { id: 'store_new', ...data };
      }),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updateManyCalls.push(data);
        return { count: 1 };
      }),
    },
  };
  return { prisma, createData, updateManyCalls };
}

describe('store directory contract', () => {
  let prisma: ReturnType<typeof makePrisma>['prisma'];
  let createData: ReturnType<typeof makePrisma>['createData'];
  let updateManyCalls: ReturnType<typeof makePrisma>['updateManyCalls'];
  let service: StoreService;

  function build(opts?: Parameters<typeof makePrisma>[0]) {
    ({ prisma, createData, updateManyCalls } = makePrisma(opts));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new StoreService(prisma as any);
  }

  beforeEach(() => build());

  describe('projectId in-org validation', () => {
    it('create rejects a projectId that is not a project in the org (404)', async () => {
      build({ projectsInOrg: [] });
      const input = CreateStoreSchema.parse({
        name: 'New Store',
        brand: 'House',
        projectId: 'proj_other_org',
      });
      await expect(service.create(ORG, input)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.store.create).not.toHaveBeenCalled();
    });

    it('create accepts a projectId that belongs to the org and writes it', async () => {
      build({ projectsInOrg: ['proj_1'] });
      const input = CreateStoreSchema.parse({
        name: 'New Store',
        brand: 'House',
        projectId: 'proj_1',
      });
      await service.create(ORG, input);
      expect(createData[0]).toMatchObject({ projectId: 'proj_1', orgId: ORG });
    });

    it('create without a projectId writes projectId: null (no validation call)', async () => {
      build({ projectsInOrg: ['proj_1'] });
      const input = CreateStoreSchema.parse({ name: 'S', brand: 'House' });
      await service.create(ORG, input);
      expect(createData[0]!.projectId).toBeNull();
      expect(prisma.project.findFirst).not.toHaveBeenCalled();
    });

    it('update with a foreign projectId is a 404 (never reaches updateMany)', async () => {
      build({ projectsInOrg: ['proj_1'] });
      const input = UpdateStoreSchema.parse({ projectId: 'proj_other' });
      await expect(
        service.update(ORG, 'store_1', input),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.store.updateMany).not.toHaveBeenCalled();
    });

    it('update with projectId: null detaches without a project lookup', async () => {
      build({ projectsInOrg: ['proj_1'] });
      const input = UpdateStoreSchema.parse({ projectId: null });
      await service.update(ORG, 'store_1', input);
      expect(prisma.project.findFirst).not.toHaveBeenCalled();
      expect(updateManyCalls[0]).toMatchObject({ projectId: null });
    });
  });

  describe('segments distinct endpoint', () => {
    it('returns trimmed, whitespace-collapsed, de-duped, sorted distinct values', async () => {
      build({
        segmentRows: [
          { region: 'NSW', storeType: 'Full line', areaManager: 'Sam' },
          { region: ' NSW ', storeType: 'Express', areaManager: 'Sam' },
          { region: 'VIC', storeType: null, areaManager: null },
          { region: 'A  C  T', storeType: 'Full line', areaManager: 'Jo' },
          { region: null, storeType: '  ', areaManager: '' },
        ],
      });
      const seg = await service.segments(ORG);
      // "NSW" and " NSW " collapse to one; blank/whitespace dropped; sorted.
      expect(seg.regions).toEqual(['A C T', 'NSW', 'VIC']);
      expect(seg.storeTypes).toEqual(['Express', 'Full line']);
      expect(seg.areaManagers).toEqual(['Jo', 'Sam']);
    });
  });

  describe('segmentation normalization on write', () => {
    it('create trims and collapses internal whitespace; empty → null', async () => {
      build({ projectsInOrg: [] });
      const input = CreateStoreSchema.parse({
        name: 'S',
        brand: 'House',
        region: '  N S  W ',
        storeType: '   ',
        areaManager: 'Sam ',
      });
      await service.create(ORG, input);
      expect(createData[0]).toMatchObject({
        region: 'N S W',
        storeType: null,
        areaManager: 'Sam',
      });
    });
  });

  describe('lifecycle', () => {
    it('deactivate stamps closedAt to a Date', async () => {
      await service.deactivate(ORG, 'store_1');
      expect(updateManyCalls[0]!.closedAt).toBeInstanceOf(Date);
    });

    it('reactivate clears closedAt to null', async () => {
      await service.reactivate(ORG, 'store_1');
      expect(updateManyCalls[0]).toMatchObject({ closedAt: null });
    });
  });

  it('an empty-string projectId is a 400 (BadRequest)', async () => {
    // Zod's .min(1) blocks empty at the DTO; the service guard is a defense-in-depth
    // backstop for a direct service call (bypassing the pipe).
    build({ projectsInOrg: [] });
    await expect(
      service.create(ORG, {
        name: 'S',
        brand: 'House',
        projectId: '   ',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
