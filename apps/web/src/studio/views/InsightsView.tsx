import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpDown,
  Camera,
  Clock,
  Download,
  RotateCcw,
  TrendingUp,
} from 'lucide-react';
import { Badge, Button, Spinner, cn } from '@wally/ui';
import type { ComplianceTrendPoint, StoreBand, StoreScore } from '@wally/types';

import { api } from '../../lib/api';
import { useSession } from '../../lib/auth';
import { useSetStudioTopBar } from '../components/StudioContext';

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

type SortKey = 'score' | 'completion' | 'defects';

/** Compliance analytics for the active guide — KPIs, turnaround, store table, export. */
export function InsightsView() {
  const campaignsQ = useQuery({
    queryKey: ['studio', 'campaigns'],
    queryFn: () => api.campaigns.list(),
  });
  const campaign =
    campaignsQ.data?.find((c) => c.status === 'ACTIVE') ?? campaignsQ.data?.[0];

  useSetStudioTopBar({ guideName: 'Insights', guideKey: campaign?.key, stores: [] });

  const queueQ = useQuery({
    queryKey: ['studio', 'insights-queue', campaign?.id],
    queryFn: () => api.campaigns.queue(campaign!.id),
    enabled: Boolean(campaign?.id),
  });
  const turnaroundQ = useQuery({
    queryKey: ['studio', 'insights-turnaround', campaign?.id],
    queryFn: () => api.campaigns.turnaround(campaign!.id),
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
        </div>
        <div className="flex items-end gap-2">
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
      ) : !campaign ? (
        <p className="text-sm text-steel">No active guide yet.</p>
      ) : stores.length === 0 ? (
        <p className="text-sm text-steel">No stores in this guide yet.</p>
      ) : (
        <>
          {/* KPI tiles */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Fleet pass-rate" value={`${fleetRate}%`} />
            <Tile label="Completion" value={`${fleetDone}%`} sub={`${subTotal}/${expTotal} photos`} />
            <Tile label="On track" value={String(onTrack)} tone="text-pass" />
            <Tile
              label="Failing / review"
              value={`${failing} / ${review}`}
              tone="text-fail"
            />
          </div>

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
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-brand text-steel">
                <TrendingUp className="h-3.5 w-3.5" /> Compliance trend ·
                pass-rate
              </p>
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
            {trendQ.isLoading ? (
              <div className="grid h-24 place-items-center">
                <Spinner className="text-lg text-steel" />
              </div>
            ) : (trendQ.data?.length ?? 0) < 2 ? (
              <p className="text-sm text-steel">
                The trend builds as daily snapshots accumulate
                {isAdmin ? ' — capture one now to start the line.' : '.'}
                {trendQ.data?.length === 1 ? ' (1 point so far)' : ''}
              </p>
            ) : (
              <TrendChart points={trendQ.data!} />
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
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-mist/60 bg-paper p-4">
      <p className="text-[11px] uppercase tracking-brand text-steel">{label}</p>
      <p className={cn('mt-1 font-display text-2xl font-semibold tabular-nums', tone)}>
        {value}
      </p>
      {sub ? <p className="mt-0.5 text-[11px] text-steel">{sub}</p> : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-steel">{label}</dt>
      <dd className="font-display font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

/** Lightweight inline SVG line chart of pass-rate over the snapshots (no deps). */
function TrendChart({ points }: { points: ComplianceTrendPoint[] }) {
  const W = 720;
  const H = 180;
  const padX = 10;
  const padTop = 12;
  const padBottom = 22;
  const n = points.length;
  const first = points[0];
  const last = points[n - 1];
  if (!first || !last) return null;

  const rate = (p: ComplianceTrendPoint) =>
    p.expected > 0 ? p.passing / p.expected : 0;
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
        aria-label="Compliance pass-rate over time"
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
          Now: {Math.round(rate(last) * 100)}% pass-rate
        </span>
        <span>{fmtDate(last.capturedAt)}</span>
      </div>
    </div>
  );
}
