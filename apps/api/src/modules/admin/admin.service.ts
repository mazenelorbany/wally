import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CampaignStatus,
  Prisma,
  Role,
  TaskKind,
  TaskStatus,
} from '@prisma/client';
import type { AdminTaskDto, SessionUser, TaskDto, UserDto } from '@wally/types';

import { PrismaService } from '../../prisma/prisma.service';
import { normalizeEmail } from '../auth/auth.crypto';
import { AuthService } from '../auth/auth.service';
import { toTaskDto } from '../manager/manager.service';

import type {
  BulkCreateTaskInput,
  CreateTaskInput,
  InviteUserInput,
  UpdateTaskInput,
  UpdateUserInput,
} from './admin.dto';

// =============================================================================
// AdminService — admin-only task assignment.
//
// An ADMIN assigns a task to a store (its manager). The store is validated
// in-org (404 cross-tenant), and the task is stamped with the org's active
// campaign (fallback: most recent) so it shows up against the right period.
// =============================================================================
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  // ----- user & role management --------------------------------------------

  /** Everyone in the org, with their store (for managers). */
  async listUsers(orgId: string): Promise<UserDto[]> {
    const users = await this.prisma.user.findMany({
      where: { orgId },
      orderBy: [{ disabledAt: 'asc' }, { email: 'asc' }],
      include: { store: { select: { name: true } } },
    });
    return users.map(toUserDto);
  }

  /**
   * Invite a teammate: create/link the user at this org with a role (+ store),
   * then email them a magic link to sign in. Re-inviting reactivates and
   * re-sends the link. Email is globally unique, so we key on it.
   *
   * Because `email` is globally unique (not per-org), an admin must never be
   * able to touch a user that belongs to another org: we look the email up
   * first and refuse with a 409 if it's already taken by a different org —
   * never mutating the foreign row nor minting a magic link for it.
   */
  async inviteUser(orgId: string, input: InviteUserInput): Promise<UserDto> {
    const email = normalizeEmail(input.email);

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { orgId: true },
    });
    if (existing && existing.orgId !== orgId) {
      throw new ConflictException(
        'that email already belongs to another organization',
      );
    }

    const user = await this.prisma.user.upsert({
      where: { email },
      create: {
        orgId,
        email,
        name: input.name ?? null,
        role: input.role as Role,
        storeId: input.storeId ?? null,
      },
      update: {
        role: input.role as Role,
        disabledAt: null,
        ...(input.storeId !== undefined ? { storeId: input.storeId } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
      },
      include: { store: { select: { name: true } } },
    });
    await this.auth.issueMagicLink({
      email,
      orgId,
      role: input.role as Role,
      ...(input.storeId ? { storeId: input.storeId } : {}),
    });
    return toUserDto(user);
  }

  /** Change a user's role / store, or (de)activate them. */
  async updateUser(
    actor: SessionUser,
    userId: string,
    input: UpdateUserInput,
  ): Promise<UserDto> {
    const existing = await this.prisma.user.findFirst({
      where: { id: userId, orgId: actor.orgId },
      select: { id: true, role: true, disabledAt: true },
    });
    if (!existing) throw new NotFoundException('user not found');
    if (userId === actor.id && (input.disabled === true || input.role)) {
      throw new ForbiddenException("you can't change your own role or access");
    }

    // A change that strips the target of active-admin standing (demote away
    // from ADMIN, or disable an active ADMIN) must not be allowed to leave the
    // org with zero recoverable admins — recovery would need direct DB surgery.
    const wasActiveAdmin =
      existing.role === Role.ADMIN && existing.disabledAt === null;
    const demotingAdmin = input.role !== undefined && input.role !== 'ADMIN';
    const disablingAdmin = input.disabled === true;
    if (wasActiveAdmin && (demotingAdmin || disablingAdmin)) {
      await this.assertNotLastActiveAdmin(actor.orgId, userId);
    }

    // Only stamp disabledAt + the acting admin on the false→true TRANSITION, so
    // re-disabling an already-disabled user preserves the ORIGINAL timestamp and
    // author. Re-enabling (true→false) clears both. A no-op disabled flag (or an
    // unrelated role/store edit) touches neither.
    const wasDisabled = existing.disabledAt !== null;
    const disableTransition =
      input.disabled === true && !wasDisabled
        ? { disabledAt: new Date(), disabledById: actor.id }
        : input.disabled === false
          ? { disabledAt: null, disabledById: null }
          : {};

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.role ? { role: input.role as Role } : {}),
        ...(input.storeId !== undefined ? { storeId: input.storeId } : {}),
        ...disableTransition,
      },
      include: { store: { select: { name: true } } },
    });
    // Deactivating revokes access immediately by killing live sessions.
    if (input.disabled === true) {
      await this.prisma.session.deleteMany({ where: { userId } });
    }
    return toUserDto(user);
  }

  /**
   * Guard: refuse a mutation that would remove the org's last active admin.
   * Counts the org's ACTIVE (not-disabled) ADMINs excluding `excludeUserId`
   * (the one being demoted/disabled/deleted); throws 409 if that count is 0.
   * Reuse this from any path that strips a user of active-admin standing.
   */
  async assertNotLastActiveAdmin(
    orgId: string,
    excludeUserId: string,
  ): Promise<void> {
    const remaining = await this.prisma.user.count({
      where: {
        orgId,
        role: Role.ADMIN,
        disabledAt: null,
        id: { not: excludeUserId },
      },
    });
    if (remaining === 0) {
      throw new ConflictException(
        'this is the org’s last active admin — promote or enable another admin first',
      );
    }
  }

  /**
   * Hard-delete a user. ADMIN only; org-scoped (404 if not in the caller's org).
   *
   * Real DELETE (the row is removed), justified by the schema relations: Session
   * is onDelete:Cascade (live logins drop), User→Store and the Task
   * completedBy/assignedTo links are SetNull, and the optional Photo.curatedBy /
   * Verdict.lastReviewedBy back-refs default to SetNull — so a delete leaves no
   * dangling rows. The ONE required back-ref is Review.reviewer (default
   * Restrict): a user who has authored reviews can't be hard-deleted without
   * losing audit attribution, so that case is caught (P2003) and surfaced as a
   * 409 telling the admin to deactivate instead.
   *
   * Guards mirror the (de)activation rules: can't delete yourself, and can't
   * delete the org's last active admin (reuses assertNotLastActiveAdmin).
   */
  async deleteUser(actor: SessionUser, userId: string): Promise<void> {
    if (userId === actor.id) {
      throw new ForbiddenException("you can't delete your own account");
    }

    const existing = await this.prisma.user.findFirst({
      where: { id: userId, orgId: actor.orgId },
      select: { id: true, role: true, disabledAt: true },
    });
    if (!existing) throw new NotFoundException('user not found');

    // Deleting an active admin must not strip the org of its last one.
    if (existing.role === Role.ADMIN && existing.disabledAt === null) {
      await this.assertNotLastActiveAdmin(actor.orgId, userId);
    }

    try {
      await this.prisma.user.delete({ where: { id: existing.id } });
    } catch (err) {
      // P2003 = FK constraint (Review.reviewer is a required, Restrict back-ref).
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw new ConflictException(
          'this user has review history and can’t be deleted — deactivate them instead',
        );
      }
      throw err;
    }
  }

  /** Create a task for a store's manager. ADMIN only. */
  async createTask(
    user: SessionUser,
    storeId: string,
    input: CreateTaskInput,
  ): Promise<TaskDto> {
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException('only admins can assign tasks');
    }

    const store = await this.prisma.store.findFirst({
      where: { id: storeId, orgId: user.orgId },
      select: { id: true },
    });
    if (!store) throw new NotFoundException('store not found');

    const campaignId = await this.resolveTaskCampaignId(user.orgId);
    const assignedToId = await this.resolveAssignee(
      user.orgId,
      store.id,
      input.assignedToId,
    );

    const task = await this.prisma.task.create({
      data: {
        orgId: user.orgId,
        storeId: store.id,
        campaignId,
        kind: input.kind as TaskKind,
        status: TaskStatus.OPEN,
        title: input.title,
        body: input.body ?? null,
        fixtureKey: input.fixtureKey ?? null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        assignedToId,
      },
      include: TASK_INCLUDE,
    });

    return toTaskDto(task);
  }

  /**
   * Assign the same task to MANY stores at once (the "assign to all stores"
   * affordance — also the bulk-assign answer to "no recurring tasks"; this is a
   * single fan-out, not a cron template). All target stores are validated in-org
   * in one query, then the rows are created in one createMany for atomicity.
   */
  async bulkCreateTasks(
    user: SessionUser,
    input: BulkCreateTaskInput,
  ): Promise<{ created: number }> {
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException('only admins can assign tasks');
    }

    const uniqueIds = [...new Set(input.storeIds)];
    const stores = await this.prisma.store.findMany({
      where: { id: { in: uniqueIds }, orgId: user.orgId },
      select: { id: true },
    });
    if (stores.length !== uniqueIds.length) {
      throw new NotFoundException(
        'one or more stores were not found in this org',
      );
    }

    const campaignId = await this.resolveTaskCampaignId(user.orgId);
    const dueAt = input.dueAt ? new Date(input.dueAt) : null;

    const result = await this.prisma.task.createMany({
      data: stores.map((s) => ({
        orgId: user.orgId,
        storeId: s.id,
        campaignId,
        kind: input.kind as TaskKind,
        status: TaskStatus.OPEN,
        title: input.title,
        body: input.body ?? null,
        fixtureKey: input.fixtureKey ?? null,
        dueAt,
      })),
    });

    return { created: result.count };
  }

  /**
   * The org's tasks (newest first), optionally narrowed to one store. ADMIN
   * read surface for the Studio task list. Carries the store name per row.
   */
  async listTasks(orgId: string, storeId?: string): Promise<AdminTaskDto[]> {
    const tasks = await this.prisma.task.findMany({
      where: { orgId, ...(storeId ? { storeId } : {}) },
      orderBy: [{ status: 'desc' }, { createdAt: 'desc' }],
      include: { ...TASK_INCLUDE, store: { select: { name: true } } },
    });
    return tasks.map((t) => ({
      ...toTaskDto(t),
      storeId: t.storeId,
      storeName: t.store.name,
    }));
  }

  /**
   * Edit a task: title / body / due date / status. Flipping status to DONE
   * stamps completedAt + the acting admin; back to OPEN clears them. In-org
   * (404 cross-tenant).
   */
  async updateTask(
    user: SessionUser,
    taskId: string,
    input: UpdateTaskInput,
  ): Promise<TaskDto> {
    const existing = await this.prisma.task.findFirst({
      where: { id: taskId, orgId: user.orgId },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException('task not found');

    const statusChange =
      input.status !== undefined && input.status !== existing.status
        ? input.status === 'DONE'
          ? {
              status: TaskStatus.DONE,
              completedAt: new Date(),
              completedById: user.id,
            }
          : { status: TaskStatus.OPEN, completedAt: null, completedById: null }
        : {};

    const task = await this.prisma.task.update({
      where: { id: existing.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.dueAt !== undefined
          ? { dueAt: input.dueAt ? new Date(input.dueAt) : null }
          : {}),
        ...statusChange,
      },
      include: TASK_INCLUDE,
    });

    return toTaskDto(task);
  }

  /** Delete (cancel) a mistaken task. In-org (404 cross-tenant). */
  async deleteTask(orgId: string, taskId: string): Promise<void> {
    const existing = await this.prisma.task.findFirst({
      where: { id: taskId, orgId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('task not found');
    await this.prisma.task.delete({ where: { id: existing.id } });
  }

  /**
   * The campaign a new task is stamped with: the org's ACTIVE campaign, falling
   * back to its most recent, so it's tied to the period being worked.
   */
  private async resolveTaskCampaignId(orgId: string): Promise<string | null> {
    const campaign =
      (await this.prisma.campaign.findFirst({
        where: { orgId, status: CampaignStatus.ACTIVE },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })) ??
      (await this.prisma.campaign.findFirst({
        where: { orgId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      }));
    return campaign?.id ?? null;
  }

  /**
   * Validate an optional individual assignee: must be a user in this org bound
   * to the target store. Returns null when no assignee was given (store-wide).
   */
  private async resolveAssignee(
    orgId: string,
    storeId: string,
    assignedToId?: string,
  ): Promise<string | null> {
    if (!assignedToId) return null;
    const assignee = await this.prisma.user.findFirst({
      where: { id: assignedToId, orgId, storeId },
      select: { id: true },
    });
    if (!assignee) {
      throw new NotFoundException('assignee is not a manager of this store');
    }
    return assignee.id;
  }
}

// Pull the requesting-actor-agnostic relations a TaskDto needs (completed-by /
// assigned-to names). `reads` is intentionally omitted on the admin side — the
// per-user "seen" flag is a manager concern, so admin rows report seen:false.
const TASK_INCLUDE = {
  completedBy: { select: { name: true, email: true } },
  assignedTo: { select: { name: true, email: true } },
} as const;

function toUserDto(u: {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  storeId: string | null;
  disabledAt: Date | null;
  updatedAt: Date;
  store: { name: string } | null;
}): UserDto {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    storeId: u.storeId,
    storeName: u.store?.name ?? null,
    disabled: Boolean(u.disabledAt),
    updatedAt: u.updatedAt.toISOString(),
  };
}
