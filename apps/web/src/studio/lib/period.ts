// Shared analytics period model for the studio analytics views (Insights,
// Leaderboard). A "period" resolves to an OPTIONAL date window plus the
// immediately-preceding equal-length window — so the same machinery powers the
// "vs previous period" KPI deltas AND the leaderboard rank movement.
//
// All time = no window at all (from/to both undefined) → the API runs its
// unchanged all-time path. Everything else is anchored to "now".

import type { DateWindow } from '@wally/sdk';

export type PeriodKey = 'all' | '7d' | '30d' | 'campaign';

export interface PeriodOption {
  key: PeriodKey;
  label: string;
}

export const PERIOD_OPTIONS: PeriodOption[] = [
  { key: 'all', label: 'All time' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'campaign', label: 'This campaign' },
];

/** The window for a period plus the equal-length window immediately before it. */
export interface ResolvedPeriod {
  /** The current window. Empty object = all-time (no bounds). */
  current: DateWindow;
  /**
   * The immediately-preceding equal-length window — for deltas / rank movement.
   * `null` for periods without a finite length (All time; This campaign with no
   * start date) where "previous period" is undefined.
   */
  previous: DateWindow | null;
  /** A human label for the current window (e.g. "Last 7 days"). */
  label: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO bounds for a rolling N-day window ending now, plus the prior N days. */
function rolling(days: number, label: string, now: number): ResolvedPeriod {
  const len = days * DAY_MS;
  const curFrom = now - len;
  return {
    current: { from: new Date(curFrom).toISOString(), to: new Date(now).toISOString() },
    previous: {
      from: new Date(curFrom - len).toISOString(),
      to: new Date(curFrom).toISOString(),
    },
    label,
  };
}

/**
 * Resolve a period choice (and the selected campaign's start date, for the
 * "This campaign" option) into current + previous windows.
 */
export function resolvePeriod(
  period: PeriodKey,
  campaign: { startsAt: string | null; endsAt: string | null } | undefined,
  now: number = Date.now(),
): ResolvedPeriod {
  switch (period) {
    case '7d':
      return rolling(7, 'Last 7 days', now);
    case '30d':
      return rolling(30, 'Last 30 days', now);
    case 'campaign': {
      // Bound by the campaign's own start/end. The "previous period" is the
      // equal-length window immediately before the campaign started — only
      // computable when the campaign has a start date.
      const from = campaign?.startsAt ?? undefined;
      const to = campaign?.endsAt ?? undefined;
      let previous: DateWindow | null = null;
      if (from) {
        const startMs = new Date(from).getTime();
        const endMs = to ? new Date(to).getTime() : now;
        const len = Math.max(endMs - startMs, DAY_MS);
        previous = {
          from: new Date(startMs - len).toISOString(),
          to: new Date(startMs).toISOString(),
        };
      }
      return { current: { from, to }, previous, label: 'This campaign' };
    }
    case 'all':
    default:
      return { current: {}, previous: null, label: 'All time' };
  }
}

/**
 * Stable query-key fragment for a window — so React Query caches each period
 * separately. Empty window → 'all'.
 */
export function windowKey(w: DateWindow): string {
  if (!w.from && !w.to) return 'all';
  return `${w.from ?? ''}..${w.to ?? ''}`;
}
