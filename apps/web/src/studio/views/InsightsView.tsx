import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Camera,
  Clock,
  Download,
  Minus,
  RotateCcw,
  TrendingUp,
} from 'lucide-react';
import { Badge, Button, Spinner, cn } from '@wally/ui';
import type { ComplianceTrendPoint, StoreBand, StoreScore } from '@wally/types';

import { api } from '../../lib/api';
import { useSession } from '../../lib/auth';
import { ErrorState } from '../../components/states';
import { useSetStudioTopBar } from '../components/StudioContext';
import { useProjectCampaign } from '../lib/useProjectCampaign';
import {
  PERIOD_OPTIONS,
  resolvePeriod,
  windowKey,
  type PeriodKey,
} from '../lib/period';

const BAND: Record<StoreBand, { label: string; cls: string; seg: string }> = {
  perfect: { label: 'Perfect', cls: 'text-pass', seg: 'bg-pass' },
  good: { label: 'Good', cls: 'text-pass', seg: 'bg-pass/70' },
  needs_review: { label: 'Review', cls: 'text-graphite', seg: 'bg-graphite/60' },
  not_good: { label: 'Failing', cls: 'text-fail', seg: 'bg-fail' },
  incomplete: { label: 'Incomplete', cls: 'text-warn', seg: 'bg-warn/70' },
};

function passing(s: StoreScore): number {
  return s.fixtures.filter(
    (f) => f.status === 'scored' && (f.overall === 'perfect' || f.overall === 'good'),
  ).length;
}
const passRate = (s: StoreScore) => (s.expected > 0 ? passing(s) / s.expected : 0);
const completion = (s: StoreScore) => (s.expected > 0 ? s.submitted / s.expected : 0);
const defects = (s: StoreScore) => s.failed.length + s.review.length + s.missing.length;

function fmtMins(m: number | null): string {
  if (m == null) return '—';
  if (m < 60) return `${Math.round(m)}m`;
  if (m < 1440) return `${(m / 60).toFixed(1)}h`;
  return `${(m / 1440).toFixed(1)}d`;
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  DRAFT: 'Draft',
  CLOSED: 'Closed',
};

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

/** "Runs Feb 6 – Feb 10" / "Starts Feb 6" / "Ends Feb 10" — advisory window. */
function windowLabel(c: { startsAt: string | null; endsAt: string | null }): string {
  if (c.startsAt && c.endsAt) return `Runs ${fmtDay(c.startsAt)} – ${fmtDay(c.endsAt)}`;
  if (c.startsAt) return `Starts ${fmtDay(c.startsAt)}`;
  if (c.endsAt) return `Ends ${fmtDay(c.endsAt)}`;
  return '';
}

type SortKey = 'score' | 'completion' | 'defects';

// The trend chart can plot any of the stored daily dimensions, not just
// pass-rate. Each metric maps a ComplianceTrendPoint to a 0..1 ratio.
type TrendMetric = 'passRate' | 'completion' | 'failing';

const TREND_METRICS: Record<
  TrendMetric,
  { label: string; short: string; ratio: (p: ComplianceTrendPoint) => number }
> = {
  passRate: {
    label: 'Pass-rate',
    short: 'pass-rate',
    ratio: (p) => (p.expected > 0 ? p.passing / p.expected : 0),
  },
  completion: {
    label: 'Completion',
    short: 'completion',
    ratio: (p) => (p.expected > 0 ? p.submitted / p.expected : 0),
  },
  failing: {
    label: 'Failing',
    short: 'failing stores',
    ratio: (p) => (p.storeCount > 0 ? p.failing / p.storeCount : 0),
  },
};

/** Compliance analytics for any guide — KPIs, turnaround, store table, export. */
export function InsightsView() {
  const campaignsQ = useQuery({
    queryKey: ['studio', 'campaigns'],
    queryFn: () => api.campaigns.list(),
  });

  // The selected campaign drives every query below. Default to the SELECTED
  // PROJECT's campaign (not the org-wide newest-active, which is the wrong
  // project when two are concurrently live), but let the user pick any campaign
  // — closed and draft quarters are viewable, since the endpoints accept any id.
  const [selectedId, setSelectedId] = React.useState<string | undefined>();
  const { campaign: defaultCampaign } = useProjectCampaign();
  const campaign =
    campaignsQ.data?.find((c) => c.id === selectedId) ?? defaultCampaign;

  useSetStudioTopBar({ guideName: 'Insights', guideKey: campaign?.key, stores: [] });

  // Period selector drives the date window threaded into every analytics query.
  // Default = All time, so the surface is unchanged until the user narrows it.
  const [period, setPeriod] = React.useState<PeriodKey>('all');
  const resolved = React.useMemo(
    () => resolvePeriod(period, campaign),
    [period, campaign],
  );
  const curKey = windowKey(resolved.current);
  const prevKey = resolved.previous ? windowKey(resolved.previous) : 'none';

  const queueQ = useQuery({
    queryKey: ['studio', 'insights-queue', campaign?.id, curKey],
    queryFn: () => api.campaigns.queue(campaign!.id, resolved.current),
    enabled: Boolean(campaign?.id),
  });
  // The immediately-preceding equal-length window — powers the "vs previous
  // period" KPI deltas. Skipped for periods with no finite previous (All time).
  const prevQueueQ = useQuery({
    queryKey: ['studio', 'insights-queue-prev', campaign?.id, prevKey],
    queryFn: () => api.campaigns.queue(campaign!.id, resolved.previous!),
    enabled: Boolean(campaign?.id) && resolved.previous != null,
  });
  const turnaroundQ = useQuery({
    queryKey: ['studio', 'insights-turnaround', campaign?.id, curKey],
    queryFn: () => api.campaigns.turnaround(campaign!.id, resolved.current),
    enabled: Boolean(campaign?.id),
  });

  const qc = useQueryClient();
  const { user } = useSession();
  const isAdmin = user?.role === 'ADMIN';
  const trendQ = useQuery({
    queryKey: ['studio', 'insights-trend', campaign?.id],
    queryFn: () => api.campaigns.trend(campaign!.id),
    enabled: Boolean(campaign?.id),
  });
  const snapshot = useMutation({
    mutationFn: () => api.campaigns.captureSnapshot(campaign!.id),
    onSuccess: () =>
      void qc.invalidateQueries({
        queryKey: ['studio', 'insights-trend', campaign?.id],
      }),
  });

  const [sort, setSort] = React.useState<SortKey>('score');
  const [region, setRegion] = React.useState('all');
  const [trendMetric, setTrendMetric] = React.useState<TrendMetric>('passRate');
  const regions = React.useMemo(
    () =>
      [
        ...new Set((queueQ.data ?? []).map((s) => s.region).filter(Boolean)),
      ].sort() as string[],
    [queueQ.data],
  );
  const stores = (queueQ.data ?? []).filter(
    (s) => region === 'all' || s.region === region,
  );

  const rows = React.useMemo(() => {
    const withMetrics = stores.map((s) => ({
      s,
      score: passRate(s),
      done: completion(s),
      defects: defects(s),
    }));
    withMetrics.sort((a, b) => {
      if (sort === 'completion') return b.done - a.done;
      if (sort === 'defects') return b.defects - a.defects;
      return a.score - b.score === 0 ? b.done - a.done : a.score - b.score; // worst pass-rate first
    });
    if (sort === 'score') withMetrics.reverse(); // best pass-rate first
    return withMetrics;
  }, [stores, sort]);

  const onTrack = stores.filter((s) => s.overall === 'perfect' || s.overall === 'good').length;
  const review = stores.filter((s) => s.overall === 'needs_review').length;
  const failing = stores.filter((s) => s.overall === 'not_good').length;
  const notStarted = stores.filter((s) => s.overall === 'incomplete').length;
  const subTotal = stores.reduce((a, s) => a + s.submitted, 0);
  const expTotal = stores.reduce((a, s) => a + s.expected, 0);
  const passTotal = stores.reduce((a, s) => a + passing(s), 0);
  const fleetRate = expTotal ? Math.round((passTotal / expTotal) * 100) : 0;
  const fleetDone = expTotal ? Math.round((subTotal / expTotal) * 100) : 0;

  // "vs previous period" — the same fleet metrics computed for the immediately-
  // preceding equal-length window. null when there's no previous period (All
  // time) or its data hasn't loaded — the tiles then show no delta.
  const prevStores = (prevQueueQ.data ?? []).filter(
    (s) => region === 'all' || s.region === region,
  );
  const prevFleet = React.useMemo(() => {
    if (!resolved.previous || prevQueueQ.data == null) return null;
    const exp = prevStores.reduce((a, s) => a + s.expected, 0);
    const pass = prevStores.reduce((a, s) => a + passing(s), 0);
    const sub = prevStores.reduce((a, s) => a + s.submitted, 0);
    return {
      rate: exp ? Math.round((pass / exp) * 100) : 0,
      done: exp ? Math.round((sub / exp) * 100) : 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevQueueQ.data, region, resolved.previous]);

  const dist = (
    [
      { band: 'good', n: onTrack },
      { band: 'needs_review', n: review },
      { band: 'not_good', n: failing },
      { band: 'incomplete', n: notStarted },
    ] as { band: StoreBand; n: number }[]
  ).filter((d) => d.n > 0);

  const exportCsv = () => {
    if (!stores.length) return;
    const header = [
      'Store',
      'Band',
      'Pass rate %',
      'Completion %',
      'Submitted',
      'Expected',
      'Failed',
      'Needs review',
      'Missing',
      'Not applicable',
    ];
    const cell = (v: string | number) =>
      /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
    const lines = [header.join(',')];
    for (const s of stores) {
      lines.push(
        [
          cell(s.storeName),
          BAND[s.overall].label,
          Math.round(passRate(s) * 100),
          Math.round(completion(s) * 100),
          s.submitted,
          s.expected,
          s.failed.length,
          s.review.length,
          s.missing.length,
          s.notApplicable.length,
        ].join(','),
      );
    }
    const blob = new Blob([lines.join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wally-compliance-${campaign?.key ?? 'export'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const t = turnaroundQ.data;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-brand text-steel">Analytics</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
            Insights{' '}
            {campaign ? <span className="text-steel">· {campaign.key}</span> : null}
          </h1>
          <p className="mt-1 text-sm text-steel">
            Compliance health across the fleet — pass-rate, turnaround, and where
            to help.
          </p>
          {campaign && (campaign.startsAt || campaign.endsAt) ? (
            <p className="mt-1 text-xs text-steel">{windowLabel(campaign)}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {(campaignsQ.data?.length ?? 0) > 1 && campaign ? (
            <select
              value={campaign.id}
              onChange={(e) => setSelectedId(e.target.value)}
              aria-label="Select campaign"
              className="rounded-md border border-mist/70 bg-paper px-2.5 py-1.5 text-sm text-ink focus:border-graphite focus:outline-none"
            >
              {campaignsQ.data!.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {STATUS_LABEL[c.status] ?? c.status}
                </option>
              ))}
            </select>
          ) : null}
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
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={!stores.length}
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </header>

      {campaignsQ.isLoading || queueQ.isLoading ? (
        <div className="grid h-40 place-items-center">
          <Spinner className="text-2xl text-steel" />
        </div>
      ) : campaignsQ.isError || queueQ.isError ? (
        <ErrorState
          error={campaignsQ.error ?? queueQ.error}
          onRetry={() => {
            void campaignsQ.refetch();
            void queueQ.refetch();
          }}
          title="Couldn't load insights"
        />
      ) : !campaign ? (
        <p className="text-sm text-steel">No active guide yet.</p>
      ) : stores.length === 0 ? (
        <p className="text-sm text-steel">No stores in this guide yet.</p>
      ) : (
        <>
          {/* KPI tiles */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile
              label="Fleet pass-rate"
              value={`${fleetRate}%`}
              delta={prevFleet ? fleetRate - prevFleet.rate : null}
            />
            <Tile
              label="Completion"
              value={`${fleetDone}%`}
              sub={`${subTotal}/${expTotal} photos`}
              delta={prevFleet ? fleetDone - prevFleet.done : null}
            />
            <Tile label="On track" value={String(onTrack)} tone="text-pass" />
            <Tile
              label="Failing / review"
              value={`${failing} / ${review}`}
              tone="text-fail"
            />
          </div>
          {resolved.previous ? (
            <p className="mt-2 text-[11px] text-steel">
              Deltas vs the preceding {resolved.label.toLowerCase()}.
            </p>
          ) : null}

          {/* Distribution bar */}
          <div className="mt-6">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-brand text-steel">
              Compliance distribution
            </p>
            <div className="flex h-3 overflow-hidden rounded-full bg-mist/40">
              {dist.map((d) => (
                <div
                  key={d.band}
                  className={BAND[d.band].seg}
                  style={{ width: `${(d.n / stores.length) * 100}%` }}
                  title={`${BAND[d.band].label}: ${d.n}`}
                />
              ))}
            </div>
          </div>

          {/* Compliance trend */}
          <div className="mt-6 rounded-lg border border-mist/60 bg-paper p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-brand text-steel">
                <TrendingUp className="h-3.5 w-3.5" /> Compliance trend ·{' '}
                {TREND_METRICS[trendMetric].short}
              </p>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 text-[11px] text-steel">
                  {(Object.keys(TREND_METRICS) as TrendMetric[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setTrendMetric(k)}
                      className={cn(
                        'rounded px-1.5 py-0.5',
                        trendMetric === k ? 'bg-ink text-paper' : 'hover:bg-surface',
                      )}
                    >
                      {TREND_METRICS[k].label}
                    </button>
                  ))}
                </div>
                {isAdmin ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => snapshot.mutate()}
                    disabled={snapshot.isPending}
                  >
                    <Camera className="h-3.5 w-3.5" />
                    {snapshot.isPending ? 'Capturing…' : 'Capture snapshot'}
                  </Button>
                ) : null}
              </div>
            </div>
            {trendQ.isLoading ? (
              <div className="grid h-24 place-items-center">
                <Spinner className="text-lg text-steel" />
              </div>
            ) : trendQ.isError ? (
              <ErrorState
                error={trendQ.error}
                onRetry={() => void trendQ.refetch()}
                title="Couldn't load the trend"
              />
            ) : (trendQ.data?.length ?? 0) < 2 ? (
              <p className="text-sm text-steel">
                The trend builds as daily snapshots accumulate
                {isAdmin ? ' — capture one now to start the line.' : '.'}
                {trendQ.data?.length === 1 ? ' (1 point so far)' : ''}
              </p>
            ) : (
              <TrendChart points={trendQ.data!} metric={trendMetric} />
            )}
          </div>

          {/* Turnaround */}
          <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="rounded-lg border border-mist/60 bg-paper p-4 lg:col-span-1">
              <p className="mb-3 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-brand text-steel">
                <Clock className="h-3.5 w-3.5" /> Review turnaround
              </p>
              {turnaroundQ.isLoading ? (
                <Spinner className="text-lg text-steel" />
              ) : (
                <dl className="space-y-2 text-sm">
                  <Stat label="Avg time to review" value={fmtMins(t?.avgReviewMinutes ?? null)} />
                  <Stat label="Median" value={fmtMins(t?.medianReviewMinutes ?? null)} />
                  <Stat label="Reviewed" value={String(t?.reviewedCount ?? 0)} />
                  <Stat label="Revisions" value={String(t?.revisionCount ?? 0)} />
                  <Stat
                    label="Awaiting review"
                    value={String(t?.awaitingReview ?? 0)}
                    tone={t && t.awaitingReview > 0 ? 'text-fail' : undefined}
                  />
                  <Stat
                    label="Oldest pending"
                    value={fmtMins(t?.oldestPendingAgeMinutes ?? null)}
                  />
                </dl>
              )}
            </div>
            <div className="rounded-lg border border-mist/60 bg-paper p-4 lg:col-span-2">
              <p className="mb-3 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-brand text-steel">
                <RotateCcw className="h-3.5 w-3.5" /> Most revisions — who needs help
              </p>
              {turnaroundQ.isLoading ? (
                <Spinner className="text-lg text-steel" />
              ) : (t?.mostRevised.length ?? 0) === 0 ? (
                <p className="text-sm text-steel">No revisions yet — clean run.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {t!.mostRevised.map((m) => (
                    <li
                      key={m.storeId}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="truncate text-ink">{m.storeName}</span>
                      <Badge variant="muted">
                        {m.revisions} revision{m.revisions === 1 ? '' : 's'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Store table */}
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-brand text-steel">
                Stores · {stores.length}
              </p>
              <div className="flex items-center gap-1 text-[11px] text-steel">
                <ArrowUpDown className="h-3.5 w-3.5" />
                {(['score', 'completion', 'defects'] as SortKey[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSort(k)}
                    className={cn(
                      'rounded px-1.5 py-0.5 capitalize',
                      sort === k ? 'bg-ink text-paper' : 'hover:bg-surface',
                    )}
                  >
                    {k === 'score' ? 'pass-rate' : k}
                  </button>
                ))}
              </div>
            </div>
            <ul className="divide-y divide-mist/50 overflow-hidden rounded-lg border border-mist/60 bg-paper">
              {rows.map(({ s, score, done }) => (
                <li key={s.storeId} className="flex items-center gap-4 px-5 py-3">
                  <span className="min-w-0 flex-1 truncate font-display text-sm font-semibold text-ink">
                    {s.storeName}
                  </span>
                  <span className="hidden w-40 items-center gap-2 sm:flex">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-mist/50">
                      <span
                        className="block h-full rounded-full bg-graphite"
                        style={{ width: `${Math.round(done * 100)}%` }}
                      />
                    </span>
                    <span className="w-9 text-right text-xs tabular-nums text-steel">
                      {Math.round(done * 100)}%
                    </span>
                  </span>
                  <Badge variant="muted" className={cn('shrink-0', BAND[s.overall].cls)}>
                    {BAND[s.overall].label}
                  </Badge>
                  <span className="w-12 shrink-0 text-right font-display text-sm font-semibold tabular-nums text-ink">
                    {Math.round(score * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  tone = 'text-ink',
  delta = null,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  /** Percentage-point change vs the previous period (null = no comparison). */
  delta?: number | null;
}) {
  return (
    <div className="rounded-lg border border-mist/60 bg-paper p-4">
      <p className="text-[11px] uppercase tracking-brand text-steel">{label}</p>
      <p className={cn('mt-1 font-display text-2xl font-semibold tabular-nums', tone)}>
        {value}
      </p>
      {delta != null ? <DeltaBadge delta={delta} /> : null}
      {sub ? <p className="mt-0.5 text-[11px] text-steel">{sub}</p> : null}
    </div>
  );
}

/** A signed "▲ 4 pts / ▼ 2 pts / — no change" chip for a vs-previous delta. */
function DeltaBadge({ delta }: { delta: number }) {
  const rounded = Math.round(delta);
  const Icon = rounded > 0 ? ArrowUp : rounded < 0 ? ArrowDown : Minus;
  const cls =
    rounded > 0 ? 'text-pass' : rounded < 0 ? 'text-fail' : 'text-steel';
  const label =
    rounded === 0 ? 'No change' : `${Math.abs(rounded)} pt${Math.abs(rounded) === 1 ? '' : 's'}`;
  return (
    <span className={cn('mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium', cls)}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-steel">{label}</dt>
      <dd className={cn('font-display font-semibold tabular-nums', tone ?? 'text-ink')}>
        {value}
      </dd>
    </div>
  );
}

/** Lightweight inline SVG line chart of the selected metric over the snapshots. */
function TrendChart({
  points,
  metric,
}: {
  points: ComplianceTrendPoint[];
  metric: TrendMetric;
}) {
  const W = 720;
  const H = 180;
  const padX = 10;
  const padTop = 12;
  const padBottom = 22;
  const n = points.length;
  const first = points[0];
  const last = points[n - 1];
  if (!first || !last) return null;

  const def = TREND_METRICS[metric];
  const rate = def.ratio;
  const x = (i: number) => padX + (n === 1 ? 0 : (i / (n - 1)) * (W - padX * 2));
  const y = (r: number) => padTop + (1 - r) * (H - padTop - padBottom);
  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(rate(p)).toFixed(1)}`)
    .join(' ');
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Compliance ${def.short} over time`}
      >
        {[0, 0.5, 1].map((g) => (
          <g key={g}>
            <line
              x1={padX}
              x2={W - padX}
              y1={y(g)}
              y2={y(g)}
              className="stroke-mist/60"
              strokeWidth="1"
            />
            <text x={padX} y={y(g) - 3} className="fill-steel text-[9px]">
              {Math.round(g * 100)}%
            </text>
          </g>
        ))}
        <path
          d={line}
          fill="none"
          className="stroke-graphite"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p, i) => (
          <circle key={p.dateKey} cx={x(i)} cy={y(rate(p))} r="2.5" className="fill-graphite" />
        ))}
      </svg>
      <div className="mt-1 flex items-center justify-between text-[11px] text-steel">
        <span>{fmtDate(first.capturedAt)}</span>
        <span className="font-medium text-ink">
          Now: {Math.round(rate(last) * 100)}% {def.short}
        </span>
        <span>{fmtDate(last.capturedAt)}</span>
      </div>
    </div>
  );
}
