import { describe, expect, it } from 'vitest';
import type { StoreScore } from '@wally/types';

import {
  attentionCount,
  bandLabel,
  humanizeKey,
  storeHeadline,
  storeReasons,
} from './format';

function store(over: Partial<StoreScore> = {}): StoreScore {
  return {
    storeId: 's1',
    storeName: 'Harrods Knightsbridge',
    campaignKey: 'MSP2-2026',
    overall: 'good',
    needsReview: false,
    submitted: 4,
    expected: 4,
    failed: [],
    review: [],
    missing: [],
    notApplicable: [],
    fixtures: [],
    rubricVersions: [],
    ...over,
  };
}

describe('humanizeKey', () => {
  it('turns a fixture key into a sentence-case label', () => {
    expect(humanizeKey('front_window')).toBe('Front window');
    expect(humanizeKey('end-cap')).toBe('End cap');
    expect(humanizeKey('storefront.v2')).toBe('Storefront v2');
  });
});

describe('bandLabel', () => {
  it('maps every band to its human label', () => {
    expect(bandLabel('perfect')).toBe('Perfect');
    expect(bandLabel('not_good')).toBe('Not good');
    expect(bandLabel('needs_review')).toBe('Needs review');
    expect(bandLabel('incomplete')).toBe('Incomplete');
  });
});

describe('storeHeadline', () => {
  it('celebrates a fully-passing store', () => {
    expect(storeHeadline(store())).toMatch(/All 4 fixtures submitted and passing/);
  });

  it('summarises missing + failing + review in one line', () => {
    const s = store({
      submitted: 2,
      expected: 4,
      failed: ['end_cap'],
      review: ['front_window'],
    });
    const line = storeHeadline(s);
    expect(line).toMatch(/2 of 4 fixtures still missing/);
    expect(line).toMatch(/1 failing/);
    expect(line).toMatch(/1 need a look/);
    expect(line.endsWith('.')).toBe(true);
  });
});

describe('attentionCount', () => {
  it('sums failing + review + missing', () => {
    const s = store({
      submitted: 1,
      expected: 4,
      failed: ['a'],
      review: ['b', 'c'],
    });
    // 1 failing + 2 review + 3 missing
    expect(attentionCount(s)).toBe(6);
  });

  it('is zero for a clean store', () => {
    expect(attentionCount(store())).toBe(0);
  });
});

describe('storeReasons', () => {
  it('explains a clean store positively', () => {
    expect(storeReasons(store())[0]).toMatch(/every applicable fixture/i);
  });

  it('lists failing and missing fixtures by human name', () => {
    const reasons = storeReasons(
      store({ failed: ['end_cap'], missing: ['front_window'] }),
    );
    expect(reasons.join(' ')).toMatch(/End cap/);
    expect(reasons.join(' ')).toMatch(/Front window/);
  });
});
