import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CampaignStatus, Role } from '@prisma/client';
import type { Bulletin } from '@prisma/client';
import type {
  BulletinAckRow,
  BulletinDto,
  BulletinScheduleState,
  SessionUser,
} from '@wally/types';

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
    const ackTotal = await this.managerPopulation(projectId);
    const bulletins = await this.prisma.bulletin.findMany({
      where: { projectId, orgId },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      include: { _count: { select: { acks: true } } },
    });
    // Admin sees out-of-window bulletins, badged scheduled/live/expired — never
    // hidden — so an admin can find and fix a mis-dated memo.
    const now = new Date();
    return bulletins.map((b) =>
      this.toDto(b, b._count.acks, ackTotal, this.scheduleStateOf(b, now)),
    );
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
    const ackTotal = await this.managerPopulation(projectId);
    return this.toDto(b, 0, ackTotal, this.scheduleStateOf(b, new Date()));
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
      removeAttachment?: boolean;
    },
    file?: { buffer: Buffer; originalname: string },
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

    // Attachment lifecycle: a new file replaces (and orphan-cleans) the old key;
    // removeAttachment with no file nulls it. A replacement wins over removal.
    let keyToDelete: string | null = null;
    if (file) {
      data.attachmentKey = await this.storage.put(file.buffer, {
        prefix: `bulletins/${existing.projectId}`,
        ext: extOf(file.originalname),
      });
      data.attachmentName = file.originalname;
      keyToDelete = existing.attachmentKey;
    } else if (dto.removeAttachment) {
      data.attachmentKey = null;
      data.attachmentName = null;
      keyToDelete = existing.attachmentKey;
    }

    const b = await this.prisma.bulletin.update({
      where: { id },
      data,
      include: { _count: { select: { acks: true } } },
    });
    // Orphan-clean the superseded storage object after the row is committed
    // (best-effort; a missing key is not an error per StorageService.remove).
    if (keyToDelete && keyToDelete !== b.attachmentKey) {
      await this.storage.remove(keyToDelete);
    }
    const ackTotal = await this.managerPopulation(b.projectId);
    return this.toDto(
      b,
      b._count.acks,
      ackTotal,
      this.scheduleStateOf(b, new Date()),
    );
  }

  async remove(user: SessionUser, id: string): Promise<void> {
    this.requireAuthor(user);
    const { count } = await this.prisma.bulletin.deleteMany({
      where: { id, orgId: user.orgId },
    });
    if (count === 0) throw new NotFoundException('bulletin not found');
  }

  /**
   * Who has acknowledged: one row per must-read manager (every store manager in
   * the project's active stores), with WHO acknowledged + WHEN. A manager who
   * hasn't acknowledged shows as pending; their ack carries their identity so the
   * roster attributes the read receipt to a person, not just a store.
   */
  async acks(orgId: string, id: string): Promise<BulletinAckRow[]> {
    const b = await this.prisma.bulletin.findFirst({
      where: { id, orgId },
      select: { id: true, projectId: true },
    });
    if (!b) throw new NotFoundException('bulletin not found');
    const [managers, acks] = await Promise.all([
      // The must-read population: active managers in the project's active stores.
      this.prisma.user.findMany({
        where: {
          role: Role.STORE_MANAGER,
          disabledAt: null,
          store: { projectId: b.projectId, closedAt: null },
        },
        select: {
          id: true,
          name: true,
          email: true,
          storeId: true,
          store: { select: { name: true } },
        },
      }),
      this.prisma.bulletinAck.findMany({
        where: { bulletinId: id },
        select: { userId: true, acknowledgedAt: true },
      }),
    ]);
    const byUser = new Map(acks.map((a) => [a.userId, a.acknowledgedAt]));
    const rows: BulletinAckRow[] = managers.map((m) => ({
      storeId: m.storeId ?? '',
      storeName: m.store?.name ?? '—',
      userId: m.id,
      userName: m.name ?? null,
      userEmail: m.email,
      acknowledged: byUser.has(m.id),
      acknowledgedAt: byUser.get(m.id)?.toISOString() ?? null,
    }));
    // Acknowledged first, then by store/name for a stable, scannable roster.
    rows.sort((a, x) => {
      if (a.acknowledged !== x.acknowledged) return a.acknowledged ? -1 : 1;
      return (
        a.storeName.localeCompare(x.storeName) ||
        (a.userName ?? a.userEmail ?? '').localeCompare(
          x.userName ?? x.userEmail ?? '',
        )
      );
    });
    return rows;
  }

  // ----- manager ------------------------------------------------------------

  /**
   * Published, in-window bulletins for the manager's store's project, with the
   * signed-in manager's own ack flag (per-user, not per-store). Out-of-window
   * bulletins (future startsAt or past endsAt) are HIDDEN from managers — a
   * scheduled memo isn't live yet and an expired one has retired.
   */
  async mine(user: SessionUser, storeIdParam?: string): Promise<BulletinDto[]> {
    const { storeId, projectId } = await this.resolveStore(user, storeIdParam);
    if (!projectId) return [];
    const ackTotal = await this.managerPopulation(projectId);
    const now = new Date();
    const bulletins = await this.prisma.bulletin.findMany({
      where: {
        projectId,
        orgId: user.orgId,
        publishedAt: { not: null },
        // In-window only: (startsAt == null || startsAt <= now) &&
        //                 (endsAt   == null || endsAt   >= now)
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
      include: {
        _count: { select: { acks: true } },
        // The signed-in manager's own ack — per user, so a co-manager's ack does
        // not clear this manager's "must read".
        acks: { where: { userId: user.id }, select: { id: true } },
      },
    });
    return bulletins.map((b) => ({
      ...this.toDto(b, b._count.acks, ackTotal, this.scheduleStateOf(b, now)),
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
    // Per-user read receipt; storeId is recorded for roster context. Upserting on
    // (bulletinId, userId) makes a repeat ack idempotent for the same manager.
    await this.prisma.bulletinAck.upsert({
      where: { bulletinId_userId: { bulletinId: id, userId: user.id } },
      create: { bulletinId: id, storeId, userId: user.id },
      update: { storeId },
    });
  }

  /** Undo my own acknowledgement (an accidental ack isn't permanent). */
  async unacknowledge(
    user: SessionUser,
    id: string,
    storeIdParam?: string,
  ): Promise<void> {
    await this.resolveStore(user, storeIdParam);
    const b = await this.prisma.bulletin.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true },
    });
    if (!b) throw new NotFoundException('bulletin not found');
    // Self-undo only: scoped to this user's own ack row. A no-op if not acked.
    await this.prisma.bulletinAck.deleteMany({
      where: { bulletinId: id, userId: user.id },
    });
  }

  // ----- helpers ------------------------------------------------------------

  private requireAuthor(user: SessionUser): void {
    if (user.role !== 'ADMIN' && user.role !== 'REVIEWER') {
      throw new ForbiddenException('only an admin can manage bulletins');
    }
  }

  /**
   * The "must read" coverage denominator: the count of active store managers in
   * the project's active stores. Every manager must read + acknowledge, so the
   * population is the manager headcount — NOT the store count (a store with two
   * co-managers owes two acks, a store with none owes zero). A closed (retired)
   * store and a disabled user are excluded.
   */
  private managerPopulation(projectId: string): Promise<number> {
    return this.prisma.user.count({
      where: {
        role: Role.STORE_MANAGER,
        disabledAt: null,
        store: { projectId, closedAt: null },
      },
    });
  }

  /** Schedule state from the window vs now; null for a draft (no publishedAt). */
  private scheduleStateOf(
    b: Bulletin,
    now: Date,
  ): BulletinScheduleState | null {
    if (!b.publishedAt) return null;
    if (b.startsAt && b.startsAt > now) return 'scheduled';
    if (b.endsAt && b.endsAt < now) return 'expired';
    return 'live';
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

  private toDto(
    b: Bulletin,
    ackCount: number,
    ackTotal: number,
    scheduleState: BulletinScheduleState | null = null,
  ): BulletinDto {
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
      scheduleState,
    };
  }
}

function extOf(name: string): string | undefined {
  const m = /\.([a-z0-9]+)$/i.exec(name ?? '');
  return m?.[1]?.toLowerCase();
}
