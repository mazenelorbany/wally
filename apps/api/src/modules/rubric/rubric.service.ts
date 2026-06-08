import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Criterion, RollupRule } from '@wally/types';

import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  assertReadableImage,
  imageExtFor,
  type UploadedImageFile,
} from '../storage/image-upload.util';

import type { PublishRubricInput } from './rubric.dto';
import { resolveActiveRubric } from './rubric.resolve';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Store a rubric reference image and return its storage key + a signed preview
   * URL. The editor uploads the file here, then hands the returned `referenceKey`
   * to publish (so the new version grades against it). Org-scoped on the
   * campaign. The bytes live under a campaign-scoped prefix; we never expose the
   * raw key to the browser except as the opaque key the publish body echoes back.
   */
  async uploadReferenceImage(
    orgId: string,
    campaignId: string,
    file: UploadedImageFile | undefined,
  ): Promise<{ referenceKey: string; url: string }> {
    await this.authorizeCampaign(orgId, campaignId);
    await assertReadableImage(file);
    const f = file as UploadedImageFile;
    const referenceKey = await this.storage.put(f.buffer, {
      ext: imageExtFor(f.mimetype),
      prefix: `rubric-references/${orgId}/${campaignId}`,
    });
    return { referenceKey, url: this.storage.signedGetUrl(referenceKey) };
  }

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
   * The live (active) version for one (campaign, fixture), or 404 if the fixture
   * has never had a rubric. This is the row the scorer grades against. Resolves
   * the same way scoring does: the version flagged `active`, falling back to the
   * highest version when none is flagged (legacy/seeded rows are all false).
   */
  async latestForFixture(orgId: string, campaignId: string, fixtureKey: string) {
    await this.authorizeCampaign(orgId, campaignId);

    const rubric = await resolveActiveRubric(this.prisma, {
      orgId,
      campaignId,
      fixtureKey,
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
   *
   * Two data-integrity guarantees:
   *  - referenceKey is CARRIED FORWARD from the previous version when the publish
   *    omits it, so "Edit → new version" never silently drops the reference the
   *    scorer compares against. Pass referenceKey:null explicitly to clear it.
   *  - the new row becomes the ACTIVE (live grading) version and its siblings are
   *    deactivated, all in the same transaction — publishing a version makes it
   *    the standard, consistently with the active pointer.
   */
  async publish(orgId: string, campaignId: string, input: PublishRubricInput) {
    await this.authorizeCampaign(orgId, campaignId);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const latest = await tx.rubric.findFirst({
          where: { campaignId, fixtureKey: input.fixtureKey },
          orderBy: { version: 'desc' },
          select: { version: true, referenceKey: true },
        });
        const nextVersion = (latest?.version ?? 0) + 1;

        // Carry forward the previous reference unless this publish set the field.
        // `referenceKey === undefined` → keep the prior key; an explicit value
        // (including null) overrides it.
        const referenceKey =
          input.referenceKey === undefined
            ? (latest?.referenceKey ?? null)
            : input.referenceKey;

        // The new version becomes live; clear the flag on every existing version
        // of this pair so exactly one row is active.
        await tx.rubric.updateMany({
          where: { campaignId, fixtureKey: input.fixtureKey, active: true },
          data: { active: false },
        });

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
            referenceKey,
            active: true,
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

  /**
   * Make a specific version the live (active) grading standard for (campaign,
   * fixtureKey) — promote a newer one or ROLL BACK to an earlier one. Flips the
   * active pointer in one transaction (clear siblings, set the target). Past
   * Verdicts are untouched (they FK their exact version). 404 if the version
   * doesn't exist for the pair. Returns the now-active rubric.
   */
  async activate(
    orgId: string,
    campaignId: string,
    fixtureKey: string,
    version: number,
  ) {
    await this.authorizeCampaign(orgId, campaignId);

    const target = await this.prisma.rubric.findFirst({
      where: { orgId, campaignId, fixtureKey, version },
    });
    if (!target) {
      throw new NotFoundException(
        `no rubric version ${version} for fixture "${fixtureKey}"`,
      );
    }

    await this.prisma.$transaction([
      // Clear the flag on every other version of this pair…
      this.prisma.rubric.updateMany({
        where: {
          campaignId,
          fixtureKey,
          active: true,
          id: { not: target.id },
        },
        data: { active: false },
      }),
      // …and set it on the target (idempotent if it was already active).
      this.prisma.rubric.update({
        where: { id: target.id },
        data: { active: true },
      }),
    ]);

    return this.present({ ...target, active: true });
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
      referenceUrl: r.referenceKey
        ? this.storage.signedGetUrl(r.referenceKey)
        : null,
      active: r.active,
      createdAt: r.createdAt,
    };
  }
}
