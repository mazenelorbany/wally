import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

import type { CreateStoreInput } from './store.dto';

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

  create(orgId: string, input: CreateStoreInput) {
    return this.prisma.store.create({
      data: {
        orgId,
        name: input.name,
        brand: input.brand,
        externalRef: input.externalRef ?? null,
      },
    });
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
