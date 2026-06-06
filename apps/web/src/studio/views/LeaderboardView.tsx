import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Crown,
  Medal,
  Minus,
  Star,
  Trophy,
  TrendingUp,
} from 'lucide-react';
import { Badge, Spinner, cn } from '@wally/ui';
import type { StoreBand, StoreSales, StoreScore } from '@wally/types';

import { api } from '../../lib/api';
import { ErrorState } from '../../components/states';
import { useSetStudioTopBar } from '../components/StudioContext';
import {
  PERIOD_OPTIONS,
  resolvePeriod,
  windowKey,
  type PeriodKey,
} from '../lib/period';

// Colour-blind-safe band chips: every band carries a label, never hue alone.
const BAND: Record<StoreBand, { label: string; cls: string }> = {
  perfect: { label: 'Perfect', cls: 'text-pass' },
  good: { label: 'Good', cls: 'text-pass' },
  needs_review: { label: 'Review', cls: 'text-graphite' },
  not_good: { label: 'Failing', cls: 'text-fail' },
  incomplete: { label: 'Incomplete', cls: 'text-warn' },
};

/** Compact money: $1.2k / $34k / $1.1M — leaderboard headline figure. */
function fmtMoney(n: number): string {
  const round = (v: number, d = 0) => Number(v.toFixed(d));
  if (n >= 1_000_000) return `$${round(n / 1_000_000, 1)}M`;
  if (n >= 1_000) return `$${round(n / 1_000, 1)}k`;
  return `$${round(n)}`;
}

/** Pass-rate against the full checklist: passing fixtures / expected (0..1). */
function passRate(s: StoreScore): number {
  if (s.expected <= 0) return 0;
  const passing = s.fixtures.filter(
    (f) => f.status === 'scored' && (f.overall === 'perfect' || f.overall === 'good'),
  ).length;
  return passing / s.expected;
}

function completion(s: StoreScore): number {
  return s.expected > 0 ? s.submitted / s.expected : 0;
}

/**
 * A store merged across the two pipelines the leaderboard ranks on: SALES
 * (primary) and COMPLIANCE (secondary / tiebreak). A store may have sales but
 * no compliance score yet (or vice versa); `score` defaults to 0 so the merge
 * never drops a row.
 */
type Merged = {
  storeId: string;
  storeName: string;
  region?: string | null;
  revenue: number;
  units: number;
  /** Compliance, kept for the secondary metric + tiebreak (may be undefined). */
  compliance?: StoreScore;
};

type Ranked = Merged & {
  rank: number;
  score: number; // pass-rate 0..1 (0 when no compliance score)
  done: number; // completion 0..1
  band: StoreBand;
  /**
   * Rank change vs the previous equal-length period: positive = moved UP
   * (smaller rank number), negative = moved DOWN, 0 = held, null = no previous
   * standing (new entrant or all-time view).
   */
  rankDelta: number | null;
};

/**
 * Merge sales + compliance into one row per store. Sales is the spine (the
 * leaderboard is sales-led); compliance attaches by storeId when present.
 */
function mergeStores(sales: StoreSales[], scores: StoreScore[]): Merged[] {
  const byStore = new Map(scores.map((s) => [s.storeId, s]));
  return sales.map((s) => ({
    storeId: s.storeId,
    storeName: s.storeName,
    region: s.region,
    revenue: s.revenue,
    units: s.units,
    compliance: byStore.get(s.storeId),
  }));
}

/**
 * The ranking comparator — SALES FIRST, then compliance. Revenue desc; ties
 * broken by compliance pass-rate desc, then completion, then name (stable).
 */
function compareMerged(a: Merged, b: Merged): number {
  if (b.revenue !== a.revenue) return b.revenue - a.revenue;
  const sa = a.compliance ? passRate(a.compliance) : 0;
  const sb = b.compliance ? passRate(b.compliance) : 0;
  if (sb !== sa) return sb - sa;
  const da = a.compliance ? completion(a.compliance) : 0;
  const db = b.compliance ? completion(b.compliance) : 0;
  if (db !== da) return db - da;
  return a.storeName.localeCompare(b.storeName);
}

/** Pure: rank merged stores best→worst, returning storeId → rank (1-based). */
function rankMap(merged: Merged[]): Map<string, number> {
  const ordered = [...merged].sort(compareMerged);
  const m = new Map<string, number>();
  ordered.forEach((s, i) => m.set(s.storeId, i + 1));
  return m;
}

/** Store league table — best→worst by SALES, then VM compliance. */
export function LeaderboardView() {
  const campaignsQ = useQuery({
    queryKey: ['studio', 'campaigns'],
    queryFn: () => api.campaigns.list(),
  });
  const campaign =
    campaignsQ.data?.find((c) => c.status === 'ACTIVE') ?? campaignsQ.data?.[0];

  useSetStudioTopBar({
    guideName: 'Leaderboard',
    guideKey: campaign?.key,
    stores: [],
  });

  // Period selector → date window. Default All time keeps the standings
  // unchanged. Rank movement compares against the preceding equal-length window.
  const [period, setPeriod] = React.useState<PeriodKey>('all');
  const resolved = React.useMemo(
    () => resolvePeriod(period, campaign),
    [period, campaign],
  );
  const curKey = windowKey(resolved.current);
  const prevKey = resolved.previous ? windowKey(resolved.previous) : 'none';

  // SALES — the primary ranking signal.
  const salesQ = useQuery({
    queryKey: ['studio', 'leaderboard-sales', campaign?.id, curKey],
    queryFn: () => api.campaigns.sales(campaign!.id, resolved.current),
    enabled: Boolean(campaign?.id),
  });
  const prevSalesQ = useQuery({
    queryKey: ['studio', 'leaderboard-sales-prev', campaign?.id, prevKey],
    queryFn: () => api.campaigns.sales(campaign!.id, resolved.previous!),
    enabled: Boolean(campaign?.id) && resolved.previous != null,
  });

  // COMPLIANCE — the secondary metric + tiebreak.
  const queueQ = useQuery({
    queryKey: ['studio', 'leaderboard-queue', campaign?.id, curKey],
    queryFn: () => api.campaigns.queue(campaign!.id, resolved.current),
    enabled: Boolean(campaign?.id),
  });
  const prevQueueQ = useQuery({
    queryKey: ['studio', 'leaderboard-queue-prev', campaign?.id, prevKey],
    queryFn: () => api.campaigns.queue(campaign!.id, resolved.previous!),
    enabled: Boolean(campaign?.id) && resolved.previous != null,
  });

  const bicQ = useQuery({
    queryKey: ['studio', 'leaderboard-bic', campaign?.id],
    queryFn: () => api.campaigns.bestInClass(campaign!.id),
    enabled: Boolean(campaign?.id),
  });

  const [region, setRegion] = React.useState('all');
  const regions = React.useMemo(
    () =>
      [
        ...new Set((salesQ.data ?? []).map((s) => s.region).filter(Boolean)),
      ].sort() as string[],
    [salesQ.data],
  );

  // Previous-period ranks (region-filtered the same way), for movement deltas.
  const prevRanks = React.useMemo(() => {
    if (!resolved.previous || prevSalesQ.data == null) return null;
    const merged = mergeStores(
      prevSalesQ.data,
      prevQueueQ.data ?? [],
    ).filter((s) => region === 'all' || s.region === region);
    return rankMap(merged);
  }, [prevSalesQ.data, prevQueueQ.data, region, resolved.previous]);

  const ranked: Ranked[] = React.useMemo(() => {
    const merged = mergeStores(salesQ.data ?? [], queueQ.data ?? []).filter(
      (s) => region === 'all' || s.region === region,
    );
    return [...merged].sort(compareMerged).map((s, i) => {
      const prev = prevRanks?.get(s.storeId);
      // Up = smaller rank number, so delta = prevRank - currentRank.
      const rankDelta = prev != null ? prev - (i + 1) : null;
      return {
        ...s,
        rank: i + 1,
        score: s.compliance ? passRate(s.compliance) : 0,
        done: s.compliance ? completion(s.compliance) : 0,
        band: s.compliance?.overall ?? 'incomplete',
        rankDelta,
      };
    });
  }, [salesQ.data, queueQ.data, region, prevRanks]);

  // Most improved: the store that climbed the most rank positions this period.
  const mostImproved = React.useMemo(() => {
    const climbers = ranked.filter((s) => (s.rankDelta ?? 0) > 0);
    if (climbers.length === 0) return null;
    return climbers.reduce((best, s) =>
      (s.rankDelta ?? 0) > (best.rankDelta ?? 0) ? s : best,
    );
  }, [ranked]);

  const fleetRevenue = ranked.reduce((a, s) => a + s.revenue, 0);
  const fleetExpected = ranked.reduce(
    (a, s) => a + (s.compliance?.expected ?? 0),
    0,
  );
  const fleetPassing = ranked.reduce(
    (a, s) =>
      a +
      (s.compliance
        ? s.compliance.fixtures.filter(
            (f) =>
              f.status === 'scored' &&
              (f.overall === 'perfect' || f.overall === 'good'),
          ).length
        : 0),
    0,
  );
  const fleetRate = fleetExpected ? fleetPassing / fleetExpected : 0;

  const isLoading =
    campaignsQ.isLoading || salesQ.isLoading || queueQ.isLoading;
  const isError = campaignsQ.isError || salesQ.isError || queueQ.isError;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-6 flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-brand text-steel">
            Analytics
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
            Leaderboard{' '}
            {campaign ? <span className="text-steel">· {campaign.key}</span> : null}
          </h1>
          <p className="mt-1 text-sm text-steel">
            Stores ranked by sales — then VM compliance breaks ties and shows
            execution quality.
          </p>
        </div>
        <div className="flex shrink-0 items-end gap-4">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as PeriodKey)}
            aria-label="Select period"
            className="rounded-md border border-mist/70 bg-paper px-2.5 py-1.5 text-sm text-ink focus:border-graphite focus:outline-none"
          >
            {PERIOD_OPTIONS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
          {regions.length > 0 ? (
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              aria-label="Filter by region"
              className="rounded-md border border-mist/70 bg-paper px-2.5 py-1.5 text-sm text-ink focus:border-graphite focus:outline-none"
            >
              <option value="all">All regions</option>
              {regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          ) : null}
          {ranked.length > 0 ? (
            <div className="text-right">
              <p className="font-display text-2xl font-semibold tabular-nums text-ink">
                {fmtMoney(fleetRevenue)}
              </p>
              <p className="text-[11px] uppercase tracking-brand text-steel">
                Fleet sales · {Math.round(fleetRate * 100)}% pass-rate
              </p>
            </div>
          ) : null}
        </div>
      </header>

      {isLoading ? (
        <div className="grid h-40 place-items-center">
          <Spinner className="text-2xl text-steel" />
        </div>
      ) : isError ? (
        <ErrorState
          error={campaignsQ.error ?? salesQ.error ?? queueQ.error}
          onRetry={() => {
            void campaignsQ.refetch();
            void salesQ.refetch();
            void queueQ.refetch();
          }}
          title="Couldn't load the leaderboard"
        />
      ) : !campaign ? (
        <p className="text-sm text-steel">No active guide yet.</p>
      ) : ranked.length === 0 ? (
        <p className="text-sm text-steel">No stores in this guide yet.</p>
      ) : (
        <>
          {/* Most improved — biggest rank climb vs the previous period */}
          {mostImproved && (mostImproved.rankDelta ?? 0) > 0 ? (
            <div className="mb-6 flex items-center gap-3 rounded-lg border border-pass/30 bg-pass/[0.06] px-5 py-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-pass/10">
                <TrendingUp className="h-5 w-5 text-pass" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-brand text-steel">
                  Most improved · vs {resolved.label.toLowerCase()}
                </p>
                <p className="truncate font-display text-base font-semibold text-ink">
                  {mostImproved.storeName}
                </p>
              </div>
              <span className="ml-auto inline-flex items-center gap-1 font-display text-lg font-semibold text-pass">
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
                {mostImproved.rankDelta} place
                {mostImproved.rankDelta === 1 ? '' : 's'}
              </span>
            </div>
          ) : null}

          {/* Podium — top 3 */}
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {ranked.slice(0, 3).map((s) => (
              <PodiumCard key={s.storeId} store={s} />
            ))}
          </div>

          {/* Best-in-class showcase — exemplars to show every store */}
          {(bicQ.data?.length ?? 0) > 0 ? (
            <div className="mb-6">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-brand text-steel">
                <Star className="h-3.5 w-3.5 text-gold-deep" aria-hidden="true" />
                Best in class — show these to every store
              </p>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {bicQ.data!.map((b) => (
                  <figure key={b.photoId} className="w-32 shrink-0">
                    <img
                      src={b.url}
                      alt={`${b.storeName} · ${b.fixtureKey}`}
                      loading="lazy"
                      className="aspect-square w-full rounded-md border border-mist/60 object-cover"
                    />
                    <figcaption className="mt-1 truncate text-[11px] text-steel">
                      {b.storeName}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ) : null}

          {/* Standings */}
          <ul className="divide-y divide-mist/50 overflow-hidden rounded-lg border border-mist/60 bg-paper">
            {ranked.map((s) => (
              <Row key={s.storeId} store={s} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const MEDAL = [
  // #1 = brand gold (the victory colour, colour-blind-safe — never the CEO's "stop" red).
  { icon: Crown, cls: 'text-gold-deep', ring: 'border-gold/45 bg-gold/[0.07]' },
  { icon: Trophy, cls: 'text-graphite', ring: 'border-mist/70 bg-surface/50' },
  { icon: Medal, cls: 'text-graphite', ring: 'border-mist/70 bg-surface/50' },
] as const;

function PodiumCard({ store: s }: { store: Ranked }) {
  const m = MEDAL[s.rank - 1] ?? MEDAL[2];
  const Icon = m.icon;
  const band = BAND[s.band];
  return (
    <div className={cn('rounded-lg border p-4', m.ring)}>
      <div className="flex items-center justify-between">
        <span className="font-display text-sm font-bold text-steel">
          #{s.rank}
        </span>
        <Icon className={cn('h-5 w-5', m.cls)} aria-hidden="true" />
      </div>
      <p className="mt-2 truncate font-display text-[15px] font-semibold text-ink">
        {s.storeName}
      </p>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="font-display text-2xl font-semibold tabular-nums text-ink">
          {fmtMoney(s.revenue)}
        </span>
        <span className="text-[11px] text-steel tabular-nums">
          {s.units} unit{s.units === 1 ? '' : 's'}
        </span>
      </div>
      <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-steel">
        <span className={band.cls}>{band.label}</span>
        <span>· {Math.round(s.score * 100)}% pass-rate</span>
      </p>
    </div>
  );
}

/** A small ▲n / ▼n / — rank-movement chip (null delta → nothing rendered). */
function RankMovement({ delta }: { delta: number | null }) {
  if (delta == null) return null;
  if (delta === 0) {
    return (
      <span className="inline-flex items-center text-[11px] text-steel" title="No change">
        <Minus className="h-3 w-3" aria-hidden="true" />
      </span>
    );
  }
  const up = delta > 0;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums',
        up ? 'text-pass' : 'text-fail',
      )}
      title={`${up ? 'Up' : 'Down'} ${Math.abs(delta)} place${Math.abs(delta) === 1 ? '' : 's'} vs the previous period`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {Math.abs(delta)}
    </span>
  );
}

function Row({ store: s }: { store: Ranked }) {
  const band = BAND[s.band];
  return (
    <li className="flex items-center gap-4 px-5 py-3.5">
      <span className="flex w-9 shrink-0 flex-col items-center gap-0.5">
        <span className="font-display text-sm font-bold tabular-nums text-steel">
          {s.rank}
        </span>
        <RankMovement delta={s.rankDelta} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[15px] font-semibold text-ink">
          {s.storeName}
        </span>
        <span className="mt-1 flex items-center gap-2 text-xs text-steel">
          <span className="tabular-nums">{s.units} units</span>
          <Badge variant="muted" className={cn('shrink-0', band.cls)}>
            {band.label}
          </Badge>
          <span className="tabular-nums">{Math.round(s.score * 100)}% pass-rate</span>
        </span>
      </span>

      <span className="w-20 shrink-0 text-right font-display text-base font-semibold tabular-nums text-ink">
        {fmtMoney(s.revenue)}
      </span>
    </li>
  );
}
