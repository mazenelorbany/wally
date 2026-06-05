import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CampaignStatus, Role, TaskKind, TaskStatus } from '@prisma/client';
import type { SessionUser, TaskDto, UserDto } from '@wally/types';

import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { toTaskDto } from '../manager/manager.service';

import type {
  CreateTaskInput,
  InviteUserInput,
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
   */
  async inviteUser(orgId: string, input: InviteUserInput): Promise<UserDto> {
    const user = await this.prisma.user.upsert({
      where: { email: input.email },
      create: {
        orgId,
        email: input.email,
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
      email: input.email,
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
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('user not found');
    if (userId === actor.id && (input.disabled === true || input.role)) {
      throw new ForbiddenException("you can't change your own role or access");
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.role ? { role: input.role as Role } : {}),
        ...(input.storeId !== undefined ? { storeId: input.storeId } : {}),
        ...(input.disabled === true ? { disabledAt: new Date() } : {}),
        ...(input.disabled === false ? { disabledAt: null } : {}),
      },
      include: { store: { select: { name: true } } },
    });
    // Deactivating revokes access immediately by killing live sessions.
    if (input.disabled === true) {
      await this.prisma.session.deleteMany({ where: { userId } });
    }
    return toUserDto(user);
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

    // Stamp the task with the active campaign (fallback: most recent) so it's
    // tied to the period the manager is currently working.
    const campaign =
      (await this.prisma.campaign.findFirst({
        where: { orgId: user.orgId, status: CampaignStatus.ACTIVE },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })) ??
      (await this.prisma.campaign.findFirst({
        where: { orgId: user.orgId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      }));

    const task = await this.prisma.task.create({
      data: {
        orgId: user.orgId,
        storeId: store.id,
        campaignId: campaign?.id ?? null,
        kind: input.kind as TaskKind,
        status: TaskStatus.OPEN,
        title: input.title,
        body: input.body ?? null,
        fixtureKey: input.fixtureKey ?? null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
      },
    });

    return toTaskDto(task);
  }
}

function toUserDto(u: {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  storeId: string | null;
  disabledAt: Date | null;
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
  };
}
