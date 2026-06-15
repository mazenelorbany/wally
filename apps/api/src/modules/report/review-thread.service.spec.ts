import { describe, it, expect, vi } from 'vitest';
import type { SessionUser } from '@wally/types';

import { ReviewThreadService } from './review-thread.service';

// =============================================================================
// Review-thread permissions — the loop's contract:
//   - a STORE_MANAGER replies only on THEIR store's threads (403 elsewhere)
//   - VIEWER never writes
//   - resolve stamps who/when; reopen clears both
//
// …and the notification side: each thread carries at most one Task
// (Task.threadId) feeding the store's badge. Opening a thread creates it, a
// head-office reply reopens it and clears TaskReads (badge re-lights), a
// manager reply stays silent, and resolve/reopen keep it in lockstep.
// =============================================================================

const ORG = 'org_1';

function user(role: SessionUser['role'], id = 'u_1'): SessionUser {
  return { id, orgId: ORG, role, email: `${id}@x`, name: id } as SessionUser;
}

interface TaskRow {
  id: string;
  threadId: string | null;
  status: string;
  title: string;
  body: string | null;
  completedById: string | null;
  completedAt: Date | null;
}

function makePrisma(opts: {
  threadStoreId?: string;
  managerStoreId?: string | null;
  tasks?: TaskRow[];
  taskReads?: { taskId: string; userId: string }[];
}) {
  const updates: Record<string, unknown>[] = [];
  const tasks: TaskRow[] = opts.tasks ?? [];
  const state = { tasks, taskReads: opts.taskReads ?? [] };
  let taskSeq = 0;
  const prisma = {
    store: {
      // Each store id is its own venue ("Venue s1 — Brand") so cross-store
      // checks behave like cross-venue ones; venue siblings aren't exercised
      // here (covered by the manager venue-access path).
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        name: `Venue ${where.id} — Brand`,
        projectId: 'p1',
      })),
      findMany: vi.fn(async () => [
        { id: 's1', name: 'Venue s1 — Brand' },
        { id: 's2', name: 'Venue s2 — Brand' },
      ]),
    },
    campaign: { findFirst: vi.fn(async () => ({ id: 'c1' })) },
    reviewThread: {
      findFirst: vi.fn(async () => ({
        id: 't1',
        orgId: ORG,
        storeId: opts.threadStoreId ?? 's1',
        campaignId: 'c1',
      })),
      findFirstOrThrow: vi.fn(async () => ({
        id: 't1',
        storeId: opts.threadStoreId ?? 's1',
        campaignId: 'c1',
        fixtureId: 'f1',
        questionId: null,
        photoId: null,
        pinX: null,
        pinY: null,
        status: 'OPEN',
        createdAt: new Date(),
        resolvedAt: null,
        createdBy: { name: 'Admin', email: 'a@x', role: 'ADMIN' },
        resolvedBy: null,
        comments: [],
      })),
      create: vi.fn(async () => ({
        id: 't1',
        orgId: ORG,
        storeId: opts.threadStoreId ?? 's1',
        campaignId: 'c1',
        fixtureId: 'f1',
        questionId: null,
        photoId: null,
        pinX: null,
        pinY: null,
        status: 'OPEN',
        createdAt: new Date(),
        resolvedAt: null,
        createdBy: { name: 'Admin', email: 'a@x', role: 'ADMIN' },
        resolvedBy: null,
        comments: [],
      })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return {};
      }),
    },
    reviewComment: {
      create: vi.fn(async () => ({})),
    },
    user: {
      findUnique: vi.fn(async () => ({ storeId: opts.managerStoreId ?? null })),
    },
    task: {
      findFirst: vi.fn(async ({ where }: { where: { threadId: string } }) =>
        state.tasks.find((t) => t.threadId === where.threadId) ?? null,
      ),
      findMany: vi.fn(async ({ where }: { where: { threadId: string } }) =>
        state.tasks.filter((t) => t.threadId === where.threadId),
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row: TaskRow = {
          id: `task_${++taskSeq}`,
          threadId: (data.threadId as string) ?? null,
          status: data.status as string,
          title: data.title as string,
          body: (data.body as string) ?? null,
          completedById: null,
          completedAt: null,
        };
        state.tasks.push(row);
        return row;
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<TaskRow> }) => {
          const row = state.tasks.find((t) => t.id === where.id)!;
          Object.assign(row, data);
          return row;
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { threadId?: string; status?: string; id?: { in: string[] } };
          data: Partial<TaskRow>;
        }) => {
          const targets = state.tasks.filter(
            (t) =>
              (where.threadId === undefined || t.threadId === where.threadId) &&
              (where.status === undefined || t.status === where.status) &&
              (where.id === undefined || where.id.in.includes(t.id)),
          );
          targets.forEach((t) => Object.assign(t, data));
          return { count: targets.length };
        },
      ),
    },
    taskRead: {
      deleteMany: vi.fn(
        async ({ where }: { where: { taskId: string | { in: string[] } } }) => {
          const ids =
            typeof where.taskId === 'string' ? [where.taskId] : where.taskId.in;
          state.taskReads = state.taskReads.filter((r) => !ids.includes(r.taskId));
          return { count: 0 };
        },
      ),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };
  return { prisma, updates, state };
}

describe('ReviewThreadService permissions + resolve stamps', () => {
  it('a manager replies on their own store’s thread', async () => {
    const { prisma } = makePrisma({ threadStoreId: 's1', managerStoreId: 's1' });
    const svc = new ReviewThreadService(prisma as never);
    await expect(
      svc.reply(user('STORE_MANAGER'), 't1', { body: 'done' }),
    ).resolves.toBeTruthy();
    expect(prisma.reviewComment.create).toHaveBeenCalled();
  });

  it('a manager is 403d on another store’s thread', async () => {
    const { prisma } = makePrisma({ threadStoreId: 's1', managerStoreId: 's2' });
    const svc = new ReviewThreadService(prisma as never);
    await expect(
      svc.reply(user('STORE_MANAGER'), 't1', { body: 'hi' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(prisma.reviewComment.create).not.toHaveBeenCalled();
  });

  it('a VIEWER cannot reply', async () => {
    const { prisma } = makePrisma({});
    const svc = new ReviewThreadService(prisma as never);
    await expect(
      svc.reply(user('VIEWER'), 't1', { body: 'hi' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('resolve stamps the resolver + time; reopen clears both', async () => {
    const { prisma, updates } = makePrisma({});
    const svc = new ReviewThreadService(prisma as never);

    await svc.setResolved(user('ADMIN', 'admin_9'), 't1', true);
    expect(updates[0]).toMatchObject({ status: 'RESOLVED', resolvedById: 'admin_9' });
    expect(updates[0]!.resolvedAt).toBeInstanceOf(Date);

    await svc.setResolved(user('ADMIN', 'admin_9'), 't1', false);
    expect(updates[1]).toMatchObject({
      status: 'OPEN',
      resolvedById: null,
      resolvedAt: null,
    });
  });
});

describe('ReviewThreadService notification tasks', () => {
  const seenTask = (): TaskRow => ({
    id: 'task_seen',
    threadId: 't1',
    status: 'DONE',
    title: 'New comment on your report',
    body: 'not good',
    completedById: 'u_mgr',
    completedAt: new Date(),
  });

  it('opening a thread creates one OPEN task for the store', async () => {
    const { prisma, state } = makePrisma({});
    const svc = new ReviewThreadService(prisma as never);

    await svc.create(user('ADMIN'), {
      storeId: 's1',
      campaignId: 'c1',
      fixtureId: 'f1',
      body: 'not good',
    });

    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]).toMatchObject({
      threadId: 't1',
      status: 'OPEN',
      title: 'New comment on your report',
      body: 'not good',
    });
  });

  it('a head-office reply reopens the existing task and clears TaskReads', async () => {
    const { prisma, state } = makePrisma({
      tasks: [seenTask()],
      taskReads: [{ taskId: 'task_seen', userId: 'u_mgr' }],
    });
    const svc = new ReviewThreadService(prisma as never);

    await svc.reply(user('ADMIN'), 't1', { body: 'still waiting' });

    expect(state.tasks).toHaveLength(1); // reused, not duplicated
    expect(state.tasks[0]).toMatchObject({
      status: 'OPEN',
      body: 'still waiting',
      completedById: null,
      completedAt: null,
    });
    expect(state.taskReads).toHaveLength(0); // badge re-lights for every manager
  });

  it('a manager reply does not touch the task', async () => {
    const { prisma, state } = makePrisma({
      threadStoreId: 's1',
      managerStoreId: 's1',
      tasks: [seenTask()],
      taskReads: [{ taskId: 'task_seen', userId: 'u_mgr' }],
    });
    const svc = new ReviewThreadService(prisma as never);

    await svc.reply(user('STORE_MANAGER', 'u_mgr'), 't1', { body: 'fixed it' });

    expect(state.tasks[0]!.status).toBe('DONE');
    expect(state.taskReads).toHaveLength(1);
  });

  it('resolving the thread completes its open task', async () => {
    const { prisma, state } = makePrisma({
      tasks: [{ ...seenTask(), status: 'OPEN', completedById: null, completedAt: null }],
    });
    const svc = new ReviewThreadService(prisma as never);

    await svc.setResolved(user('ADMIN', 'admin_9'), 't1', true);

    expect(state.tasks[0]!.status).toBe('DONE');
    expect(state.tasks[0]!.completedById).toBe('admin_9');
    expect(state.tasks[0]!.completedAt).toBeInstanceOf(Date);
  });

  it('reopening the thread revives the task and clears TaskReads', async () => {
    const { prisma, state } = makePrisma({
      tasks: [seenTask()],
      taskReads: [{ taskId: 'task_seen', userId: 'u_mgr' }],
    });
    const svc = new ReviewThreadService(prisma as never);

    await svc.setResolved(user('ADMIN'), 't1', false);

    expect(state.tasks[0]).toMatchObject({
      status: 'OPEN',
      completedById: null,
      completedAt: null,
    });
    expect(state.taskReads).toHaveLength(0);
  });
});
