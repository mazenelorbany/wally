import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CampaignStatus } from '@prisma/client';
import { ConflictException } from '@nestjs/common';

import { CampaignService } from './campaign.service';

// =============================================================================
// Project-scoped campaign activation (the missing-dimension fix).
//
// The bug: activation closed *every* other ACTIVE campaign org-wide, but reads
// (manager.resolveCampaign) are per-project, so the seed's two concurrently-
// ACTIVE campaigns on different projects meant activating one flipped the
// other project's live read to CLOSED.
//
// These tests assert the bulk-close `updateMany` is scoped to the *target's*
// projectId (handling null explicitly), and exercise the lifecycle state
// machine's illegal-transition rejections — all without a live DB (Prisma and
// SubmissionService are mocked at the call boundary).
// =============================================================================

const ORG = 'org_1';

/** Narrow `arr[0]` for strict noUncheckedIndexedAccess; fails loudly if empty. */
function first<T>(arr: T[]): T {
  expect(arr.length).toBeGreaterThan(0);
  return arr[0] as T;
}

/**
 * A Prisma double that records every updateMany `where`/`data` so a test can
 * assert exactly which campaigns the activation would have closed.
 * $transaction runs the callback with the same double.
 */
function makePrisma(target: {
  id: string;
  orgId?: string;
  projectId: string | null;
  status: CampaignStatus;
}) {
  const updateManyCalls: Array<{
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }> = [];
  const updateCalls: Array<{
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }> = [];

  const campaign = {
    // get() → findFirst by { id, orgId }
    findFirst: vi.fn(async () => ({
      id: target.id,
      orgId: target.orgId ?? ORG,
      projectId: target.projectId,
      key: 'TARGET',
      name: 'Target',
      status: target.status,
      startsAt: null,
      endsAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      activatedAt: null,
      closedAt: null,
      archivedAt: null,
    })),
    // The pre-close snapshot lookup of campaigns about to be auto-closed.
    findMany: vi.fn(async () => []),
    updateMany: vi.fn(
      async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        updateManyCalls.push(args);
        return { count: 0 };
      },
    ),
    update: vi.fn(
      async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        updateCalls.push(args);
        return { id: target.id, status: args.data.status };
      },
    ),
  };

  const prisma = {
    campaign,
    $transaction: vi.fn(
      async (cb: (t: { campaign: typeof campaign }) => Promise<unknown>) =>
        cb({ campaign }),
    ),
  };
  return { prisma, updateManyCalls, updateCalls };
}

/** A SubmissionService double — captureSnapshot is best-effort, just record it. */
function makeSubmissions() {
  const snapshots: string[] = [];
  return {
    snapshots,
    service: {
      captureSnapshot: vi.fn(async (_orgId: string, campaignId: string) => {
        snapshots.push(campaignId);
        return {} as never;
      }),
    },
  };
}

describe('campaign activation is project-scoped', () => {
  let make: (t: Parameters<typeof makePrisma>[0]) => {
    prisma: ReturnType<typeof makePrisma>['prisma'];
    updateManyCalls: ReturnType<typeof makePrisma>['updateManyCalls'];
    updateCalls: ReturnType<typeof makePrisma>['updateCalls'];
    service: CampaignService;
  };

  beforeEach(() => {
    make = (t) => {
      const { prisma, updateManyCalls, updateCalls } = makePrisma(t);
      const subs = makeSubmissions();
      const service = new CampaignService(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prisma as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        subs.service as any,
      );
      return { prisma, updateManyCalls, updateCalls, service };
    };
  });

  it('activating project B only closes project B — never project A', async () => {
    const projectB = 'project_B';
    const { updateManyCalls, updateCalls, service } = make({
      id: 'campaign_B',
      projectId: projectB,
      status: CampaignStatus.DRAFT,
    });

    await service.setActive(ORG, 'campaign_B');

    // The bulk-close must be scoped to the TARGET's projectId, so project A's
    // ACTIVE campaign (different projectId) is never matched.
    expect(updateManyCalls).toHaveLength(1);
    const close = first(updateManyCalls);
    expect(close.where).toMatchObject({
      orgId: ORG,
      status: CampaignStatus.ACTIVE,
      id: { not: 'campaign_B' },
      projectId: projectB,
    });
    // And the close stamps closedAt (audit trail).
    expect(close.data).toMatchObject({ status: CampaignStatus.CLOSED });
    expect(close.data.closedAt).toBeInstanceOf(Date);

    // The target is promoted to ACTIVE with an activatedAt stamp.
    expect(updateCalls).toHaveLength(1);
    const promote = first(updateCalls);
    expect(promote.data).toMatchObject({ status: CampaignStatus.ACTIVE });
    expect(promote.data.activatedAt).toBeInstanceOf(Date);
  });

  it('a null-project campaign only closes other null-project campaigns', async () => {
    const { updateManyCalls, service } = make({
      id: 'campaign_org',
      projectId: null,
      status: CampaignStatus.DRAFT,
    });

    await service.setActive(ORG, 'campaign_org');

    expect(first(updateManyCalls).where).toMatchObject({
      orgId: ORG,
      status: CampaignStatus.ACTIVE,
      id: { not: 'campaign_org' },
      projectId: null,
    });
  });

  it('reopen applies the same project-scoped close rule (CLOSED → ACTIVE)', async () => {
    const { updateManyCalls, updateCalls, service } = make({
      id: 'campaign_B',
      projectId: 'project_B',
      status: CampaignStatus.CLOSED,
    });

    await service.reopen(ORG, 'campaign_B');

    expect(first(updateManyCalls).where).toMatchObject({ projectId: 'project_B' });
    expect(first(updateCalls).data).toMatchObject({
      status: CampaignStatus.ACTIVE,
    });
  });

  it('activating an already-ACTIVE campaign is a no-op (no close)', async () => {
    const { updateManyCalls, updateCalls, service } = make({
      id: 'campaign_B',
      projectId: 'project_B',
      status: CampaignStatus.ACTIVE,
    });

    await service.setActive(ORG, 'campaign_B');

    expect(updateManyCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });
});

describe('campaign lifecycle state machine rejects illegal transitions', () => {
  const build = (status: CampaignStatus) => {
    const { prisma } = makePrisma({ id: 'c1', projectId: null, status });
    const subs = makeSubmissions();
    return new CampaignService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      subs.service as any,
    );
  };

  it('close rejects a DRAFT campaign (never live) with a 409', async () => {
    await expect(build(CampaignStatus.DRAFT).close(ORG, 'c1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('close rejects an already-CLOSED campaign with a 409', async () => {
    await expect(build(CampaignStatus.CLOSED).close(ORG, 'c1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('reopen rejects a DRAFT campaign with a 409 (only CLOSED can reopen)', async () => {
    await expect(build(CampaignStatus.DRAFT).reopen(ORG, 'c1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('reopen rejects an ACTIVE campaign with a 409', async () => {
    await expect(
      build(CampaignStatus.ACTIVE).reopen(ORG, 'c1'),
    ).rejects.toThrow(ConflictException);
  });
});
