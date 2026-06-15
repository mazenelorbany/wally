import { describe, it, expect, vi } from 'vitest';

import { resolveActiveRubric } from './rubric.resolve';
import { RubricService } from './rubric.service';

// =============================================================================
// Rubric versioning contract — Batch 9b.
//
// Two guarantees, verified without a live DB (Prisma mocked at the model
// boundary, per review.contract.spec.ts):
//
//   (a) ACTIVE-version resolution + fallback. The scorer/API grade against the
//       version flagged active, and fall back to the HIGHEST version when none is
//       flagged (legacy/seeded rows are all active=false) — so existing data
//       keeps grading with no migration.
//
//   (b) referenceKey CARRY-FORWARD. Publishing a new version without a
//       referenceKey inherits the previous version's key (so "Edit → new version"
//       never silently drops the reference the scorer compares against), while an
//       explicit null clears it and a string replaces it. The new row is also
//       flagged active and its siblings cleared.
// =============================================================================

const CAMPAIGN = 'camp_1';
const FIXTURE = 'storefront';

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: `r_${over.version ?? 1}`,
    orgId: 'org_1',
    campaignId: CAMPAIGN,
    fixtureId: 'fix_1',
    fixtureKey: FIXTURE,
    version: 1,
    criteria: [],
    rollupRule: {},
    referenceKey: null,
    active: false,
    createdAt: new Date(),
    ...over,
  };
}

describe('resolveActiveRubric (active pointer + highest-version fallback)', () => {
  it('returns the version flagged active, even if a higher version exists', async () => {
    const v1 = row({ version: 1, active: true, id: 'r1' });
    const v2 = row({ version: 2, active: false, id: 'r2' });
    const prisma = {
      rubric: {
        findFirst: vi.fn(
          async ({ where }: { where: Record<string, unknown> }) => {
            // The resolver asks for active:true first.
            if (where.active === true) return v1;
            // …then (only if that missed) the highest version.
            return v2;
          },
        ),
      },
    };

    const r = await resolveActiveRubric(prisma, {
      campaignId: CAMPAIGN,
      fixtureKey: FIXTURE,
    });
    expect(r?.id).toBe('r1');
    expect(r?.version).toBe(1);
  });

  it('falls back to the HIGHEST version when no row is active (legacy data)', async () => {
    const v3 = row({ version: 3, active: false, id: 'r3' });
    const prisma = {
      rubric: {
        findFirst: vi.fn(
          async ({ where }: { where: Record<string, unknown> }) => {
            if (where.active === true) return null; // nothing flagged active
            return v3; // highest version
          },
        ),
      },
    };

    const r = await resolveActiveRubric(prisma, {
      campaignId: CAMPAIGN,
      fixtureKey: FIXTURE,
    });
    expect(r?.id).toBe('r3');
    expect(r?.version).toBe(3);
    // Two queries: the active probe, then the highest-version fallback.
    expect(prisma.rubric.findFirst).toHaveBeenCalledTimes(2);
  });

  it('returns null when the fixture has no rubric at all', async () => {
    const prisma = { rubric: { findFirst: vi.fn(async () => null) } };
    const r = await resolveActiveRubric(prisma, {
      campaignId: CAMPAIGN,
      fixtureKey: FIXTURE,
    });
    expect(r).toBeNull();
  });
});

/**
 * A Prisma double for RubricService.publish: captures the create() data and the
 * updateMany() that deactivates siblings. $transaction runs the callback with the
 * same tx double (the service only touches tx.rubric).
 */
function makePublishPrisma(previous: ReturnType<typeof row> | null) {
  const created: Array<Record<string, unknown>> = [];
  const deactivations: Array<Record<string, unknown>> = [];
  const tx = {
    rubric: {
      findFirst: vi.fn(async () => previous),
      updateMany: vi.fn(async (args: Record<string, unknown>) => {
        deactivations.push(args);
        return { count: previous ? 1 : 0 };
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const r = { id: `created_${created.length + 1}`, createdAt: new Date(), ...data };
        created.push(r);
        return r;
      }),
    },
  };
  const prisma = {
    campaign: {
      findFirst: vi.fn(async () => ({ id: CAMPAIGN, key: 'MSP2-2026' })),
    },
    fixture: {
      findFirst: vi.fn(async () => ({ id: 'fix_1', name: 'Storefront', kind: 'bay' })),
    },
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  return { prisma, tx, created, deactivations };
}

// StorageService double — publish() only uses signedGetUrl (in present()).
const storageStub = {
  signedGetUrl: (k: string) => `/photos/blob/signed(${k})`,
} as unknown as ConstructorParameters<typeof RubricService>[1];

describe('RubricService.publish (referenceKey carry-forward + active flip)', () => {
  const baseInput = {
    fixtureId: 'fix_1',
    criteria: [{ id: 'c1', kind: 'presence' as const, critical: true, text: 'built' }],
    rollupRule: {
      not_good_if_any_critical_fails: true,
      good_if_only_noncritical_fails: true,
    },
  };

  it('carries forward the previous version reference when referenceKey is omitted', async () => {
    const prev = row({ version: 2, referenceKey: 'ref/old.jpg', active: true });
    const { prisma, created } = makePublishPrisma(prev);
    const service = new RubricService(prisma as never, storageStub);

    const result = await service.publish('org_1', CAMPAIGN, { ...baseInput });

    // New version is prev+1, inherits the old reference, and is active.
    expect(created[0]).toMatchObject({
      version: 3,
      referenceKey: 'ref/old.jpg',
      active: true,
    });
    expect(result.referenceKey).toBe('ref/old.jpg');
    expect(result.active).toBe(true);
  });

  it('clears the reference when referenceKey is explicitly null', async () => {
    const prev = row({ version: 1, referenceKey: 'ref/old.jpg', active: true });
    const { prisma, created } = makePublishPrisma(prev);
    const service = new RubricService(prisma as never, storageStub);

    await service.publish('org_1', CAMPAIGN, { ...baseInput, referenceKey: null });

    expect(created[0]).toMatchObject({ version: 2, referenceKey: null });
  });

  it('replaces the reference when a new key is provided', async () => {
    const prev = row({ version: 1, referenceKey: 'ref/old.jpg', active: true });
    const { prisma, created } = makePublishPrisma(prev);
    const service = new RubricService(prisma as never, storageStub);

    await service.publish('org_1', CAMPAIGN, {
      ...baseInput,
      referenceKey: 'ref/new.jpg',
    });

    expect(created[0]).toMatchObject({ version: 2, referenceKey: 'ref/new.jpg' });
  });

  it('deactivates existing active siblings and flags the new row active', async () => {
    const prev = row({ version: 1, active: true });
    const { prisma, created, deactivations } = makePublishPrisma(prev);
    const service = new RubricService(prisma as never, storageStub);

    await service.publish('org_1', CAMPAIGN, { ...baseInput });

    // Siblings of this pair were cleared before the new active row was created.
    expect(deactivations[0]).toMatchObject({
      where: { campaignId: CAMPAIGN, fixtureId: 'fix_1', active: true },
      data: { active: false },
    });
    expect(created[0]).toMatchObject({ active: true });
  });

  it('the very first publish (no previous version) starts at v1 with no reference', async () => {
    const { prisma, created } = makePublishPrisma(null);
    const service = new RubricService(prisma as never, storageStub);

    await service.publish('org_1', CAMPAIGN, { ...baseInput });

    expect(created[0]).toMatchObject({ version: 1, referenceKey: null, active: true });
  });
});
