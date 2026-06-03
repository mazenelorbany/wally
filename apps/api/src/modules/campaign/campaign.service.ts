import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CampaignStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import type { CreateCampaignInput } from './campaign.dto';

@Injectable()
export class CampaignService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every campaign in the caller's org, newest first, with a store-coverage
   * count so the list view can show "12 stores" without an N+1. We count the
   * distinct stores that have a submission against the campaign — that's the
   * useful number for a reviewer planning a sweep.
   */
  async list(orgId: string) {
    const campaigns = await this.prisma.campaign.findMany({
      where: { orgId },
      orderBy: [{ createdAt: 'desc' }],
      include: { _count: { select: { submissions: true } } },
    });
    return campaigns.map((c) => ({
      id: c.id,
      key: c.key,
      name: c.name,
      status: c.status,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      createdAt: c.createdAt,
      storeCount: c._count.submissions,
    }));
  }

  /** A single campaign, scoped to the caller's org (404 across tenants). */
  async get(orgId: string, campaignId: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, orgId },
    });
    if (!campaign) throw new NotFoundException('campaign not found');
    return campaign;
  }

  /** Create a DRAFT campaign. key is unique per org (DB @@unique[orgId,key]). */
  async create(orgId: string, input: CreateCampaignInput) {
    try {
      return await this.prisma.campaign.create({
        data: {
          orgId,
          key: input.key,
          name: input.name,
          status: CampaignStatus.DRAFT,
          startsAt: input.startsAt ?? null,
          endsAt: input.endsAt ?? null,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `a campaign with key "${input.key}" already exists`,
        );
      }
      throw err;
    }
  }

  /**
   * Make a campaign the ACTIVE one. A retailer runs one live sweep at a time,
   * so activating a campaign closes any other ACTIVE campaign in the same org.
   * Done in a transaction so there's never a window with two ACTIVE campaigns.
   */
  async setActive(orgId: string, campaignId: string) {
    await this.get(orgId, campaignId); // authorise + 404

    return this.prisma.$transaction(async (tx) => {
      await tx.campaign.updateMany({
        where: { orgId, status: CampaignStatus.ACTIVE, id: { not: campaignId } },
        data: { status: CampaignStatus.CLOSED },
      });
      return tx.campaign.update({
        where: { id: campaignId },
        data: { status: CampaignStatus.ACTIVE },
      });
    });
  }
}
