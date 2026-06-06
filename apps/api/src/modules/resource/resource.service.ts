import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Resource } from '@prisma/client';
import type { ResourceDto, SessionUser } from '@wally/types';

import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

// =============================================================================
// ResourceService — the org's training & reference library. Admins (and
// reviewers) curate it; everyone reads it. Org-scoped, grouped by category,
// no read receipts. Each item is either an external link OR an uploaded file.
// =============================================================================

// (topic = category, sub-topic = subtopic; see schema.prisma Resource model)
@Injectable()
export class ResourceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** The library for the org: pinned first, then topic → sub-topic → order. */
  async list(orgId: string): Promise<ResourceDto[]> {
    const resources = await this.prisma.resource.findMany({
      where: { orgId },
      orderBy: [
        { pinned: 'desc' },
        { category: 'asc' },
        { subtopic: 'asc' },
        { order: 'asc' },
        { createdAt: 'desc' },
      ],
    });
    return resources.map((r) => this.toDto(r));
  }

  /** Add a resource — either a `url` link or an uploaded file (or both). */
  async create(
    user: SessionUser,
    dto: {
      title: string;
      description?: string;
      category?: string;
      subtopic?: string;
      url?: string;
      pinned?: boolean;
    },
    file?: { buffer: Buffer; originalname: string },
  ): Promise<ResourceDto> {
    this.requireCurator(user);

    let attachmentKey: string | null = null;
    let attachmentName: string | null = null;
    if (file) {
      attachmentKey = await this.storage.put(file.buffer, {
        prefix: `resources/${user.orgId}`,
        ext: extOf(file.originalname),
      });
      attachmentName = file.originalname;
    }

    const r = await this.prisma.resource.create({
      data: {
        orgId: user.orgId,
        title: dto.title,
        description: dto.description ?? '',
        category: dto.category?.trim() || 'General',
        subtopic: dto.subtopic?.trim() ?? '',
        url: dto.url ?? null,
        attachmentKey,
        attachmentName,
        pinned: dto.pinned ?? false,
        createdById: user.id,
      },
    });
    return this.toDto(r);
  }

  async update(
    user: SessionUser,
    id: string,
    dto: {
      title?: string;
      description?: string;
      category?: string;
      subtopic?: string;
      url?: string | null;
      pinned?: boolean;
    },
  ): Promise<ResourceDto> {
    this.requireCurator(user);
    const existing = await this.prisma.resource.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('resource not found');

    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.category !== undefined) data.category = dto.category.trim() || 'General';
    if (dto.subtopic !== undefined) data.subtopic = dto.subtopic.trim();
    if (dto.url !== undefined) data.url = dto.url;
    if (dto.pinned !== undefined) data.pinned = dto.pinned;

    const r = await this.prisma.resource.update({ where: { id }, data });
    return this.toDto(r);
  }

  async remove(user: SessionUser, id: string): Promise<void> {
    this.requireCurator(user);
    const { count } = await this.prisma.resource.deleteMany({
      where: { id, orgId: user.orgId },
    });
    if (count === 0) throw new NotFoundException('resource not found');
  }

  // ----- helpers ------------------------------------------------------------

  private requireCurator(user: SessionUser): void {
    if (user.role !== 'ADMIN' && user.role !== 'REVIEWER') {
      throw new ForbiddenException('only an admin can manage resources');
    }
  }

  private toDto(r: Resource): ResourceDto {
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      category: r.category,
      subtopic: r.subtopic,
      url: r.url ?? null,
      attachmentUrl: r.attachmentKey
        ? this.storage.signedGetUrl(r.attachmentKey)
        : null,
      attachmentName: r.attachmentName ?? null,
      pinned: r.pinned,
      createdAt: r.createdAt.toISOString(),
    };
  }
}

function extOf(name: string): string | undefined {
  const m = /\.([a-z0-9]+)$/i.exec(name ?? '');
  return m?.[1]?.toLowerCase();
}
