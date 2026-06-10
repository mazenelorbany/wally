import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { StoreReportStatus } from '@prisma/client';
import type {
  CaptureVerdict as CaptureVerdictDto,
  ComplianceIssue,
  ReportDocFixture,
  ReportFlags,
  StoreReportDocument,
  StoreReportDto,
  StoreReportSummaryDto,
} from '@wally/types';

import { PrismaService } from '../../prisma/prisma.service';
import { loadStoreCompliance } from '../scoring/store-compliance';
import { StorageService } from '../storage/storage.service';

import { LOW_CONFIDENCE_THRESHOLD } from './report.constants';
import { ReportSummaryService } from './report-summary.service';

// Attention-first order for the document's fixture steps (fails first).
const FIXTURE_SORT: Record<string, number> = {
  FAIL: 0,
  NEEDS_REVIEW: 1,
  not_submitted: 2,
  PASS: 3,
  not_applicable: 4,
};

// =============================================================================
// StoreReportService — the submittable report envelope over a store's campaign
// work (fixture captures + extra-question answers). Computes the total score
// (pass-rate %) and the attention flags from the SAME source the floor map and
// leaderboard read (loadStoreCompliance → effective verdict), never the legacy
// Submission/Photo pipeline.
// =============================================================================

interface ScoreParts {
  totalScore: number | null;
  expected: number;
  scored: number;
  nonCompliant: boolean;
}

interface QuestionStats {
  total: number;
  answered: number;
  requiredUnanswered: number;
}

@Injectable()
export class StoreReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly summary: ReportSummaryService,
  ) {}

  /** Pass-rate % across applicable fixtures + the non-compliant signal. */
  private async scoreParts(storeId: string, campaignId: string): Promise<ScoreParts> {
    const { outcomes } = await loadStoreCompliance(this.prisma, storeId, campaignId);
    const applicable = outcomes.filter((o) => o.status !== 'not_applicable');
    const scored = applicable.filter((o) => o.status === 'scored');
    const passing = scored.filter(
      (o) => o.overall === 'good' || o.overall === 'perfect',
    );
    const expected = applicable.length;
    return {
      totalScore: expected > 0 ? Math.round((passing.length / expected) * 100) : null,
      expected,
      scored: scored.length,
      nonCompliant: scored.some((o) => o.overall === 'not_good'),
    };
  }

  /** Whether any scored capture's AI confidence is below the threshold. */
  private async hasLowConfidence(storeId: string, campaignId: string): Promise<boolean> {
    const captures = await this.prisma.fixtureCapture.findMany({
      where: { storeId, campaignId, storageKey: { not: null } },
      select: { confidence: true, overrideVerdict: true },
    });
    // A human override supersedes the AI verdict, so its confidence no longer matters.
    return captures.some(
      (c) =>
        c.overrideVerdict == null &&
        c.confidence != null &&
        c.confidence < LOW_CONFIDENCE_THRESHOLD,
    );
  }

  /** Extra-question progress for a store. */
  private async questionStats(
    orgId: string,
    storeId: string,
    campaignId: string,
  ): Promise<QuestionStats> {
    const questions = await this.prisma.campaignQuestion.findMany({
      where: { campaignId, orgId, archivedAt: null },
      select: { id: true, required: true },
    });
    const answers = await this.prisma.storeQuestionAnswer.findMany({
      where: { storeId, campaignId },
      select: { questionId: true, valueText: true, valueBool: true, isNA: true },
    });
    const byQuestion = new Map(answers.map((a) => [a.questionId, a]));
    const isAnswered = (a?: {
      valueText: string | null;
      valueBool: boolean | null;
      isNA: boolean;
    }) =>
      Boolean(
        a &&
          (a.isNA ||
            a.valueBool != null ||
            (a.valueText != null && a.valueText.trim().length > 0)),
      );
    let answered = 0;
    let requiredUnanswered = 0;
    for (const q of questions) {
      const ok = isAnswered(byQuestion.get(q.id));
      if (ok) answered += 1;
      if (q.required && !ok) requiredUnanswered += 1;
    }
    return { total: questions.length, answered, requiredUnanswered };
  }

  /** The store's report DTO (status, score, flags, progress). Computes live. */
  async getReport(
    orgId: string,
    storeId: string,
    campaignId: string,
  ): Promise<StoreReportDto> {
    const report = await this.prisma.storeReport.findUnique({
      where: { storeId_campaignId: { storeId, campaignId } },
      include: { submittedBy: { select: { name: true, email: true } } },
    });

    const score = await this.scoreParts(storeId, campaignId);
    const questions = await this.questionStats(orgId, storeId, campaignId);
    const checklist = await this.checklistStats(storeId, campaignId);
    const lowConfidence = await this.hasLowConfidence(storeId, campaignId);

    const hasWork =
      score.scored > 0 || questions.answered > 0 || checklist.checked > 0;
    const status = deriveStatus(report?.status ?? null, hasWork);
    const submitted = status === 'SUBMITTED';
    const incomplete =
      score.expected > score.scored ||
      questions.requiredUnanswered > 0 ||
      checklist.requiredUnchecked > 0 ||
      !submitted;

    const flags: ReportFlags = {
      nonCompliant: score.nonCompliant,
      lowConfidence,
      incomplete,
      notSubmitted: !submitted,
    };

    // A submitted report shows its frozen score; a draft shows the live score.
    const totalScore = submitted
      ? (report?.totalScore ?? score.totalScore)
      : score.totalScore;

    return {
      storeId,
      campaignId,
      status,
      assignedAt: report?.assignedAt ? report.assignedAt.toISOString() : null,
      dueAt: report?.dueAt ? report.dueAt.toISOString() : null,
      submittedAt: report?.submittedAt ? report.submittedAt.toISOString() : null,
      submittedByName:
        report?.submittedBy?.name || report?.submittedBy?.email || null,
      totalScore: totalScore ?? null,
      fixturesExpected: score.expected,
      fixturesScored: score.scored,
      questionsTotal: questions.total,
      questionsAnswered: questions.answered,
      requiredUnanswered: questions.requiredUnanswered,
      checklistTotal: checklist.total,
      checklistChecked: checklist.checked,
      requiredUnchecked: checklist.requiredUnchecked,
      flags,
      aiSummary: report?.aiSummary ?? null,
      summarizedAt: report?.summarizedAt ? report.summarizedAt.toISOString() : null,
    };
  }

  /** Per-fixture checklist progress for a store (items authored on guide fixtures). */
  private async checklistStats(
    storeId: string,
    campaignId: string,
  ): Promise<{ total: number; checked: number; requiredUnchecked: number }> {
    const items = await this.prisma.guideFixtureChecklistItem.findMany({
      where: {
        archivedAt: null,
        guideFixture: { campaignId },
      },
      select: { id: true, required: true },
    });
    if (items.length === 0) return { total: 0, checked: 0, requiredUnchecked: 0 };
    const ticks = await this.prisma.storeChecklistTick.findMany({
      where: { storeId, campaignId, checked: true },
      select: { itemId: true },
    });
    const tickedIds = new Set(ticks.map((t) => t.itemId));
    let checked = 0;
    let requiredUnchecked = 0;
    for (const it of items) {
      const isChecked = tickedIds.has(it.id);
      if (isChecked) checked += 1;
      if (it.required && !isChecked) requiredUnchecked += 1;
    }
    return { total: items.length, checked, requiredUnchecked };
  }

  /**
   * Flip a store's report PENDING/DRAFT → IN_PROGRESS on the first edit (photo,
   * answer, or checklist tick). Creates the row if none exists. Never downgrades
   * a SUBMITTED/REOPENED/IN_PROGRESS report.
   */
  async markInProgress(
    orgId: string,
    storeId: string,
    campaignId: string,
    userId: string,
  ): Promise<void> {
    const existing = await this.prisma.storeReport.findUnique({
      where: { storeId_campaignId: { storeId, campaignId } },
      select: { id: true, status: true, startedAt: true },
    });
    if (!existing) {
      await this.prisma.storeReport.create({
        data: {
          orgId,
          storeId,
          campaignId,
          status: 'IN_PROGRESS',
          startedAt: new Date(),
        },
      });
      return;
    }
    if (existing.status === 'PENDING' || existing.status === 'DRAFT') {
      await this.prisma.storeReport.update({
        where: { id: existing.id },
        data: { status: 'IN_PROGRESS', startedAt: existing.startedAt ?? new Date() },
      });
    }
  }

  /**
   * Send (assign) the campaign's report to stores — upsert a PENDING StoreReport
   * per store, stamping assignedAt/By + optional dueAt. Idempotent: a store that
   * has already started/submitted keeps its status (only the assignment metadata
   * is re-stamped). Returns how many were sent.
   */
  async sendToStores(
    orgId: string,
    campaignId: string,
    storeIds: string[],
    userId: string,
    dueAt?: Date | null,
  ): Promise<{ sent: number }> {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, orgId },
      select: { id: true },
    });
    if (!campaign) throw new NotFoundException('campaign not found');

    const uniqueIds = [...new Set(storeIds)];
    const stores = await this.prisma.store.findMany({
      where: { id: { in: uniqueIds }, orgId },
      select: { id: true },
    });
    if (stores.length !== uniqueIds.length) {
      throw new NotFoundException('one or more stores were not found in this org');
    }

    let sent = 0;
    for (const s of stores) {
      const existing = await this.prisma.storeReport.findUnique({
        where: { storeId_campaignId: { storeId: s.id, campaignId } },
        select: { id: true, status: true },
      });
      const inFlight =
        existing &&
        (existing.status === 'IN_PROGRESS' ||
          existing.status === 'SUBMITTED' ||
          existing.status === 'REOPENED');
      if (existing) {
        await this.prisma.storeReport.update({
          where: { id: existing.id },
          data: {
            // Don't reset a started/submitted report back to PENDING.
            ...(inFlight ? {} : { status: 'PENDING' }),
            assignedAt: new Date(),
            assignedById: userId,
            ...(dueAt !== undefined ? { dueAt } : {}),
          },
        });
      } else {
        await this.prisma.storeReport.create({
          data: {
            orgId,
            storeId: s.id,
            campaignId,
            status: 'PENDING',
            assignedAt: new Date(),
            assignedById: userId,
            dueAt: dueAt ?? null,
          },
        });
      }
      sent += 1;
    }
    return { sent };
  }

  /** Submit the store's report (DRAFT/REOPENED → SUBMITTED). Freezes the score. */
  async submit(
    orgId: string,
    storeId: string,
    campaignId: string,
    userId: string,
  ): Promise<StoreReportDto> {
    const score = await this.scoreParts(storeId, campaignId);
    const questions = await this.questionStats(orgId, storeId, campaignId);
    const checklist = await this.checklistStats(storeId, campaignId);
    if (questions.requiredUnanswered > 0) {
      throw new BadRequestException(
        `answer all required questions before submitting (${questions.requiredUnanswered} left)`,
      );
    }
    if (checklist.requiredUnchecked > 0) {
      throw new BadRequestException(
        `complete all required checklist items before submitting (${checklist.requiredUnchecked} left)`,
      );
    }
    await this.prisma.storeReport.upsert({
      where: { storeId_campaignId: { storeId, campaignId } },
      create: {
        orgId,
        storeId,
        campaignId,
        status: 'SUBMITTED',
        submittedAt: new Date(),
        submittedById: userId,
        totalScore: score.totalScore,
      },
      update: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
        submittedById: userId,
        totalScore: score.totalScore,
      },
    });
    // Best-effort AI summary on submit (never blocks the submit on a model hiccup).
    try {
      await this.generateSummaryFor(orgId, storeId, campaignId);
    } catch {
      // summarize() already swallows its own errors; this guards getDocument too.
    }
    return this.getReport(orgId, storeId, campaignId);
  }

  /** Regenerate the AI summary on demand (admin "Generate / Regenerate"). */
  async regenerateSummary(
    orgId: string,
    storeId: string,
    campaignId: string,
  ): Promise<StoreReportDocument> {
    await this.generateSummaryFor(orgId, storeId, campaignId);
    return this.getDocument(orgId, storeId, campaignId);
  }

  /** Build the summary input from the document, call the model, persist the result. */
  private async generateSummaryFor(
    orgId: string,
    storeId: string,
    campaignId: string,
  ): Promise<void> {
    const doc = await this.getDocument(orgId, storeId, campaignId);
    const result = await this.summary.summarize({
      storeName: doc.store.name,
      campaignName: doc.campaign.name,
      totalScore: doc.totalScore ?? null,
      fixtures: doc.fixtures
        .filter((f) => f.status !== 'not_applicable')
        .map((f) => ({
          label: f.label,
          verdict: f.status === 'not_submitted' ? 'NO PHOTO' : (f.verdict ?? '?'),
          issues: (f.issues ?? []).map((i) => i.label),
        })),
      flags: doc.flags,
      questions: doc.questions.map((q) => ({
        label: q.label,
        answer: q.isNA
          ? 'N/A'
          : q.type === 'YES_NO'
            ? q.valueBool == null
              ? '—'
              : q.valueBool
                ? 'Yes'
                : 'No'
            : q.valueText && q.valueText.trim()
              ? q.valueText
              : '—',
      })),
    });
    await this.prisma.storeReport.upsert({
      where: { storeId_campaignId: { storeId, campaignId } },
      create: {
        orgId,
        storeId,
        campaignId,
        aiSummary: result?.text ?? null,
        summaryModelId: result?.modelId ?? null,
        summarizedAt: result ? new Date() : null,
      },
      update: {
        aiSummary: result?.text ?? null,
        summaryModelId: result?.modelId ?? null,
        summarizedAt: result ? new Date() : null,
      },
    });
  }

  /** Reopen a submitted report (SUBMITTED → REOPENED) so a store can re-shoot. */
  async reopen(
    orgId: string,
    storeId: string,
    campaignId: string,
  ): Promise<StoreReportDto> {
    await this.prisma.storeReport.updateMany({
      where: { storeId, campaignId, orgId, status: 'SUBMITTED' },
      data: { status: 'REOPENED' },
    });
    return this.getReport(orgId, storeId, campaignId);
  }

  /**
   * The full rendered report document for one store × campaign — the Myer-style
   * report: header (status, score, AI summary, flags) + every fixture step (photo
   * gallery, verdict, flagged issues, completed-by) + every extra-question answer.
   * Shared by the manager's read-only view and the admin's report view.
   */
  async getDocument(
    orgId: string,
    storeId: string,
    campaignId: string,
  ): Promise<StoreReportDocument> {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, orgId },
      select: { id: true, name: true, brand: true },
    });
    if (!store) throw new NotFoundException('store not found');
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, orgId },
      select: { id: true, key: true, name: true },
    });
    if (!campaign) throw new NotFoundException('campaign not found');

    const envelope = await this.getReport(orgId, storeId, campaignId);

    const placements = await this.prisma.placement.findMany({
      where: { storeId, campaignId },
      orderBy: [{ applicable: 'desc' }, { order: 'asc' }],
      include: { fixture: { select: { name: true } } },
    });
    const captures = await this.prisma.fixtureCapture.findMany({
      where: { storeId, campaignId },
      include: {
        photos: { where: { archivedAt: null }, orderBy: { order: 'asc' } },
        attempts: {
          orderBy: { capturedAt: 'desc' },
          take: 1,
          include: { capturedBy: { select: { name: true, email: true } } },
        },
      },
    });
    const captureByFixture = new Map(captures.map((c) => [c.fixtureId, c]));

    // Per-fixture checklist items + this store's ticked state.
    const guideFixtures = await this.prisma.guideFixture.findMany({
      where: { campaignId, orgId },
      select: {
        fixtureId: true,
        checklistItems: {
          where: { archivedAt: null },
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, label: true, required: true },
        },
      },
    });
    const tickRows = await this.prisma.storeChecklistTick.findMany({
      where: { storeId, campaignId, checked: true },
      select: { itemId: true },
    });
    const tickedIds = new Set(tickRows.map((t) => t.itemId));
    const checklistByFixture = new Map(
      guideFixtures.map((gf) => [
        gf.fixtureId,
        gf.checklistItems.map((c) => ({
          id: c.id,
          label: c.label,
          required: c.required,
          checked: tickedIds.has(c.id),
        })),
      ]),
    );

    const fixtures: ReportDocFixture[] = placements.map((p) => {
      const label = p.label || p.fixture.name;
      const checklist = checklistByFixture.get(p.fixtureId) ?? [];
      if (!p.applicable) {
        return {
          fixtureId: p.fixtureId,
          label,
          status: 'not_applicable',
          photos: [],
          checklist,
        };
      }
      const cap = captureByFixture.get(p.fixtureId);
      const effective = cap?.overrideVerdict ?? cap?.verdict ?? null;
      const scored = Boolean(cap && cap.storageKey && effective);
      const latest = cap?.attempts?.[0];
      return {
        fixtureId: p.fixtureId,
        label,
        status: scored ? 'scored' : 'not_submitted',
        verdict: scored ? (effective as CaptureVerdictDto) : null,
        confidence: cap?.confidence ?? null,
        aiNotes: cap?.aiNotes ?? null,
        issues: asIssues(cap?.aiIssues),
        photos: (cap?.photos ?? []).map((ph) => ({
          id: ph.id,
          url: this.storage.signedGetUrl(ph.storageKey),
          issues: asIssues(ph.aiIssues),
        })),
        checklist,
        completedByName: latest
          ? latest.capturedBy?.name || latest.capturedBy?.email || null
          : null,
        completedAt: latest ? latest.capturedAt.toISOString() : null,
      };
    });
    fixtures.sort(
      (a, b) =>
        (FIXTURE_SORT[a.verdict ?? a.status] ?? 9) -
          (FIXTURE_SORT[b.verdict ?? b.status] ?? 9) ||
        a.label.localeCompare(b.label),
    );

    const questions = await this.prisma.campaignQuestion.findMany({
      where: { campaignId, orgId, archivedAt: null },
      orderBy: { order: 'asc' },
    });
    const answers = await this.prisma.storeQuestionAnswer.findMany({
      where: { storeId, campaignId },
      include: { answeredBy: { select: { name: true, email: true } } },
    });
    const answerByQuestion = new Map(answers.map((a) => [a.questionId, a]));

    return {
      store,
      campaign,
      status: envelope.status,
      submittedAt: envelope.submittedAt,
      submittedByName: envelope.submittedByName,
      totalScore: envelope.totalScore,
      aiSummary: envelope.aiSummary,
      summarizedAt: envelope.summarizedAt,
      flags: envelope.flags,
      fixtures,
      questions: questions.map((q) => {
        const a = answerByQuestion.get(q.id);
        return {
          id: q.id,
          label: q.label,
          type: q.type,
          valueText: a?.valueText ?? null,
          valueBool: a?.valueBool ?? null,
          isNA: a?.isNA ?? false,
          answeredByName: a
            ? a.answeredBy?.name || a.answeredBy?.email || null
            : null,
          answeredAt: a?.answeredAt ? a.answeredAt.toISOString() : null,
        };
      }),
    };
  }

  /** The admin reports list for a campaign: one flag-bearing row per store. */
  async listForCampaign(
    orgId: string,
    campaignId: string,
  ): Promise<StoreReportSummaryDto[]> {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, orgId },
      select: { id: true },
    });
    if (!campaign) throw new NotFoundException('campaign not found');

    // Stores that have a floor plan for this campaign (placements exist).
    const placed = await this.prisma.placement.findMany({
      where: { campaignId, orgId },
      select: { storeId: true },
      distinct: ['storeId'],
    });
    const stores = await this.prisma.store.findMany({
      where: { id: { in: placed.map((p) => p.storeId) }, orgId, closedAt: null },
      select: { id: true, name: true, brand: true, region: true },
      orderBy: [{ brand: 'asc' }, { name: 'asc' }],
    });

    const reports = await this.prisma.storeReport.findMany({
      where: { campaignId, orgId },
    });
    const reportByStore = new Map(reports.map((r) => [r.storeId, r]));

    const rows: StoreReportSummaryDto[] = [];
    for (const store of stores) {
      const report = reportByStore.get(store.id);
      const score = await this.scoreParts(store.id, campaignId);
      const questions = await this.questionStats(orgId, store.id, campaignId);
      const checklist = await this.checklistStats(store.id, campaignId);
      const lowConfidence = await this.hasLowConfidence(store.id, campaignId);
      const hasWork =
        score.scored > 0 || questions.answered > 0 || checklist.checked > 0;
      const status = deriveStatus(report?.status ?? null, hasWork);
      const submitted = status === 'SUBMITTED';
      rows.push({
        storeId: store.id,
        storeName: store.name,
        brand: store.brand,
        region: store.region,
        status,
        totalScore: submitted
          ? (report?.totalScore ?? score.totalScore)
          : score.totalScore,
        assignedAt: report?.assignedAt ? report.assignedAt.toISOString() : null,
        dueAt: report?.dueAt ? report.dueAt.toISOString() : null,
        submittedAt: report?.submittedAt ? report.submittedAt.toISOString() : null,
        flags: {
          nonCompliant: score.nonCompliant,
          lowConfidence,
          incomplete:
            score.expected > score.scored ||
            questions.requiredUnanswered > 0 ||
            checklist.requiredUnchecked > 0 ||
            !submitted,
          notSubmitted: !submitted,
        },
      });
    }
    return rows;
  }
}

/**
 * The status the UI shows. A legacy DRAFT (or no row) reads as IN_PROGRESS when
 * any work exists, else PENDING; a PENDING row with work reads IN_PROGRESS;
 * otherwise the stored status stands.
 */
function deriveStatus(
  stored: StoreReportStatus | null,
  hasWork: boolean,
): StoreReportStatus {
  if (!stored || stored === 'DRAFT') return hasWork ? 'IN_PROGRESS' : 'PENDING';
  if (stored === 'PENDING' && hasWork) return 'IN_PROGRESS';
  return stored;
}

/** Coerce a persisted JSON value back into ComplianceIssue[] (trust-but-verify). */
function asIssues(value: unknown): ComplianceIssue[] {
  if (!Array.isArray(value)) return [];
  const out: ComplianceIssue[] = [];
  for (const it of value) {
    if (!it || typeof it !== 'object') continue;
    const row = it as Record<string, unknown>;
    if (typeof row.label !== 'string') continue;
    out.push({
      label: row.label,
      fix: typeof row.fix === 'string' ? row.fix : null,
      severity:
        row.severity === 'major' || row.severity === 'minor' ? row.severity : null,
      box:
        row.box && typeof row.box === 'object'
          ? (row.box as ComplianceIssue['box'])
          : null,
      photoIndex: typeof row.photoIndex === 'number' ? row.photoIndex : 0,
    });
  }
  return out;
}
