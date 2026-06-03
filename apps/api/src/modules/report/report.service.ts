import { Injectable, NotFoundException } from '@nestjs/common';
import { Overall as DbOverall } from '@prisma/client';
import type { Overall } from '@wally/types';

import { PrismaService } from '../../prisma/prisma.service';

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
// the campaign, every applicable StoreFixture, the freshest scored photo per
// fixture and its verdict (overall + flagged criteria with evidence), and we
// carry the rubric stamps for the footer (reproducibility — CLAUDE.md).
//
// No image bytes are loaded here. The PDF renders verdict text + flags, not the
// photographs (a person could be in shot; bytes are signed-token-only).
// =============================================================================

// Exhaustive DB-enum → core mapping; throws on an unknown value rather than
// producing undefined.
function dbOverallToCore(db: DbOverall): Overall {
  switch (db) {
    case DbOverall.PERFECT:
      return 'perfect';
    case DbOverall.GOOD:
      return 'good';
    case DbOverall.NOT_GOOD:
      return 'not_good';
    case DbOverall.NEEDS_REVIEW:
      return 'needs_review';
    default: {
      const _exhaustive: never = db;
      throw new Error(`unmapped Overall enum value: ${String(_exhaustive)}`);
    }
  }
}

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

    const fixtures = await this.prisma.storeFixture.findMany({
      where: { storeId, campaignId },
      orderBy: { order: 'asc' },
    });
    if (fixtures.length === 0) {
      throw new NotFoundException('store has no fixtures configured for this campaign');
    }

    const submission = await this.prisma.submission.findUnique({
      where: { storeId_campaignId: { storeId, campaignId } },
      include: {
        photos: {
          orderBy: { createdAt: 'desc' },
          include: {
            verdict: {
              include: {
                rubric: { select: { fixtureKey: true, version: true } },
              },
            },
          },
        },
      },
    });

    // Index the freshest verdict-bearing photo per fixtureKey.
    const scoredByFixture = new Map<
      string,
      {
        overall: Overall;
        confidence: number;
        modelId: string;
        promptVersion: string;
        rubricVersion: string;
        flags: ReportFlag[];
      }
    >();
    const rubricVersions = new Set<string>();

    for (const photo of submission?.photos ?? []) {
      if (scoredByFixture.has(photo.fixtureKey)) continue; // newest wins
      const v = photo.verdict;
      if (!v) continue;

      const stamp = `${v.rubric.fixtureKey}.${campaign.key}.v${v.rubric.version}`;
      rubricVersions.add(stamp);

      // Flagged criteria = the failing / unsure results, with their evidence.
      const results = (v.results as unknown as {
        id: string;
        verdict: string;
        confidence: number;
        evidence: string;
      }[]) ?? [];
      const flags: ReportFlag[] = results
        .filter((r) => r.verdict === 'fail' || r.verdict === 'unsure')
        .map((r) => ({
          criterionId: r.id,
          verdict: r.verdict === 'fail' ? 'fail' : 'unsure',
          confidence: r.confidence,
          evidence: r.evidence,
        }));

      scoredByFixture.set(photo.fixtureKey, {
        overall: dbOverallToCore(v.overall),
        confidence: v.confidence,
        modelId: v.modelId,
        promptVersion: v.promptVersion,
        rubricVersion: stamp,
        flags,
      });
    }

    const reportFixtures: ReportFixture[] = fixtures.map((f) => {
      if (!f.applicable) {
        return {
          fixtureKey: f.fixtureKey,
          label: f.label,
          status: 'not_applicable',
        };
      }
      const scored = scoredByFixture.get(f.fixtureKey);
      if (scored) {
        return {
          fixtureKey: f.fixtureKey,
          label: f.label,
          status: scored.overall,
          confidence: scored.confidence,
          rubricVersion: scored.rubricVersion,
          flags: scored.flags,
        };
      }
      return {
        fixtureKey: f.fixtureKey,
        label: f.label,
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
      rubricVersions: [...rubricVersions].sort(),
    };
  }
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
