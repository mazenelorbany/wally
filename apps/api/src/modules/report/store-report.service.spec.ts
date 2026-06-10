import { describe, it, expect } from 'vitest';

import { StoreReportService } from './store-report.service';

// =============================================================================
// StoreReportService — total score (pass-rate %) + attention flags.
//
// The score and flags derive from the SAME source the floor map reads
// (placements + fixtureCapture → effective verdict), so this drives an in-memory
// Prisma double seeded with a mix of pass / fail / unscored fixtures, a
// low-confidence capture, and a required-but-unanswered question, then asserts
// the computed StoreReportDto.
// =============================================================================

const ORG = 'org_1';
const STORE = 'store_1';
const CAMPAIGN = 'camp_1';

interface Seed {
  placements: { fixtureId: string; applicable: boolean }[];
  captures: {
    fixtureId: string;
    storageKey: string | null;
    verdict: string | null;
    overrideVerdict?: string | null;
    confidence?: number | null;
  }[];
  questions?: { id: string; required: boolean }[];
  answers?: { questionId: string; valueText?: string | null; valueBool?: boolean | null; isNA?: boolean }[];
  report?: { status: string; totalScore?: number | null } | null;
}

function makePrisma(seed: Seed) {
  return {
    storeReport: {
      findUnique: async () =>
        seed.report
          ? { ...seed.report, submittedAt: null, submittedBy: null, aiSummary: null, summarizedAt: null }
          : null,
    },
    placement: {
      findMany: async () =>
        seed.placements.map((p) => ({
          fixtureId: p.fixtureId,
          label: p.fixtureId,
          applicable: p.applicable,
          order: 0,
          fixture: { name: p.fixtureId },
        })),
    },
    fixtureCapture: {
      findMany: async ({ where }: { where?: { storageKey?: unknown } } = {}) => {
        // The hasLowConfidence query filters storageKey not-null; loadStoreCompliance
        // passes no such filter. Honour the filter when present.
        const rows = seed.captures.map((c) => ({
          fixtureId: c.fixtureId,
          storageKey: c.storageKey,
          verdict: c.verdict,
          overrideVerdict: c.overrideVerdict ?? null,
          confidence: c.confidence ?? null,
          uploadedAt: new Date(),
          scoredAt: new Date(),
        }));
        if (where?.storageKey) return rows.filter((r) => r.storageKey != null);
        return rows;
      },
    },
    campaignQuestion: {
      findMany: async () =>
        (seed.questions ?? []).map((q) => ({ id: q.id, required: q.required })),
    },
    storeQuestionAnswer: {
      findMany: async () =>
        (seed.answers ?? []).map((a) => ({
          questionId: a.questionId,
          valueText: a.valueText ?? null,
          valueBool: a.valueBool ?? null,
          isNA: a.isNA ?? false,
        })),
    },
    // No checklist items/ticks in these score+flags fixtures.
    guideFixtureChecklistItem: { findMany: async () => [] },
    storeChecklistTick: { findMany: async () => [] },
  };
}

function svc(seed: Seed) {
  const storage = { signedGetUrl: (k: string) => `https://signed/${k}` };
  const summary = { summarize: async () => null };
  return new StoreReportService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    makePrisma(seed) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    storage as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    summary as any,
  );
}

describe('StoreReportService — score + flags', () => {
  it('scores pass-rate over applicable fixtures and flags FAIL + low confidence', async () => {
    const s = svc({
      placements: [
        { fixtureId: 'a', applicable: true },
        { fixtureId: 'b', applicable: true },
        { fixtureId: 'c', applicable: true },
        { fixtureId: 'd', applicable: false }, // not applicable — excluded
      ],
      captures: [
        { fixtureId: 'a', storageKey: 'k', verdict: 'PASS', confidence: 0.9 },
        { fixtureId: 'b', storageKey: 'k', verdict: 'FAIL', confidence: 0.8 },
        { fixtureId: 'c', storageKey: 'k', verdict: 'PASS', confidence: 0.4 }, // low conf
      ],
    });
    const r = await s.getReport(ORG, STORE, CAMPAIGN);
    expect(r.fixturesExpected).toBe(3);
    expect(r.fixturesScored).toBe(3);
    // 2 of 3 passing → 67%.
    expect(r.totalScore).toBe(67);
    expect(r.flags.nonCompliant).toBe(true); // b failed
    expect(r.flags.lowConfidence).toBe(true); // c at 0.4
    expect(r.flags.notSubmitted).toBe(true); // no report row
    expect(r.flags.incomplete).toBe(true); // not submitted
  });

  it('an override clears the low-confidence flag for that capture', async () => {
    const s = svc({
      placements: [{ fixtureId: 'a', applicable: true }],
      captures: [
        // Low AI confidence, but a human override → confidence no longer counts.
        { fixtureId: 'a', storageKey: 'k', verdict: 'NEEDS_REVIEW', overrideVerdict: 'PASS', confidence: 0.2 },
      ],
    });
    const r = await s.getReport(ORG, STORE, CAMPAIGN);
    expect(r.flags.lowConfidence).toBe(false);
    expect(r.totalScore).toBe(100); // effective verdict is PASS
  });

  it('flags incomplete when a required question is unanswered', async () => {
    const s = svc({
      placements: [{ fixtureId: 'a', applicable: true }],
      captures: [{ fixtureId: 'a', storageKey: 'k', verdict: 'PASS', confidence: 0.9 }],
      questions: [{ id: 'q1', required: true }],
      answers: [],
      report: { status: 'SUBMITTED', totalScore: 100 },
    });
    const r = await s.getReport(ORG, STORE, CAMPAIGN);
    expect(r.questionsTotal).toBe(1);
    expect(r.questionsAnswered).toBe(0);
    expect(r.requiredUnanswered).toBe(1);
    expect(r.flags.incomplete).toBe(true);
  });

  it('a fully passing, submitted report with all questions answered is clear', async () => {
    const s = svc({
      placements: [{ fixtureId: 'a', applicable: true }],
      captures: [{ fixtureId: 'a', storageKey: 'k', verdict: 'PASS', confidence: 0.95 }],
      questions: [{ id: 'q1', required: true }],
      answers: [{ questionId: 'q1', valueText: 'Alex' }],
      report: { status: 'SUBMITTED', totalScore: 100 },
    });
    const r = await s.getReport(ORG, STORE, CAMPAIGN);
    expect(r.status).toBe('SUBMITTED');
    expect(r.flags).toEqual({
      nonCompliant: false,
      lowConfidence: false,
      incomplete: false,
      notSubmitted: false,
    });
  });
});
