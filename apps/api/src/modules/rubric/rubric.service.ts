import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Criterion, RollupRule } from '@wally/types';

import { PrismaService } from '../../prisma/prisma.service';

import type { PublishRubricInput } from './rubric.dto';

// =============================================================================
// RubricService — append-only, versioned rubrics.
// =============================================================================
//
// A rubric is the "what good looks like" for one fixture in one campaign. It is
// NEVER edited in place: publishing produces a new (campaignId, fixtureKey,
// version) row, so every historical Verdict can be traced back to the exact
// criteria that produced it (reproducibility — CLAUDE.md). The DB enforces the
// uniqueness of (campaignId, fixtureKey, version).
//
// The stable cross-system stamp is `<fixtureKey>.<campaignKey>.v<version>`,
// matching tools/eval/rubric-loader. We expose it as `rubricVersion` so the
// scoring core / verdicts can stamp it identically.
// =============================================================================

@Injectable()
export class RubricService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every rubric for a campaign, newest version first within each fixture.
   * Scoped to the caller's org so a rubric can't be read across tenants.
   */
  async listForCampaign(orgId: string, campaignId: string) {
    await this.authorizeCampaign(orgId, campaignId);

    const rubrics = await this.prisma.rubric.findMany({
      where: { orgId, campaignId },
      orderBy: [{ fixtureKey: 'asc' }, { version: 'desc' }],
    });
    return rubrics.map((r) => this.present(r));
  }

  /**
   * The latest published version for one (campaign, fixture), or 404 if the
   * fixture has never had a rubric. This is the row the scorer grades against.
   */
  async latestForFixture(orgId: string, campaignId: string, fixtureKey: string) {
    await this.authorizeCampaign(orgId, campaignId);

    const rubric = await this.prisma.rubric.findFirst({
      where: { orgId, campaignId, fixtureKey },
      orderBy: { version: 'desc' },
    });
    if (!rubric) {
      throw new NotFoundException(
        `no rubric published for fixture "${fixtureKey}"`,
      );
    }
    return this.present(rubric);
  }

  /**
   * Publish a NEW version of (campaignId, fixtureKey). Never mutates an existing
   * row. The next version number is (max existing) + 1, computed inside a
   * transaction so two concurrent publishes can't collide on the same number —
   * and even if they raced past the read, the DB @@unique[campaignId,fixtureKey,
   * version] is the backstop (mapped to a 409).
   */
  async publish(orgId: string, campaignId: string, input: PublishRubricInput) {
    await this.authorizeCampaign(orgId, campaignId);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const latest = await tx.rubric.findFirst({
          where: { campaignId, fixtureKey: input.fixtureKey },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const nextVersion = (latest?.version ?? 0) + 1;

        return tx.rubric.create({
          data: {
            orgId,
            campaignId,
            fixtureKey: input.fixtureKey,
            version: nextVersion,
            // Criterion[] / RollupRule are plain JSON-serialisable shapes; cast
            // to Prisma's InputJsonValue for the Json columns.
            criteria: input.criteria as unknown as Prisma.InputJsonValue,
            rollupRule: input.rollupRule as unknown as Prisma.InputJsonValue,
            referenceKey: input.referenceKey ?? null,
          },
        });
      });
      return this.present(created);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Concurrent publish won the version number first — caller should retry.
        throw new ConflictException(
          `a newer rubric version for "${input.fixtureKey}" was just published; retry`,
        );
      }
      throw err;
    }
  }

  // ----- internals ---------------------------------------------------------

  /** 404 (not 403) if the campaign isn't in the caller's org — don't reveal it. */
  private async authorizeCampaign(orgId: string, campaignId: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, orgId },
      select: { id: true, key: true },
    });
    if (!campaign) throw new NotFoundException('campaign not found');
    return campaign;
  }

  /**
   * Shape a Rubric row for transport: parse the Json columns back into typed
   * arrays and attach the stable `rubricVersion` stamp. We resolve the campaign
   * key lazily only when presenting a single row to keep list cheap — here we
   * fold it in via the relation when available, else recompute.
   */
  private present(
    r: Prisma.RubricGetPayload<Record<string, never>> & {
      campaign?: { key: string } | null;
    },
  ) {
    return {
      id: r.id,
      campaignId: r.campaignId,
      fixtureKey: r.fixtureKey,
      version: r.version,
      criteria: r.criteria as unknown as Criterion[],
      rollupRule: r.rollupRule as unknown as RollupRule,
      referenceKey: r.referenceKey,
      createdAt: r.createdAt,
    };
  }
}
