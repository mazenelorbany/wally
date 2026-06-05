import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CampaignStatus } from '@prisma/client';
import type { Bulletin } from '@prisma/client';
import type { BulletinAckRow, BulletinDto, SessionUser } from '@wally/types';

import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

// =============================================================================
// BulletinService — the per-sale memo for a project. Admins author + publish;
// store managers read + acknowledge. Everything is org-scoped.
// =============================================================================

@Injectable()
export class BulletinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // ----- admin --------------------------------------------------------------

  /** The project's bulletin feed, pinned first then newest, with ack rollups. */
  async list(orgId: string, projectId: string): Promise<BulletinDto[]> {
    await this.requireProject(orgId, projectId);
    const ackTotal = await this.prisma.store.count({ where: { projectId } });
    const bulletins = await this.prisma.bulletin.findMany({
      where: { projectId, orgId },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      include: { _count: { select: { acks: true } } },
    });
    return bulletins.map((b) => this.toDto(b, b._count.acks, ackTotal));
  }

  /** Author a bulletin, optionally with an attached PDF/image. */
  async create(
    user: SessionUser,
    projectId: string,
    dto: {
      title: string;
      body?: string;
      startsAt?: string;
      endsAt?: string;
      pinned?: boolean;
      publish?: boolean;
    },
    file?: { buffer: Buffer; originalname: string },
  ): Promise<BulletinDto> {
    this.requireAuthor(user);
    await this.requireProject(user.orgId, projectId);

    let attachmentKey: string | null = null;
    let attachmentName: string | null = null;
    if (file) {
      attachmentKey = await this.storage.put(file.buffer, {
        prefix: `bulletins/${projectId}`,
        ext: extOf(file.originalname),
      });
      attachmentName = file.originalname;
    }

    // Tie it to the project's active sale, when there is one.
    const campaign = await this.prisma.campaign.findFirst({
      where: { projectId, status: CampaignStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    const b = await this.prisma.bulletin.create({
      data: {
        orgId: user.orgId,
        projectId,
        campaignId: campaign?.id ?? null,
        title: dto.title,
        body: dto.body ?? '',
        pinned: dto.pinned ?? false,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        attachmentKey,
        attachmentName,
        publishedAt: dto.publish ? new Date() : null,
        createdById: user.id,
      },
    });
    const ackTotal = await this.prisma.store.count({ where: { projectId } });
    return this.toDto(b, 0, ackTotal);
  }

  async update(
    user: SessionUser,
    id: string,
    dto: {
      title?: string;
      body?: string;
      startsAt?: string | null;
      endsAt?: string | null;
      pinned?: boolean;
      publish?: boolean;
    },
  ): Promise<BulletinDto> {
    this.requireAuthor(user);
    const existing = await this.prisma.bulletin.findFirst({
      where: { id, orgId: user.orgId },
    });
    if (!existing) throw new NotFoundException('bulletin not found');

    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.body !== undefined) data.body = dto.body;
    if (dto.pinned !== undefined) data.pinned = dto.pinned;
    if (dto.startsAt !== undefined)
      data.startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
    if (dto.endsAt !== undefined)
      data.endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (dto.publish !== undefined)
      data.publishedAt = dto.publish ? (existing.publishedAt ?? new Date()) : null;

    const b = await this.prisma.bulletin.update({
      where: { id },
      data,
      include: { _count: { select: { acks: true } } },
    });
    const ackTotal = await this.prisma.store.count({
      where: { projectId: b.projectId },
    });
    return this.toDto(b, b._count.acks, ackTotal);
  }

  async remove(user: SessionUser, id: string): Promise<void> {
    this.requireAuthor(user);
    const { count } = await this.prisma.bulletin.deleteMany({
      where: { id, orgId: user.orgId },
    });
    if (count === 0) throw new NotFoundException('bulletin not found');
  }

  /** Who has acknowledged: every store in the project + its ack state. */
  async acks(orgId: string, id: string): Promise<BulletinAckRow[]> {
    const b = await this.prisma.bulletin.findFirst({
      where: { id, orgId },
      select: { id: true, projectId: true },
    });
    if (!b) throw new NotFoundException('bulletin not found');
    const [stores, acks] = await Promise.all([
      this.prisma.store.findMany({
        where: { projectId: b.projectId },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      this.prisma.bulletinAck.findMany({
        where: { bulletinId: id },
        select: { storeId: true, acknowledgedAt: true },
      }),
    ]);
    const byStore = new Map(acks.map((a) => [a.storeId, a.acknowledgedAt]));
    return stores.map((s) => ({
      storeId: s.id,
      storeName: s.name,
      acknowledged: byStore.has(s.id),
      acknowledgedAt: byStore.get(s.id)?.toISOString() ?? null,
    }));
  }

  // ----- manager ------------------------------------------------------------

  /** Published bulletins for the manager's store's project, with my-ack flag. */
  async mine(user: SessionUser, storeIdParam?: string): Promise<BulletinDto[]> {
    const { storeId, projectId } = await this.resolveStore(user, storeIdParam);
    if (!projectId) return [];
    const ackTotal = await this.prisma.store.count({ where: { projectId } });
    const bulletins = await this.prisma.bulletin.findMany({
      where: { projectId, orgId: user.orgId, publishedAt: { not: null } },
      orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
      include: {
        _count: { select: { acks: true } },
        acks: { where: { storeId }, select: { id: true } },
      },
    });
    return bulletins.map((b) => ({
      ...this.toDto(b, b._count.acks, ackTotal),
      acknowledged: b.acks.length > 0,
    }));
  }

  async acknowledge(
    user: SessionUser,
    id: string,
    storeIdParam?: string,
  ): Promise<void> {
    const { storeId } = await this.resolveStore(user, storeIdParam);
    const b = await this.prisma.bulletin.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true },
    });
    if (!b) throw new NotFoundException('bulletin not found');
    await this.prisma.bulletinAck.upsert({
      where: { bulletinId_storeId: { bulletinId: id, storeId } },
      create: { bulletinId: id, storeId, userId: user.id },
      update: {},
    });
  }

  // ----- helpers ------------------------------------------------------------

  private requireAuthor(user: SessionUser): void {
    if (user.role !== 'ADMIN' && user.role !== 'REVIEWER') {
      throw new ForbiddenException('only an admin can manage bulletins');
    }
  }

  private async requireProject(orgId: string, projectId: string): Promise<void> {
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, orgId },
      select: { id: true },
    });
    if (!p) throw new NotFoundException('project not found');
  }

  private async resolveStore(
    user: SessionUser,
    storeIdParam?: string,
  ): Promise<{ storeId: string; projectId: string | null }> {
    let storeId: string | undefined;
    if (user.role === 'STORE_MANAGER') {
      storeId = user.storeId ?? undefined;
      if (!storeId) throw new NotFoundException('no store for this manager');
    } else {
      storeId =
        storeIdParam ??
        (
          await this.prisma.store.findFirst({
            where: { orgId: user.orgId },
            orderBy: { name: 'asc' },
            select: { id: true },
          })
        )?.id;
    }
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, orgId: user.orgId },
      select: { id: true, projectId: true },
    });
    if (!store) throw new NotFoundException('store not found');
    return { storeId: store.id, projectId: store.projectId };
  }

  private toDto(b: Bulletin, ackCount: number, ackTotal: number): BulletinDto {
    return {
      id: b.id,
      projectId: b.projectId,
      campaignId: b.campaignId,
      title: b.title,
      body: b.body,
      pinned: b.pinned,
      startsAt: b.startsAt?.toISOString() ?? null,
      endsAt: b.endsAt?.toISOString() ?? null,
      attachmentUrl: b.attachmentKey
        ? this.storage.signedGetUrl(b.attachmentKey)
        : null,
      attachmentName: b.attachmentName ?? null,
      publishedAt: b.publishedAt?.toISOString() ?? null,
      createdAt: b.createdAt.toISOString(),
      ackCount,
      ackTotal,
    };
  }
}

function extOf(name: string): string | undefined {
  const m = /\.([a-z0-9]+)$/i.exec(name ?? '');
  return m?.[1]?.toLowerCase();
}
