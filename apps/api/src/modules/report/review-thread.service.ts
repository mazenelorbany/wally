import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ReviewThreadDto, SessionUser } from '@wally/types';

import { venueOf } from '../../lib/venue';
import { PrismaService } from '../../prisma/prisma.service';

import type { CreateThreadInput, ReplyInput } from './review-thread.dto';

// =============================================================================
// ReviewThreadService — the comment loop on a store's report.
//
// An ADMIN/REVIEWER opens a thread on one piece of the report (a fixture's
// photo step, optionally pinned to a spot on one photo, or a question answer),
// the store's manager replies, and a moderator resolves it. Org-scoped
// throughout; a STORE_MANAGER can only see and reply to their own store's
// threads. VIEWER reads, never writes.
//
// Notification: each thread carries at most ONE Task (Task.threadId) so the
// store's managers see the comment in their task badge. A fresh head-office
// comment (re)opens that task and clears its TaskReads so the badge re-lights;
// resolving the thread completes the task; reopening revives it. Manager
// replies never notify — the badge is the store-facing surface only.
// =============================================================================

const COMMENT_TASK_TITLE = 'New comment on your report';

const THREAD_INCLUDE = {
  createdBy: { select: { name: true, email: true, role: true } },
  resolvedBy: { select: { name: true, email: true } },
  comments: {
    orderBy: { createdAt: 'asc' as const },
    include: { author: { select: { name: true, email: true, role: true } } },
  },
} satisfies Prisma.ReviewThreadInclude;

type ThreadRow = Prisma.ReviewThreadGetPayload<{ include: typeof THREAD_INCLUDE }>;

@Injectable()
export class ReviewThreadService {
  constructor(private readonly prisma: PrismaService) {}

  /** All threads for one store × campaign, newest first, comments in order. */
  async list(
    user: SessionUser,
    campaignId: string,
    storeId?: string,
  ): Promise<ReviewThreadDto[]> {
    const resolvedStoreId = await this.resolveStoreId(user, storeId);
    const rows = await this.prisma.reviewThread.findMany({
      where: { orgId: user.orgId, campaignId, storeId: resolvedStoreId },
      include: THREAD_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => present(r));
  }

  /** Open a thread (ADMIN/REVIEWER — enforced at the route) with its first comment. */
  async create(user: SessionUser, input: CreateThreadInput): Promise<ReviewThreadDto> {
    const store = await this.prisma.store.findFirst({
      where: { id: input.storeId, orgId: user.orgId },
      select: { id: true },
    });
    if (!store) throw new NotFoundException('store not found');
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: input.campaignId, orgId: user.orgId },
      select: { id: true },
    });
    if (!campaign) throw new NotFoundException('campaign not found');

    const created = await this.prisma.$transaction(async (tx) => {
      const thread = await tx.reviewThread.create({
        data: {
          orgId: user.orgId,
          storeId: input.storeId,
          campaignId: input.campaignId,
          fixtureId: input.fixtureId ?? null,
          questionId: input.questionId ?? null,
          photoId: input.photoId ?? null,
          pinX: input.pinX ?? null,
          pinY: input.pinY ?? null,
          createdById: user.id,
          comments: {
            create: { orgId: user.orgId, authorId: user.id, body: input.body },
          },
        },
        include: THREAD_INCLUDE,
      });
      await this.notifyStore(tx, thread, input.body);
      return thread;
    });
    return present(created);
  }

  /**
   * Reply to a thread. ADMIN/REVIEWER reply anywhere in their org; a
   * STORE_MANAGER only on their own store's threads. Replying reopens nothing —
   * a resolved thread accepts replies (the conversation may continue) but only
   * a moderator flips status.
   */
  async reply(
    user: SessionUser,
    threadId: string,
    input: ReplyInput,
  ): Promise<ReviewThreadDto> {
    const thread = await this.requireThread(user, threadId);
    if (user.role === 'VIEWER') {
      throw new ForbiddenException('read-only role');
    }
    if (user.role === 'STORE_MANAGER') {
      const allowed = await this.managerStoreIds(user);
      if (!allowed.has(thread.storeId)) {
        throw new ForbiddenException('not your store’s thread');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.reviewComment.create({
        data: {
          orgId: user.orgId,
          threadId: thread.id,
          authorId: user.id,
          body: input.body,
        },
      });
      await tx.reviewThread.update({
        where: { id: thread.id },
        data: { updatedAt: new Date() },
      });
      // Head-office replies re-light the store's task badge; a manager
      // replying to their own thread is the answer, not a notification.
      if (user.role === 'ADMIN' || user.role === 'REVIEWER') {
        await this.notifyStore(tx, thread, input.body);
      }
    });
    return this.presentById(user, thread.id);
  }

  /** Resolve / reopen — moderators only (enforced at the route). */
  async setResolved(
    user: SessionUser,
    threadId: string,
    resolved: boolean,
  ): Promise<ReviewThreadDto> {
    const thread = await this.requireThread(user, threadId);
    await this.prisma.$transaction(async (tx) => {
      await tx.reviewThread.update({
        where: { id: thread.id },
        data: resolved
          ? { status: 'RESOLVED', resolvedById: user.id, resolvedAt: new Date() }
          : { status: 'OPEN', resolvedById: null, resolvedAt: null },
      });
      // Keep the notification task in lockstep: resolving the conversation
      // completes it; reopening revives it (and re-lights the badge).
      if (resolved) {
        await tx.task.updateMany({
          where: { threadId: thread.id, status: 'OPEN' },
          data: {
            status: 'DONE',
            completedById: user.id,
            completedAt: new Date(),
          },
        });
      } else {
        const tasks = await tx.task.findMany({
          where: { threadId: thread.id },
          select: { id: true },
        });
        if (tasks.length > 0) {
          await tx.task.updateMany({
            where: { id: { in: tasks.map((t) => t.id) } },
            data: { status: 'OPEN', completedById: null, completedAt: null },
          });
          await tx.taskRead.deleteMany({
            where: { taskId: { in: tasks.map((t) => t.id) } },
          });
        }
      }
    });
    return this.presentById(user, thread.id);
  }

  // ----- internals -----------------------------------------------------------

  /**
   * Surface a head-office comment in the store's task badge. One task per
   * thread: the first comment creates it; later comments reopen it, refresh
   * its body to the latest comment, and clear TaskReads so every manager's
   * unseen badge lights up again.
   */
  private async notifyStore(
    tx: Prisma.TransactionClient,
    thread: { id: string; orgId: string; storeId: string; campaignId: string },
    body: string,
  ): Promise<void> {
    const existing = await tx.task.findFirst({
      where: { threadId: thread.id },
      select: { id: true },
    });
    if (existing) {
      await tx.task.update({
        where: { id: existing.id },
        data: { status: 'OPEN', completedById: null, completedAt: null, body },
      });
      await tx.taskRead.deleteMany({ where: { taskId: existing.id } });
      return;
    }
    await tx.task.create({
      data: {
        orgId: thread.orgId,
        storeId: thread.storeId,
        campaignId: thread.campaignId,
        threadId: thread.id,
        kind: 'GENERAL',
        status: 'OPEN',
        title: COMMENT_TASK_TITLE,
        body,
      },
    });
  }

  private async requireThread(user: SessionUser, threadId: string) {
    const thread = await this.prisma.reviewThread.findFirst({
      where: { id: threadId, orgId: user.orgId },
      select: { id: true, orgId: true, storeId: true, campaignId: true },
    });
    if (!thread) throw new NotFoundException('thread not found');
    return thread;
  }

  private async presentById(user: SessionUser, id: string): Promise<ReviewThreadDto> {
    const row = await this.prisma.reviewThread.findFirstOrThrow({
      where: { id, orgId: user.orgId },
      include: THREAD_INCLUDE,
    });
    return present(row);
  }

  /**
   * The store a list call is scoped to. A manager defaults to their own store
   * and may address any sibling concession of their venue (one venue = several
   * brand mini-stores run by the same people) — anything else is refused.
   */
  private async resolveStoreId(user: SessionUser, storeId?: string): Promise<string> {
    if (user.role === 'STORE_MANAGER') {
      const allowed = await this.managerStoreIds(user);
      const own = [...allowed][0];
      if (!own) throw new ForbiddenException('no store bound to this manager');
      if (!storeId || storeId === own) return own;
      if (allowed.has(storeId)) return storeId;
      throw new ForbiddenException('not your venue’s store');
    }
    if (!storeId) throw new NotFoundException('storeId required');
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, orgId: user.orgId },
      select: { id: true },
    });
    if (!store) throw new NotFoundException('store not found');
    return store.id;
  }

  /**
   * Every store id a manager may act on: their own store first, then the
   * active sibling concessions of the same venue + project.
   */
  private async managerStoreIds(user: SessionUser): Promise<Set<string>> {
    const u = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { storeId: true },
    });
    if (!u?.storeId) return new Set();
    const own = await this.prisma.store.findFirst({
      where: { id: u.storeId, orgId: user.orgId },
      select: { id: true, name: true, projectId: true },
    });
    if (!own) return new Set();
    const siblings = await this.prisma.store.findMany({
      where: { orgId: user.orgId, projectId: own.projectId, closedAt: null },
      select: { id: true, name: true },
    });
    const venue = venueOf(own.name);
    return new Set([
      own.id,
      ...siblings.filter((s) => venueOf(s.name) === venue).map((s) => s.id),
    ]);
  }
}

function present(r: ThreadRow): ReviewThreadDto {
  return {
    id: r.id,
    storeId: r.storeId,
    campaignId: r.campaignId,
    fixtureId: r.fixtureId,
    questionId: r.questionId,
    photoId: r.photoId,
    pinX: r.pinX,
    pinY: r.pinY,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    createdByName: r.createdBy.name || r.createdBy.email,
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    resolvedByName: r.resolvedBy ? r.resolvedBy.name || r.resolvedBy.email : null,
    comments: r.comments.map((c) => ({
      id: c.id,
      body: c.body,
      authorName: c.author.name || c.author.email,
      authorRole: c.author.role,
      createdAt: c.createdAt.toISOString(),
    })),
  };
}
