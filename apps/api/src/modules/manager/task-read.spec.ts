import { describe, it, expect, beforeEach } from 'vitest';

import { ManagerService } from './manager.service';

// =============================================================================
// Per-user task "seen" state (TaskRead).
//
// Fix for "Task seen state is keyed per-store, not per-user": markTasksSeen used
// to stamp a single shared Task.seenAt by storeId, so one manager opening Tasks
// cleared the unread badge for every co-manager. The badge is now "OPEN tasks
// for this store with no TaskRead row for THIS user" (home() at
// manager.service.ts: `reads: { none: { userId } }`), and markTasksSeen upserts
// one TaskRead per open task for the acting user only.
//
// This suite drives the REAL markTasksSeen against an in-memory Prisma double
// that faithfully implements the same `reads: { none: { userId } }` predicate
// the badge count uses, and asserts the per-user isolation guarantee.
// =============================================================================

const ORG = 'org_1';
const STORE = 'store_1';
const MANAGER_A = { id: 'mgr_a', orgId: ORG, role: 'STORE_MANAGER', storeId: STORE };
const MANAGER_B = { id: 'mgr_b', orgId: ORG, role: 'STORE_MANAGER', storeId: STORE };

/** An in-memory Prisma double for tasks + per-user reads. */
function makePrisma() {
  const tasks = [
    { id: 't1', storeId: STORE, orgId: ORG, status: 'OPEN' },
    { id: 't2', storeId: STORE, orgId: ORG, status: 'OPEN' },
    { id: 't3', storeId: STORE, orgId: ORG, status: 'OPEN' },
  ];
  const reads: { taskId: string; userId: string }[] = [];

  // Honours where.storeId, where.status, and where.reads.none.userId — exactly
  // the predicate home()/markTasksSeen build.
  const match = (where: {
    storeId?: string;
    status?: string;
    reads?: { none?: { userId?: string } };
  }) =>
    tasks.filter((t) => {
      if (where.storeId && t.storeId !== where.storeId) return false;
      if (where.status && t.status !== where.status) return false;
      const noneUser = where.reads?.none?.userId;
      if (noneUser && reads.some((r) => r.taskId === t.id && r.userId === noneUser))
        return false;
      return true;
    });

  return {
    _reads: reads,
    store: {
      findFirst: async () => ({ id: STORE, name: 'Store 1', projectId: null }),
    },
    task: {
      findMany: async ({ where }: { where: never }) =>
        match(where).map((t) => ({ id: t.id })),
      count: async ({ where }: { where: never }) => match(where).length,
    },
    taskRead: {
      createMany: async ({
        data,
        skipDuplicates,
      }: {
        data: { taskId: string; userId: string }[];
        skipDuplicates?: boolean;
      }) => {
        let created = 0;
        for (const row of data) {
          if (
            skipDuplicates &&
            reads.some((r) => r.taskId === row.taskId && r.userId === row.userId)
          )
            continue;
          reads.push(row);
          created += 1;
        }
        return { count: created };
      },
    },
  };
}

// The unread-badge predicate home() uses, verbatim.
const unreadCount = (prisma: ReturnType<typeof makePrisma>, userId: string) =>
  prisma.task.count({
    where: { storeId: STORE, status: 'OPEN', reads: { none: { userId } } },
  } as never);

describe('per-user task read state', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: ManagerService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new ManagerService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('manager A marking seen does NOT clear manager B unread badge', async () => {
    // Both managers start with all 3 tasks unread.
    expect(await unreadCount(prisma, MANAGER_A.id)).toBe(3);
    expect(await unreadCount(prisma, MANAGER_B.id)).toBe(3);

    await svc.markTasksSeen(MANAGER_A as never);

    // A is cleared; B is untouched — the core regression guard.
    expect(await unreadCount(prisma, MANAGER_A.id)).toBe(0);
    expect(await unreadCount(prisma, MANAGER_B.id)).toBe(3);

    // Every TaskRead written belongs to A only.
    expect(prisma._reads.every((r) => r.userId === MANAGER_A.id)).toBe(true);
    expect(prisma._reads).toHaveLength(3);
  });

  it('markTasksSeen is idempotent and per-user (B then clears only B)', async () => {
    await svc.markTasksSeen(MANAGER_A as never);
    await svc.markTasksSeen(MANAGER_A as never); // idempotent: no duplicate rows
    expect(prisma._reads).toHaveLength(3);

    await svc.markTasksSeen(MANAGER_B as never);
    expect(await unreadCount(prisma, MANAGER_B.id)).toBe(0);
    expect(prisma._reads).toHaveLength(6); // 3 for A + 3 for B
  });
});
