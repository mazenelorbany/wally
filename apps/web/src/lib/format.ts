// Plain-English helpers — the reviewer console speaks in sentences, not codes.

import type { Overall, StoreBand, StoreScore } from '@wally/types';

/** Human label for any verdict band (matches the @wally/ui Verdict labels). */
export function bandLabel(band: StoreBand | Overall): string {
  switch (band) {
    case 'perfect':
      return 'Perfect';
    case 'good':
      return 'Good';
    case 'not_good':
      return 'Not good';
    case 'needs_review':
      return 'Needs review';
    case 'incomplete':
      return 'Incomplete';
    default:
      return band;
  }
}

/** Turn a fixture key like "front_window" into "Front window". */
export function humanizeKey(key: string): string {
  const cleaned = key.replace(/[._-]+/g, ' ').trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** A one-line, plain-English summary of where a store stands. */
export function storeHeadline(s: StoreScore): string {
  const parts: string[] = [];
  if (s.submitted < s.expected) {
    parts.push(`${s.expected - s.submitted} of ${s.expected} fixtures still missing`);
  }
  if (s.failed.length) {
    parts.push(`${s.failed.length} failing`);
  }
  if (s.review.length) {
    parts.push(`${s.review.length} need a look`);
  }
  if (!parts.length) {
    return `All ${s.expected} fixtures submitted and passing.`;
  }
  return capitalise(joinClauses(parts)) + '.';
}

/** Why a store landed where it did, fixture-by-fixture, in words. */
export function storeReasons(s: StoreScore): string[] {
  const reasons: string[] = [];
  if (s.failed.length) {
    reasons.push(
      `Failing: ${s.failed.map(humanizeKey).join(', ')}.`,
    );
  }
  if (s.review.length) {
    reasons.push(
      `Low confidence, needs a human look: ${s.review
        .map(humanizeKey)
        .join(', ')}.`,
    );
  }
  if (s.missing.length) {
    reasons.push(`Not yet submitted: ${s.missing.map(humanizeKey).join(', ')}.`);
  }
  if (s.notApplicable.length) {
    reasons.push(
      `Marked not applicable: ${s.notApplicable.map(humanizeKey).join(', ')}.`,
    );
  }
  if (!reasons.length) {
    reasons.push('Every applicable fixture is submitted and passing.');
  }
  return reasons;
}

/** Count of things demanding the reviewer's attention for a store. */
export function attentionCount(s: StoreScore): number {
  return s.failed.length + s.review.length + (s.expected - s.submitted);
}

function joinClauses(parts: string[]): string {
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]}, ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const pctFmt = new Intl.NumberFormat(undefined, {
  style: 'percent',
  maximumFractionDigits: 0,
});

export function pct(v: number): string {
  return pctFmt.format(Math.max(0, Math.min(1, v)));
}
