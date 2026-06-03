import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Overall as DbOverall, Prisma, ReviewAction } from '@prisma/client';
import type {
  Criterion,
  CriterionResult,
  Overall,
  RollupRule,
  VerdictValue,
} from '@wally/types';

import { PrismaService } from '../../prisma/prisma.service';
import { fixtureRollup } from '../scoring/rollup';

import type { CreateReviewInput } from './review.dto';

// =============================================================================
// ReviewService — human-in-the-loop over machine verdicts.
// =============================================================================
//
// A reviewer CONFIRMs, OVERRIDEs, or ESCALATEs a Verdict. Every action writes an
// immutable Review row (the audit trail). Only OVERRIDE mutates the Verdict, and
// even then it never re-grades freehand: it flips ONE criterion's per-photo
// result, then re-runs the SAME pure fixtureRollup() the scorer used, with the
// SAME stamp (modelId/promptVersion/rubricVersion/rule) so the recomputed
// overall stays reproducible and consistent with the scoring core.
// =============================================================================

// core (lowercase) → DB enum (UPPERCASE). One mapping at the boundary.
const OVERALL_CORE_TO_DB: Record<Overall, DbOverall> = {
  perfect: DbOverall.PERFECT,
  good: DbOverall.GOOD,
  not_good: DbOverall.NOT_GOOD,
  needs_review: DbOverall.NEEDS_REVIEW,
};

@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a review action on a verdict. Authorises the verdict against the
   * caller's org (via the photo → submission → org chain) before doing anything.
   */
  async review(
    orgId: string,
    reviewerId: string,
    verdictId: string,
    input: CreateReviewInput,
  ) {
    const verdict = await this.prisma.verdict.findFirst({
      where: { id: verdictId, photo: { submission: { orgId } } },
      include: { rubric: { include: { campaign: { select: { key: true } } } } },
    });
    if (!verdict) throw new NotFoundException('verdict not found');

    if (input.action === ReviewAction.OVERRIDE) {
      return this.override(reviewerId, verdict, input);
    }
    // CONFIRM / ESCALATE: audit-only, no verdict mutation.
    return this.recordAudit(reviewerId, verdict.id, input);
  }

  // ----- override ----------------------------------------------------------

  /**
   * Flip one criterion on the verdict and recompute the fixture rollup. Wrapped
   * in a transaction so the Review row and the recomputed Verdict commit
   * together — an observer never sees one without the other.
   */
  private async override(
    reviewerId: string,
    verdict: Prisma.VerdictGetPayload<{
      include: { rubric: { include: { campaign: { select: { key: true } } } } };
    }>,
    input: CreateReviewInput,
  ) {
    // superRefine already guarantees these on OVERRIDE; assert for the types.
    const criterionId = input.criterionId!;
    const toVerdict = input.toVerdict!;

    const criteria = verdict.rubric.criteria as unknown as Criterion[];
    if (!criteria.some((c) => c.id === criterionId)) {
      throw new BadRequestException(
        `criterion "${criterionId}" is not in this verdict's rubric`,
      );
    }

    const current = verdict.results as unknown as CriterionResult[];
    const fromVerdict =
      current.find((r) => r.id === criterionId)?.verdict ?? null;

    // Apply the human correction. A human decision is certain (confidence 1) and
    // the evidence records who/why so the override is self-documenting.
    const overridden = upsertResult(current, criterionId, toVerdict, input.reason);

    // Recompute with the SAME stamp the scorer used — reproducible, not freehand.
    // Canonical stamp: <fixtureKey>.<campaignKey>.v<version>.
    const rubricVersion = `${verdict.rubric.fixtureKey}.${verdict.rubric.campaign.key}.v${verdict.rubric.version}`;
    const rolled = fixtureRollup(overridden, criteria, {
      modelId: verdict.modelId,
      promptVersion: verdict.promptVersion,
      rubricVersion,
      rule: verdict.rubric.rollupRule as unknown as RollupRule,
    });

    return this.prisma.$transaction(async (tx) => {
      const review = await tx.review.create({
        data: {
          verdictId: verdict.id,
          criterionId,
          action: ReviewAction.OVERRIDE,
          fromVerdict,
          toVerdict,
          reason: input.reason ?? null,
          reviewerId,
        },
      });
      const updated = await tx.verdict.update({
        where: { id: verdict.id },
        data: {
          overall: OVERALL_CORE_TO_DB[rolled.overall],
          needsReview: rolled.needsReview,
          confidence: rolled.confidence,
          results: rolled.results as unknown as Prisma.InputJsonValue,
        },
      });
      return { review, verdict: this.presentVerdict(updated) };
    });
  }

  // ----- confirm / escalate ------------------------------------------------

  private async recordAudit(
    reviewerId: string,
    verdictId: string,
    input: CreateReviewInput,
  ) {
    const review = await this.prisma.review.create({
      data: {
        verdictId,
        criterionId: input.criterionId ?? null,
        action: input.action as ReviewAction,
        reason: input.reason ?? null,
        reviewerId,
      },
    });
    return { review };
  }

  private presentVerdict(v: {
    id: string;
    overall: DbOverall;
    needsReview: boolean;
    confidence: number;
    results: Prisma.JsonValue;
  }) {
    const coreOverall = (Object.keys(OVERALL_CORE_TO_DB) as Overall[]).find(
      (k) => OVERALL_CORE_TO_DB[k] === v.overall,
    )!;
    return {
      id: v.id,
      overall: coreOverall,
      needsReview: v.needsReview,
      confidence: v.confidence,
      results: v.results,
    };
  }
}

/**
 * Return a new results array with `criterionId` set to `toVerdict`. If the
 * scorer never produced a result for that criterion (it escalated as missing),
 * we add one — so an override always leaves a concrete, gradeable entry.
 */
function upsertResult(
  results: CriterionResult[],
  criterionId: string,
  toVerdict: VerdictValue,
  reason?: string,
): CriterionResult[] {
  const evidence = `human override${reason ? `: ${reason}` : ''}`;
  const exists = results.some((r) => r.id === criterionId);
  if (exists) {
    return results.map((r) =>
      r.id === criterionId
        ? { ...r, verdict: toVerdict, confidence: 1, evidence }
        : r,
    );
  }
  return [
    ...results,
    { id: criterionId, verdict: toVerdict, confidence: 1, evidence },
  ];
}
