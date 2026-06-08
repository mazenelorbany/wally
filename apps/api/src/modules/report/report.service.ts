import { Injectable, NotFoundException } from '@nestjs/common';
import { CaptureVerdict } from '@prisma/client';
import type { Overall } from '@wally/types';

import { PrismaService } from '../../prisma/prisma.service';
import { captureVerdictToOverall } from '../scoring/store-compliance';

import type {
  ReportData,
  ReportFixture,
  ReportFlag,
} from './report.types';

// =============================================================================
// ReportService — assembles the data a compliance PDF needs.
// =============================================================================
//
// Pure data assembly; rendering lives in report.render.ts. We pull the store,
// the campaign, every applicable Placement (the EXPECTED fixtures on the store's
// floor plan), the FixtureCapture per fixture (its submitted photo + AI notes +
// EFFECTIVE verdict), and the campaign's live rubric versions for the footer
// (reproducibility — CLAUDE.md).
//
// MIGRATED to the live FixtureCapture+Placement pipeline (from the legacy
// Submission/Photo/Verdict pipeline). A store doing its work via the floor-plan
// loop (FixtureCapture) used to render an EMPTY PDF because this read the orphaned
// Submission row; it now reads the SAME source the manager floor map writes to:
//   - EXPECTED fixtures = the store's applicable Placements for the campaign
//     (Placement.applicable=true; label = placement.label || fixture.name).
//   - VERDICT per fixture = its FixtureCapture's EFFECTIVE verdict
//     (`overrideVerdict ?? verdict`), mapped CaptureVerdict → core Overall:
//     PASS→good, FAIL→not_good, NEEDS_REVIEW→needs_review. A capture counts as
//     scored only when it has BOTH a photo (storageKey) and an effective verdict.
//
// The report's OUTPUT/render contract (report.types) is preserved — only the
// data SOURCE changed. FixtureCapture carries no per-criterion results, so the
// per-fixture flag list is derived from the model's compare notes (aiNotes) for a
// non-passing verdict (one evidence line), and the rubricVersion stamp comes from
// the campaign's live rubric versions (FixtureCapture has no per-shot rubric FK),
// mirroring SubmissionService.buildStoreScore.
//
// No image bytes are loaded here. The PDF renders verdict text + notes, not the
// photographs (a person could be in shot; bytes are signed-token-only).
// =============================================================================

// Display order for the per-fixture list: failures first, then review, then the
// passes — same attention-first spirit as the reviewer queue.
const FIXTURE_SORT: Record<string, number> = {
  not_good: 0,
  needs_review: 1,
  not_submitted: 2,
  good: 3,
  perfect: 4,
  not_applicable: 5,
};

/** A FixtureCapture row narrowed to what the report renders. */
interface CaptureRow {
  fixtureId: string;
  storageKey: string | null;
  verdict: CaptureVerdict | null;
  overrideVerdict: CaptureVerdict | null;
  aiNotes: string | null;
  confidence: number | null;
}

@Injectable()
export class ReportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build the full report payload for one store × campaign. 404s if the store
   * isn't in the caller's org or the campaign doesn't exist for them.
   */
  async build(
    orgId: string,
    storeId: string,
    campaignId: string,
  ): Promise<ReportData> {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, orgId },
      select: { id: true, name: true, brand: true, externalRef: true },
    });
    if (!store) throw new NotFoundException('store not found');

    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, orgId },
      select: { id: true, key: true, name: true },
    });
    if (!campaign) throw new NotFoundException('campaign not found');

    // EXPECTED fixtures = the store's applicable + not-applicable Placements for
    // this campaign (the floor-plan loop's source of truth). Applicable first,
    // then placement order — the same order the manager compliance sheet uses.
    const placements = await this.prisma.placement.findMany({
      where: { storeId, campaignId },
      orderBy: [{ applicable: 'desc' }, { order: 'asc' }],
      include: { fixture: { select: { name: true } } },
    });
    if (placements.length === 0) {
      throw new NotFoundException(
        'store has no fixtures configured for this campaign',
      );
    }

    // The captures for these fixtures, keyed by fixtureId (the unique row per
    // store+campaign+fixture). One query, then a Map lookup per placement.
    const captures = (await this.prisma.fixtureCapture.findMany({
      where: { storeId, campaignId },
      select: {
        fixtureId: true,
        storageKey: true,
        verdict: true,
        overrideVerdict: true,
        aiNotes: true,
        confidence: true,
      },
    })) as CaptureRow[];
    const captureByFixture = new Map(captures.map((c) => [c.fixtureId, c]));

    // The campaign's live rubric versions stamp the footer (reproducibility).
    // FixtureCapture carries no per-shot rubric FK, so — like buildStoreScore —
    // the report is stamped with the campaign's active grading versions.
    const rubricVersions = await this.rubricVersionsForCampaign(
      campaign.id,
      campaign.key,
    );

    const reportFixtures: ReportFixture[] = placements.map((p) => {
      const label = p.label || p.fixture.name;
      if (!p.applicable) {
        return {
          fixtureKey: p.fixtureId,
          label,
          status: 'not_applicable',
        };
      }

      const capture = captureByFixture.get(p.fixtureId);
      // The EFFECTIVE verdict the floor map trusts: a human override beats the AI.
      const effective = capture?.overrideVerdict ?? capture?.verdict ?? null;

      // Scored = a capture with BOTH a photo and an effective verdict (same rule
      // as loadStoreCompliance). Otherwise the fixture is still outstanding.
      if (capture && capture.storageKey && effective) {
        const overall = captureVerdictToOverall(effective);
        return {
          fixtureKey: p.fixtureId,
          label,
          status: overall,
          ...(capture.confidence != null ? { confidence: capture.confidence } : {}),
          ...(rubricVersions.length > 0 ? { rubricVersion: rubricVersions[0] } : {}),
          flags: captureFlags(overall, capture.aiNotes, capture.confidence),
        };
      }

      return {
        fixtureKey: p.fixtureId,
        label,
        status: 'not_submitted',
      };
    });

    reportFixtures.sort(
      (a, b) =>
        (FIXTURE_SORT[a.status] ?? 9) - (FIXTURE_SORT[b.status] ?? 9) ||
        a.label.localeCompare(b.label),
    );

    // Store-level band derived from the per-fixture statuses (same escalation
    // logic as storeRollup, expressed over the report's fixture list).
    const overall = deriveStoreBand(reportFixtures);

    const applicable = reportFixtures.filter((f) => f.status !== 'not_applicable');
    const submitted = reportFixtures.filter((f) =>
      isScored(f.status),
    ).length;

    return {
      // `generatedAt` is the moment the PDF is produced (its real meaning). The
      // store-level "is this store done" signal now lives in the submitted/expected
      // counts + the derived band below, both sourced from the capture pipeline —
      // there is no submission-level submittedAt in the floor-plan loop.
      generatedAt: new Date(),
      store: {
        id: store.id,
        name: store.name,
        brand: store.brand,
        externalRef: store.externalRef,
      },
      campaign: { id: campaign.id, key: campaign.key, name: campaign.name },
      overall,
      submitted,
      expected: applicable.length,
      fixtures: reportFixtures,
      rubricVersions,
    };
  }

  /**
   * The distinct rubric stamps (`<fixtureKey>.<campaignKey>.v<version>`) for a
   * campaign's ACTIVE rubric versions — the live grading standards the capture
   * scorer resolves (active row per fixtureKey, else highest version). Mirrors
   * SubmissionService.rubricVersionsForCampaign: FixtureCapture has no rubric FK,
   * so the report stamps the campaign's live versions. Returns [] when none.
   */
  private async rubricVersionsForCampaign(
    campaignId: string,
    campaignKey: string,
  ): Promise<string[]> {
    const rubrics = await this.prisma.rubric.findMany({
      where: { campaignId },
      select: { fixtureKey: true, version: true, active: true },
      orderBy: { version: 'desc' },
    });
    const byFixture = new Map<string, number>();
    for (const r of rubrics) {
      const cur = byFixture.get(r.fixtureKey);
      if (cur === undefined) {
        byFixture.set(r.fixtureKey, r.version);
      }
      if (r.active) {
        byFixture.set(r.fixtureKey, r.version);
      }
    }
    const stamps = [...byFixture.entries()].map(
      ([fixtureKey, version]) => `${fixtureKey}.${campaignKey}.v${version}`,
    );
    return [...new Set(stamps)].sort();
  }
}

/**
 * Derive the report's per-fixture flags from a capture. FixtureCapture has no
 * per-criterion result list (unlike the legacy Verdict), so a non-passing fixture
 * surfaces ONE flag carrying the model's compare notes as its evidence — enough
 * for the PDF to show "why" without inventing criterion ids. A passing fixture
 * has no flags (the renderer prints "No flagged criteria.").
 */
function captureFlags(
  overall: Overall,
  aiNotes: string | null,
  confidence: number | null,
): ReportFlag[] {
  if (overall === 'good' || overall === 'perfect') return [];
  const evidence = aiNotes && aiNotes.trim().length > 0 ? aiNotes.trim() : 'No compare notes recorded.';
  return [
    {
      criterionId: 'compliance',
      verdict: overall === 'not_good' ? 'fail' : 'unsure',
      confidence: confidence ?? 0,
      evidence,
    },
  ];
}

function isScored(status: ReportFixture['status']): boolean {
  return (
    status === 'perfect' ||
    status === 'good' ||
    status === 'not_good' ||
    status === 'needs_review'
  );
}

/**
 * Store band from the per-fixture report statuses — mirrors store-rollup's
 * escalation-first ordering: any missing or needs_review → needs_review;
 * else any not_good → not_good; else any good → good; else perfect. If nothing
 * applicable was scored at all → incomplete.
 */
function deriveStoreBand(
  fixtures: ReportFixture[],
): ReportData['overall'] {
  const applicable = fixtures.filter((f) => f.status !== 'not_applicable');
  const scored = applicable.filter((f) => isScored(f.status));
  const missing = applicable.filter((f) => f.status === 'not_submitted');

  if (scored.length === 0) return 'incomplete';
  if (missing.length > 0 || scored.some((f) => f.status === 'needs_review')) {
    return 'needs_review';
  }
  if (scored.some((f) => f.status === 'not_good')) return 'not_good';
  if (scored.some((f) => f.status === 'good')) return 'good';
  return 'perfect';
}
