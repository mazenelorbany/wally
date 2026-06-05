import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CampaignStatus, TaskKind, TaskStatus } from '@prisma/client';
import type { SessionUser, TaskDto } from '@wally/types';

import { PrismaService } from '../../prisma/prisma.service';
import { toTaskDto } from '../manager/manager.service';

import type { CreateTaskInput } from './admin.dto';

// =============================================================================
// AdminService — admin-only task assignment.
//
// An ADMIN assigns a task to a store (its manager). The store is validated
// in-org (404 cross-tenant), and the task is stamped with the org's active
// campaign (fallback: most recent) so it shows up against the right period.
// =============================================================================
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

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
