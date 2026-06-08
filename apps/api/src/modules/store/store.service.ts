import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { StoreSegments } from '@wally/types';

import { PrismaService } from '../../prisma/prisma.service';

import type { CreateStoreInput, UpdateStoreInput } from './store.dto';

/** Trim + collapse internal whitespace; map an empty result to null. */
function normalizeSegment(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = value.trim().replace(/\s+/g, ' ');
  return cleaned.length > 0 ? cleaned : null;
}

@Injectable()
export class StoreService {
  constructor(private readonly prisma: PrismaService) {}

  list(orgId: string) {
    return this.prisma.store.findMany({
      where: { orgId },
      orderBy: [{ brand: 'asc' }, { name: 'asc' }],
    });
  }

  /** Fetch a store, scoped to the caller's org (404 if it belongs elsewhere). */
  async get(orgId: string, storeId: string) {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, orgId },
    });
    if (!store) throw new NotFoundException('store not found');
    return store;
  }

  /**
   * The org's existing DISTINCT segmentation values (non-null, trimmed, sorted).
   * Backs the directory comboboxes so segment labels converge rather than
   * fragmenting the analytics filters. The lightweight alternative to a per-org
   * option-list table: we read what's already in use.
   */
  async segments(orgId: string): Promise<StoreSegments> {
    const rows = await this.prisma.store.findMany({
      where: { orgId },
      select: { region: true, storeType: true, areaManager: true },
    });
    const distinct = (pick: (r: (typeof rows)[number]) => string | null) =>
      [
        ...new Set(
          rows
            .map((r) => normalizeSegment(pick(r)))
            .filter((v): v is string => v !== null),
        ),
      ].sort((a, b) => a.localeCompare(b));
    return {
      regions: distinct((r) => r.region),
      storeTypes: distinct((r) => r.storeType),
      areaManagers: distinct((r) => r.areaManager),
    };
  }

  /**
   * Confirm a projectId belongs to the caller's org. 400 (bad input) if missing
   * id, 404 if it's not an in-org project — so an admin can never silently park a
   * store under another tenant's project (or a typo'd id).
   */
  private async requireProjectInOrg(
    orgId: string,
    projectId: string,
  ): Promise<void> {
    if (!projectId.trim()) {
      throw new BadRequestException('projectId must not be empty');
    }
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, orgId },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException('project not found in this org');
    }
  }

  async create(orgId: string, input: CreateStoreInput) {
    if (input.projectId !== undefined) {
      await this.requireProjectInOrg(orgId, input.projectId);
    }
    return this.prisma.store.create({
      data: {
        orgId,
        name: input.name,
        brand: input.brand,
        projectId: input.projectId ?? null,
        externalRef: input.externalRef ?? null,
        region: normalizeSegment(input.region),
        areaManager: normalizeSegment(input.areaManager),
        storeType: normalizeSegment(input.storeType),
      },
    });
  }

  /** Patch a store's profile + segmentation dims (org-scoped). */
  async update(orgId: string, storeId: string, input: UpdateStoreInput) {
    // A non-null projectId must resolve to an in-org project (null detaches).
    if (input.projectId !== undefined && input.projectId !== null) {
      await this.requireProjectInOrg(orgId, input.projectId);
    }

    // Normalize segmentation dims on the way in; pass everything else through.
    const data: Record<string, unknown> = { ...input };
    for (const key of ['region', 'storeType', 'areaManager'] as const) {
      if (key in input) data[key] = normalizeSegment(input[key]);
    }

    const res = await this.prisma.store.updateMany({
      where: { id: storeId, orgId },
      data,
    });
    if (res.count === 0) throw new NotFoundException('store not found');
    return this.get(orgId, storeId);
  }

  /** Deactivate (retire) a store — stamps closedAt=now. ADMIN, org-scoped. */
  async deactivate(orgId: string, storeId: string) {
    const res = await this.prisma.store.updateMany({
      where: { id: storeId, orgId },
      data: { closedAt: new Date() },
    });
    if (res.count === 0) throw new NotFoundException('store not found');
    return this.get(orgId, storeId);
  }

  /** Reactivate a previously closed store — clears closedAt. ADMIN, org-scoped. */
  async reactivate(orgId: string, storeId: string) {
    const res = await this.prisma.store.updateMany({
      where: { id: storeId, orgId },
      data: { closedAt: null },
    });
    if (res.count === 0) throw new NotFoundException('store not found');
    return this.get(orgId, storeId);
  }

  /**
   * The per-store fixture checklist for one campaign, in display order.
   * StoreFixture carries applicability ("we don't have VM table 3") and the
   * `order` that drives the checklist UI.
   */
  async fixtures(orgId: string, storeId: string, campaignId?: string) {
    // Authorise the store first so we never leak fixtures across tenants.
    await this.get(orgId, storeId);
    return this.prisma.storeFixture.findMany({
      where: {
        storeId,
        ...(campaignId ? { campaignId } : {}),
      },
      orderBy: [{ campaignId: 'asc' }, { order: 'asc' }],
    });
  }
}
