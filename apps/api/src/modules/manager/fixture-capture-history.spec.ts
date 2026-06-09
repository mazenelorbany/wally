import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SessionUser } from '@wally/types';

import { ManagerService } from './manager.service';
import type {
  ComplianceScoreInput,
  ComplianceScoreResult,
} from './compliance-scorer.service';

// =============================================================================
// Fixture-capture history + reviewer override (Batch 11a).
//
// Fix for "FixtureCapture stores only the latest AI verdict — re-shoots overwrite,
// no history": every uploadFixturePhoto now writes an immutable
// FixtureCaptureAttempt while the FixtureCapture row stays the CURRENT pointer.
// A FAIL → reshoot → PASS sequence must therefore preserve BOTH shots (history
// not lost), and a reviewer OVERRIDE must set the EFFECTIVE verdict
// (overrideVerdict ?? verdict) that compliance / money-map / UI display.
//
// Prisma is mocked at the fixtureCapture / fixtureCaptureAttempt boundary with a
// faithful in-memory double (mirrors review.contract.spec.ts), and the scorer +
// storage are stubbed so the upload resolves deterministically without I/O.
// =============================================================================

const ORG = 'org_1';
const STORE = 'store_1';
const CAMPAIGN = 'camp_1';
const FIXTURE = 'fix_1';

const MANAGER: SessionUser = {
  id: 'mgr_1',
  email: 'mgr_1@x',
  orgId: ORG,
  role: 'STORE_MANAGER',
  storeId: STORE,
};

const REVIEWER: SessionUser = {
  id: 'rev_1',
  email: 'rev_1@x',
  orgId: ORG,
  role: 'REVIEWER',
  storeId: null,
};

interface CaptureRow {
  id: string;
  orgId: string;
  storeId: string;
  campaignId: string;
  fixtureId: string;
  needsPhoto: boolean;
  storageKey: string | null;
  uploadedAt: Date | null;
  verdict: string | null;
  aiNotes: string | null;
  confidence: number | null;
  modelId: string | null;
  scoredAt: Date | null;
  requestedById: string | null;
  requestedAt: Date | null;
  reviewedById: string | null;
  reviewedAt: Date | null;
  overrideVerdict: string | null;
  overrideNote: string | null;
}

interface AttemptRow {
  id: string;
  orgId: string;
  captureId: string;
  storageKey: string;
  verdict: string | null;
  aiNotes: string | null;
  confidence: number | null;
  modelId: string | null;
  capturedById: string | null;
  capturedAt: Date;
}

/**
 * An in-memory Prisma double for the capture loop: one fixtureCapture row per
 * (store, campaign, fixture) plus the append-only attempt log, with the relation
 * includes the service uses (requestedBy / reviewedBy / attempts.capturedBy).
 */
function makePrisma() {
  const captures: CaptureRow[] = [];
  const attempts: AttemptRow[] = [];
  let seq = 0;

  const keyOf = (w: {
    storeId_campaignId_fixtureId?: {
      storeId: string;
      campaignId: string;
      fixtureId: string;
    };
    id?: string;
  }) => w;

  const findCapture = (where: {
    storeId_campaignId_fixtureId?: {
      storeId: string;
      campaignId: string;
      fixtureId: string;
    };
    id?: string;
  }) => {
    const u = where.storeId_campaignId_fixtureId;
    if (u) {
      return captures.find(
        (c) =>
          c.storeId === u.storeId &&
          c.campaignId === u.campaignId &&
          c.fixtureId === u.fixtureId,
      );
    }
    return captures.find((c) => c.id === where.id);
  };

  const hydrate = (c: CaptureRow) => ({
    ...c,
    requestedBy: c.requestedById
      ? { name: null, email: `${c.requestedById}@x` }
      : null,
    reviewedBy: c.reviewedById
      ? { name: null, email: `${c.reviewedById}@x` }
      : null,
    attempts: attempts
      .filter((a) => a.captureId === c.id)
      .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())
      .map((a) => ({
        ...a,
        capturedBy: a.capturedById
          ? { name: null, email: `${a.capturedById}@x` }
          : null,
      })),
  });

  const prisma = {
    store: {
      findFirst: vi.fn(async () => ({
        id: STORE,
        name: 'Store 1',
        projectId: null,
      })),
    },
    campaign: {
      findFirst: vi.fn(async () => ({
        id: CAMPAIGN,
        key: 'MSP2-2026',
        name: 'Spring',
      })),
    },
    placement: {
      findFirst: vi.fn(async () => ({
        fixtureId: FIXTURE,
        label: 'Storefront',
        fixture: { name: 'Storefront', kind: 'WALL', department: null },
      })),
    },
    guideFixture: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
    fixtureCapture: {
      findUnique: vi.fn(
        async ({ where, select }: { where: never; select?: never }) => {
          const c = findCapture(keyOf(where));
          if (!c) return null;
          if (select) return { id: c.id };
          return hydrate(c);
        },
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: never;
          create: Partial<CaptureRow>;
          update: Partial<CaptureRow>;
        }) => {
          const existing = findCapture(keyOf(where));
          if (existing) {
            Object.assign(existing, update);
            return { ...existing };
          }
          const row: CaptureRow = {
            id: `cap_${++seq}`,
            orgId: ORG,
            storeId: STORE,
            campaignId: CAMPAIGN,
            fixtureId: FIXTURE,
            needsPhoto: true,
            storageKey: null,
            uploadedAt: null,
            verdict: null,
            aiNotes: null,
            confidence: null,
            modelId: null,
            scoredAt: null,
            requestedById: null,
            requestedAt: null,
            reviewedById: null,
            reviewedAt: null,
            overrideVerdict: null,
            overrideNote: null,
            ...create,
          };
          captures.push(row);
          return { ...row };
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: never;
          data: Partial<CaptureRow>;
        }) => {
          const c = findCapture(keyOf(where));
          if (!c) throw new Error('capture not found');
          Object.assign(c, data);
          return { ...c };
        },
      ),
    },
    fixtureCaptureAttempt: {
      create: vi.fn(async ({ data }: { data: Partial<AttemptRow> }) => {
        const row: AttemptRow = {
          id: `att_${++seq}`,
          orgId: ORG,
          captureId: data.captureId!,
          storageKey: data.storageKey!,
          verdict: data.verdict ?? null,
          aiNotes: data.aiNotes ?? null,
          confidence: data.confidence ?? null,
          modelId: data.modelId ?? null,
          capturedById: data.capturedById ?? null,
          capturedAt: new Date(Date.now() + seq), // monotonic for ordering
        };
        attempts.push(row);
        return { ...row };
      }),
    },
  };

  return { prisma, captures, attempts };
}

/** A scorer stub that returns a queue of canned verdicts (FAIL then PASS). */
function makeScorer(verdicts: ComplianceScoreResult['verdict'][]) {
  const queue = [...verdicts];
  return {
    score: vi.fn(
      async (_input: ComplianceScoreInput): Promise<ComplianceScoreResult> => {
        const verdict = queue.shift() ?? 'NEEDS_REVIEW';
        return { verdict, confidence: 0.9, notes: `notes:${verdict}`, modelId: 'stub', issues: [] };
      },
    ),
  };
}

function makeStorage() {
  let n = 0;
  return {
    put: vi.fn(async () => `captures/key_${++n}`),
    getBytes: vi.fn(async () => Buffer.from('ref')),
    signedGetUrl: vi.fn((key: string) => `https://signed/${key}`),
  };
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const upload = () => ({ buffer: PNG, mimetype: 'image/png', size: PNG.length });

// sharp(...).metadata() is called to validate the upload — stub it so the test
// bytes pass without a real image.
vi.mock('sharp', () => ({
  default: () => ({ metadata: async () => ({ width: 1, height: 1 }) }),
}));

describe('fixture-capture history + reviewer override', () => {
  let prisma: ReturnType<typeof makePrisma>['prisma'];
  let captures: ReturnType<typeof makePrisma>['captures'];
  let attempts: ReturnType<typeof makePrisma>['attempts'];

  beforeEach(() => {
    ({ prisma, captures, attempts } = makePrisma());
  });

  function service(verdicts: ComplianceScoreResult['verdict'][]) {
    return new ManagerService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeStorage() as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeScorer(verdicts) as any,
    );
  }

  it('a re-shoot creates a NEW attempt and preserves the prior one (history not lost)', async () => {
    const svc = service(['FAIL', 'PASS']);

    // First shot → FAIL.
    const first = await svc.uploadFixturePhoto(MANAGER, FIXTURE, upload());
    expect(first.overall).toBe('FAIL');
    expect(attempts).toHaveLength(1);

    // Re-shoot → PASS. The CURRENT FixtureCapture flips to PASS …
    const second = await svc.uploadFixturePhoto(MANAGER, FIXTURE, upload());
    expect(second.overall).toBe('PASS');

    // … but the FAIL shot is NOT erased — both attempts are preserved.
    expect(attempts).toHaveLength(2);
    expect(attempts.map((a) => a.verdict).sort()).toEqual(['FAIL', 'PASS']);
    expect(captures).toHaveLength(1); // still ONE current pointer
    expect(captures[0]!.verdict).toBe('PASS');

    // The detail surfaces both shots, newest first, each with its own verdict.
    expect(second.attempts).toHaveLength(2);
    expect(second.attempts[0]!.verdict).toBe('PASS');
    expect(second.attempts[1]!.verdict).toBe('FAIL');
    // Effective verdict with no override is the AI verdict.
    expect(second.effectiveVerdict).toBe('PASS');
  });

  it('an override sets the effectiveVerdict (human decision beats the AI verdict)', async () => {
    const svc = service(['PASS']);

    // Manager shoots → AI says PASS.
    const afterShot = await svc.uploadFixturePhoto(MANAGER, FIXTURE, upload());
    expect(afterShot.overall).toBe('PASS');
    expect(afterShot.effectiveVerdict).toBe('PASS');

    // Reviewer overrides to FAIL.
    const overridden = await svc.overrideCapture(REVIEWER, FIXTURE, {
      verdict: 'FAIL',
      note: 'shelf is empty',
    });

    // The AI verdict is unchanged, but the EFFECTIVE verdict is the override.
    expect(overridden.overall).toBe('PASS');
    expect(overridden.overrideVerdict).toBe('FAIL');
    expect(overridden.effectiveVerdict).toBe('FAIL');
    expect(overridden.overrideNote).toBe('shelf is empty');
    expect(overridden.reviewedByName).toBe('rev_1@x');
    expect(captures[0]!.overrideVerdict).toBe('FAIL');
    expect(captures[0]!.reviewedById).toBe('rev_1');
  });

  it('request-photo raises needsPhoto and stamps the requester', async () => {
    const svc = service(['PASS']);
    await svc.uploadFixturePhoto(MANAGER, FIXTURE, upload());
    expect(captures[0]!.needsPhoto).toBe(false);

    const after = await svc.requestCapturePhoto(REVIEWER, FIXTURE);
    expect(after.needsPhoto).toBe(true);
    expect(after.requestedByName).toBe('rev_1@x');
    expect(captures[0]!.requestedById).toBe('rev_1');
  });
});
