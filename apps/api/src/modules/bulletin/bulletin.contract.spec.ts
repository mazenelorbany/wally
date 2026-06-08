import { describe, it, expect, vi, beforeEach } from 'vitest';

import { BulletinService } from './bulletin.service';

// =============================================================================
// Per-user bulletin-ack coverage contract.
//
// Fix for "BulletinAck is keyed per-store, not per-user": acks are now keyed on
// (bulletinId, userId) and the must-read denominator counts the STORE_MANAGER
// population, not stores. This suite proves — with two co-managers at ONE store —
// that one manager's ack does NOT mark the other as acknowledged, and that
// acknowledge()/unacknowledge() target the per-user key. Prisma is mocked at the
// query boundary (no live DB), mirroring review.contract.spec.ts.
// =============================================================================

const ORG = 'org_1';
const PROJECT = 'project_1';
const STORE = 'store_1';
const BULLETIN = 'bulletin_1';
const MANAGER_A = 'user_mgr_a';
const MANAGER_B = 'user_mgr_b';

function session(userId: string) {
  return {
    id: userId,
    orgId: ORG,
    role: 'STORE_MANAGER' as const,
    storeId: STORE,
    email: `${userId}@grb.test`,
    name: userId,
  };
}

/**
 * A Prisma double. The bulletinAck "table" is an in-memory list keyed by
 * (bulletinId, userId); upsert/deleteMany/findMany operate on it so the per-user
 * semantics are exercised end to end. Two managers (A, B) share STORE.
 */
function makePrisma() {
  const acks: Array<{ bulletinId: string; storeId: string; userId: string }> =
    [];

  const bulletinAck = {
    upsert: vi.fn(
      async ({
        where,
        create,
      }: {
        where: { bulletinId_userId: { bulletinId: string; userId: string } };
        create: { bulletinId: string; storeId: string; userId: string };
        update: unknown;
      }) => {
        const { bulletinId, userId } = where.bulletinId_userId;
        const found = acks.find(
          (a) => a.bulletinId === bulletinId && a.userId === userId,
        );
        if (found) return found;
        acks.push(create);
        return create;
      },
    ),
    deleteMany: vi.fn(
      async ({
        where,
      }: {
        where: { bulletinId: string; userId: string };
      }) => {
        let count = 0;
        for (let i = acks.length - 1; i >= 0; i--) {
          const row = acks[i]!;
          if (row.bulletinId === where.bulletinId && row.userId === where.userId) {
            acks.splice(i, 1);
            count++;
          }
        }
        return { count };
      },
    ),
    findMany: vi.fn(
      async ({ where }: { where: { bulletinId: string } }) =>
        acks
          .filter((a) => a.bulletinId === where.bulletinId)
          .map((a) => ({ userId: a.userId, acknowledgedAt: new Date() })),
    ),
  };

  // Two co-managers at the same store make up the must-read population (2).
  const managerPop = [
    {
      id: MANAGER_A,
      name: 'Manager A',
      email: 'a@grb.test',
      storeId: STORE,
      store: { name: 'Sydney' },
    },
    {
      id: MANAGER_B,
      name: 'Manager B',
      email: 'b@grb.test',
      storeId: STORE,
      store: { name: 'Sydney' },
    },
  ];

  const prisma = {
    bulletinAck,
    bulletin: {
      findFirst: vi.fn(async () => ({ id: BULLETIN, projectId: PROJECT })),
    },
    user: {
      count: vi.fn(async () => managerPop.length),
      findMany: vi.fn(async () => managerPop),
    },
    store: {
      findFirst: vi.fn(async () => ({ id: STORE, projectId: PROJECT })),
    },
  };
  return { prisma, acks };
}

describe('bulletin per-user ack coverage', () => {
  let prisma: ReturnType<typeof makePrisma>['prisma'];
  let acks: ReturnType<typeof makePrisma>['acks'];
  let service: BulletinService;

  beforeEach(() => {
    ({ prisma, acks } = makePrisma());
    // storage is unused by the ack paths under test.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new BulletinService(prisma as any, {} as any);
  });

  it('one co-manager acking does NOT mark the other acknowledged', async () => {
    await service.acknowledge(session(MANAGER_A), BULLETIN);

    // Exactly one ack row, keyed to manager A's userId — not the store.
    expect(acks).toHaveLength(1);
    expect(acks[0]).toMatchObject({ userId: MANAGER_A, storeId: STORE });

    // The roster shows A acknowledged, B still pending — at the same store.
    const roster = await service.acks(ORG, BULLETIN);
    const a = roster.find((r) => r.userId === MANAGER_A);
    const b = roster.find((r) => r.userId === MANAGER_B);
    expect(a?.acknowledged).toBe(true);
    expect(b?.acknowledged).toBe(false);
    // The actor is surfaced (who acknowledged), not just the store.
    expect(a?.userName).toBe('Manager A');
    expect(a?.userEmail).toBe('a@grb.test');
  });

  it('coverage denominator is the manager population (2), not the store count (1)', async () => {
    await service.acknowledge(session(MANAGER_A), BULLETIN);
    const roster = await service.acks(ORG, BULLETIN);
    expect(roster).toHaveLength(2); // both co-managers at the one store
    expect(roster.filter((r) => r.acknowledged)).toHaveLength(1);
  });

  it('upsert targets the per-user key (bulletinId_userId)', async () => {
    await service.acknowledge(session(MANAGER_A), BULLETIN);
    expect(prisma.bulletinAck.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bulletinId_userId: { bulletinId: BULLETIN, userId: MANAGER_A } },
      }),
    );
  });

  it('unacknowledge removes only this user’s ack (self-undo)', async () => {
    await service.acknowledge(session(MANAGER_A), BULLETIN);
    await service.acknowledge(session(MANAGER_B), BULLETIN);
    expect(acks).toHaveLength(2);

    await service.unacknowledge(session(MANAGER_A), BULLETIN);
    expect(acks).toHaveLength(1);
    expect(acks[0]?.userId).toBe(MANAGER_B);
  });
});
