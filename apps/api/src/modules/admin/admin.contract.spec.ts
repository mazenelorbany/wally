import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { CampaignStatus, CaptureVerdict, Prisma, Role } from '@prisma/client';
import type { SessionUser } from '@wally/types';

import { AdminService } from './admin.service';
import { ChaseService } from '../jobs/chase.service';

// =============================================================================
// Batch 8 — user-delete + chase-opt-out contracts (Prisma mocked; no live DB).
//
// (a) deleteUser refuses to remove the org's LAST active admin — proving the
//     hard-delete path reuses assertNotLastActiveAdmin and the self-delete guard.
// (b) ChaseService scopes its recipient query by `chaseEmails: true` (and active
//     users), so an admin/reviewer who opted out is never emailed.
//
// Batch 11d-2 — ChaseService MIGRATED off the legacy Submission pipeline onto the
// live FixtureCapture+Placement loop. "Behind" is now computed from applicable
// Placements vs. their FixtureCapture (photo + no needsPhoto + effective verdict
// PASS = satisfied). The recipient filter (chaseEmails/disabledAt) and the
// active-store filter (closedAt: null) are preserved against the new source.
// =============================================================================

const ORG = 'org_1';
const ADMIN_ID = 'user_admin';

function admin(): SessionUser {
  return {
    id: ADMIN_ID,
    orgId: ORG,
    email: 'admin@grb.com',
    name: 'Admin',
    role: 'ADMIN',
    storeId: null,
  } as SessionUser;
}

describe('AdminService.deleteUser — last-admin + self guards', () => {
  let userDelete: ReturnType<typeof vi.fn>;
  let userCount: ReturnType<typeof vi.fn>;
  let service: AdminService;
  let target: { id: string; role: Role; disabledAt: Date | null };

  beforeEach(() => {
    target = { id: 'user_target', role: Role.ADMIN, disabledAt: null };
    userDelete = vi.fn(async () => target);
    // No OTHER active admin remains → the guard must fire.
    userCount = vi.fn(async () => 0);
    const prisma = {
      user: {
        findFirst: vi.fn(async () => target),
        delete: userDelete,
        count: userCount,
      },
    };
    // auth is unused by deleteUser.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new AdminService(prisma as any, {} as any);
  });

  it('refuses to delete the org’s last active admin (409, no delete)', async () => {
    await expect(service.deleteUser(admin(), 'user_target')).rejects.toThrow(
      ConflictException,
    );
    expect(userCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: ORG,
          role: Role.ADMIN,
          disabledAt: null,
          id: { not: 'user_target' },
        }),
      }),
    );
    expect(userDelete).not.toHaveBeenCalled();
  });

  it('deletes a non-last admin when another active admin remains', async () => {
    userCount.mockResolvedValueOnce(1); // another active admin exists
    await expect(
      service.deleteUser(admin(), 'user_target'),
    ).resolves.toBeUndefined();
    expect(userDelete).toHaveBeenCalledWith({ where: { id: 'user_target' } });
  });

  it('blocks deleting your own account (403) before touching the DB', async () => {
    await expect(service.deleteUser(admin(), ADMIN_ID)).rejects.toThrow(
      ForbiddenException,
    );
    expect(userDelete).not.toHaveBeenCalled();
  });

  it('maps a Review FK constraint (P2003) to a clear 409', async () => {
    target.role = Role.REVIEWER; // not an admin → skips the last-admin guard
    userDelete.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('FK', {
        code: 'P2003',
        clientVersion: 'x',
      }),
    );
    await expect(service.deleteUser(admin(), 'user_target')).rejects.toThrow(
      ConflictException,
    );
  });
});

// One ACTIVE campaign row the chase sweep walks. `users` is the org's recipient
// list (filtered by the where clause the recipient query rides on).
const ACTIVE_CAMPAIGN = {
  id: 'campaign_1',
  key: 'MSP2-2026',
  orgId: ORG,
  org: { users: [{ email: 'admin@grb.com' }] },
};

interface MockPlacement {
  fixtureId: string;
  storeId: string;
  store: { name: string; brand: string };
}
interface MockCapture {
  storeId: string;
  fixtureId: string;
  storageKey: string | null;
  needsPhoto: boolean;
  verdict: CaptureVerdict | null;
  overrideVerdict: CaptureVerdict | null;
}

/**
 * A Prisma double for the migrated chase pipeline. Captures the `campaign` and
 * `placement` query args so we can assert the recipient + active-store filters,
 * and returns the supplied placements/captures so the satisfaction rule runs.
 */
function makeChasePrisma(
  placements: MockPlacement[],
  captures: MockCapture[],
) {
  const campaignFindMany = vi.fn(async (_args: unknown) => [ACTIVE_CAMPAIGN]);
  const placementFindMany = vi.fn(async (_args: unknown) => placements);
  const fixtureCaptureFindMany = vi.fn(async (_args: unknown) => captures);
  const prisma = {
    campaign: { findMany: campaignFindMany },
    placement: { findMany: placementFindMany },
    fixtureCapture: { findMany: fixtureCaptureFindMany },
  };
  return {
    prisma,
    campaignFindMany,
    placementFindMany,
    fixtureCaptureFindMany,
  };
}

function makeChase(prisma: unknown): ChaseService {
  // Construct without onModuleInit so no SMTP transporter is created. With no
  // recipients/transporter the email step is skipped, so chase() never sends.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ChaseService(prisma as any);
}

// chase() is private; invoke via run() would need the scheduler lock, so we call
// the private method directly — same boundary the cron hits, minus the lock.
function runChase(service: ChaseService): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (service as any).chase() as Promise<number>;
}

describe('ChaseService — chaseEmails opt-out filters recipients (FixtureCapture source)', () => {
  it('queries only active ADMIN/REVIEWER users with chaseEmails:true', async () => {
    // No placements ⇒ no behind stores; we only assert the recipient filter shape
    // on the new source (recipients now ride on campaign.org.users.where).
    const { prisma, campaignFindMany } = makeChasePrisma([], []);
    const service = makeChase(prisma);

    await runChase(service);

    expect(campaignFindMany).toHaveBeenCalledTimes(1);
    const [arg] = campaignFindMany.mock.calls[0] ?? [];
    const typed = arg as {
      where: Record<string, unknown>;
      select: { org: { select: { users: { where: Record<string, unknown> } } } };
    };
    expect(typed.select.org.select.users.where).toEqual({
      role: { in: ['ADMIN', 'REVIEWER'] },
      chaseEmails: true,
      disabledAt: null,
    });
    // Only ACTIVE campaigns are swept.
    expect(typed.where.status).toBe(CampaignStatus.ACTIVE);
  });

  it('filters placements to applicable fixtures on ACTIVE (non-closed) stores', async () => {
    const { prisma, placementFindMany } = makeChasePrisma([], []);
    const service = makeChase(prisma);

    await runChase(service);

    const [arg] = placementFindMany.mock.calls[0] ?? [];
    const typed = arg as { where: Record<string, unknown> };
    expect(typed.where).toMatchObject({
      campaignId: 'campaign_1',
      applicable: true,
      store: { closedAt: null },
    });
  });
});

describe('ChaseService — "behind" computed from FixtureCapture+Placement', () => {
  const STORE = 'store_1';
  const FIXTURE = 'fixture_storefront';
  const placement: MockPlacement = {
    fixtureId: FIXTURE,
    storeId: STORE,
    store: { name: 'Bondi', brand: 'Myer' },
  };

  it('CHASES a FixtureCapture-only store whose applicable placement is not yet passing', async () => {
    // The store has an applicable placement but NO capture row at all — exactly a
    // store that has done work on the floor plan but not this fixture. Before the
    // migration the legacy Submission read missed it; now it is correctly behind.
    const { prisma } = makeChasePrisma([placement], []);
    const service = makeChase(prisma);

    const count = await runChase(service);
    expect(count).toBe(1);
  });

  it('CHASES when the capture is uploaded but its effective verdict is NOT PASS', async () => {
    const capture: MockCapture = {
      storeId: STORE,
      fixtureId: FIXTURE,
      storageKey: 'captures/x.jpg',
      needsPhoto: false,
      verdict: CaptureVerdict.NEEDS_REVIEW,
      overrideVerdict: null,
    };
    const { prisma } = makeChasePrisma([placement], [capture]);
    const service = makeChase(prisma);

    const count = await runChase(service);
    expect(count).toBe(1);
  });

  it('CHASES when a reviewer re-requested a photo (needsPhoto) even on a PASS capture', async () => {
    const capture: MockCapture = {
      storeId: STORE,
      fixtureId: FIXTURE,
      storageKey: 'captures/x.jpg',
      needsPhoto: true, // reviewer asked for a re-shoot
      verdict: CaptureVerdict.PASS,
      overrideVerdict: null,
    };
    const { prisma } = makeChasePrisma([placement], [capture]);
    const service = makeChase(prisma);

    const count = await runChase(service);
    expect(count).toBe(1);
  });

  it('does NOT chase a store whose every applicable placement is PASS (it is done)', async () => {
    const capture: MockCapture = {
      storeId: STORE,
      fixtureId: FIXTURE,
      storageKey: 'captures/x.jpg',
      needsPhoto: false,
      verdict: CaptureVerdict.PASS,
      overrideVerdict: null,
    };
    const { prisma } = makeChasePrisma([placement], [capture]);
    const service = makeChase(prisma);

    const count = await runChase(service);
    expect(count).toBe(0);
  });

  it('does NOT chase a done store even if its AI verdict failed but a reviewer OVERRODE to PASS', async () => {
    // Effective verdict = override (PASS) beats the AI verdict (FAIL).
    const capture: MockCapture = {
      storeId: STORE,
      fixtureId: FIXTURE,
      storageKey: 'captures/x.jpg',
      needsPhoto: false,
      verdict: CaptureVerdict.FAIL,
      overrideVerdict: CaptureVerdict.PASS,
    };
    const { prisma } = makeChasePrisma([placement], [capture]);
    const service = makeChase(prisma);

    const count = await runChase(service);
    expect(count).toBe(0);
  });
});
