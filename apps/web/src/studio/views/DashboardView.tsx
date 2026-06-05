import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Eye,
  XCircle,
} from 'lucide-react';
import { Spinner } from '@wally/ui';
import type { StoreBand, StoreScore } from '@wally/types';

import { api } from '../../lib/api';
import { useProject } from '../ProjectContext';

// Band → label + icon (icon + word, never colour alone — colour-blind safe).
const BAND: Record<
  StoreBand,
  { label: string; icon: React.ComponentType<{ className?: string }>; cls: string; rank: number }
> = {
  perfect: { label: 'Perfect', icon: CheckCircle2, cls: 'text-pass', rank: 0 },
  good: { label: 'On track', icon: CheckCircle2, cls: 'text-pass', rank: 1 },
  needs_review: { label: 'Needs review', icon: Eye, cls: 'text-graphite', rank: 3 },
  not_good: { label: 'Failing', icon: XCircle, cls: 'text-signal', rank: 4 },
  incomplete: { label: 'Not started', icon: CircleDashed, cls: 'text-steel', rank: 2 },
};

const attention = (s: StoreScore) =>
  s.failed.length + s.review.length + s.missing.length;

export function DashboardView() {
  const { project, campaignId } = useProject();

  const queueQ = useQuery({
    queryKey: ['studio', 'dashboard-queue', campaignId],
    queryFn: () => api.campaigns.queue(campaignId!),
    enabled: Boolean(campaignId),
  });

  if (queueQ.isLoading) {
    return (
      <div className="grid h-64 place-items-center">
        <Spinner className="text-2xl text-steel" />
      </div>
    );
  }
  const stores = queueQ.data ?? [];
  const onTrack = stores.filter((s) => s.overall === 'perfect' || s.overall === 'good').length;
  const review = stores.filter((s) => s.overall === 'needs_review').length;
  const failing = stores.filter((s) => s.overall === 'not_good').length;
  const notStarted = stores.filter((s) => s.overall === 'incomplete').length;
  const submitted = stores.reduce((a, s) => a + s.submitted, 0);
  const expected = stores.reduce((a, s) => a + s.expected, 0);
  const pct = expected ? Math.round((submitted / expected) * 100) : 0;

  const attentionStores = [...stores]
    .filter((s) => s.overall !== 'perfect' && s.overall !== 'good')
    .sort((a, b) => attention(b) - attention(a) || a.storeName.localeCompare(b.storeName));

  // Distribution segments for the rollup bar (only non-empty bands).
  const segs = (
    [
      { band: 'good', n: onTrack },
      { band: 'needs_review', n: review },
      { band: 'not_good', n: failing },
      { band: 'incomplete', n: notStarted },
    ] as { band: StoreBand; n: number }[]
  ).filter((s) => s.n > 0);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-brand text-steel">
          {project?.name ?? 'Project'} · Dashboard
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
          Estate rollout
        </h1>
      </header>

      {/* Headline tiles */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Stores" value={String(stores.length)} sub={`${pct}% photos in`} />
        <Tile label="On track" value={String(onTrack)} icon={CheckCircle2} tone="text-pass" />
        <Tile label="Needs review" value={String(review)} icon={Eye} tone="text-graphite" />
        <Tile label="Failing" value={String(failing)} icon={XCircle} tone="text-signal" />
      </div>

      {/* Compliance distribution */}
      <section className="mb-6 rounded-xl border border-mist/60 bg-paper p-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[11px] uppercase tracking-brand text-steel">
            Compliance across {stores.length} stores
          </h2>
          <span className="text-xs tabular-nums text-steel">
            {submitted}/{expected} photos
          </span>
        </div>
        <div className="flex h-3 overflow-hidden rounded-full border border-mist/60">
          {segs.map((s) => (
            <div
              key={s.band}
              title={`${BAND[s.band].label}: ${s.n}`}
              className={segShade(s.band)}
              style={{ width: `${(s.n / stores.length) * 100}%` }}
            />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {segs.map((s) => {
            const Icon = BAND[s.band].icon;
            return (
              <span key={s.band} className="inline-flex items-center gap-1 text-[11px] text-steel">
                <Icon className={`h-3.5 w-3.5 ${BAND[s.band].cls}`} /> {BAND[s.band].label} · {s.n}
              </span>
            );
          })}
        </div>
      </section>

      {/* Attention list */}
      <section>
        <h2 className="mb-2 text-[11px] uppercase tracking-brand text-steel">
          Needs your attention ({attentionStores.length})
        </h2>
        {attentionStores.length === 0 ? (
          <div className="rounded-xl border border-mist/60 bg-surface/40 px-5 py-8 text-center">
            <CheckCircle2 className="mx-auto h-7 w-7 text-pass" />
            <p className="mt-2 text-sm font-medium text-ink">Every store is on track</p>
          </div>
        ) : (
          <div className="divide-y divide-mist/40 overflow-hidden rounded-xl border border-mist/60 bg-paper">
            {attentionStores.map((s) => {
              const meta = BAND[s.overall];
              const Icon = meta.icon;
              return (
                <Link
                  key={s.storeId}
                  to={`/console/store/${encodeURIComponent(s.storeId)}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-surface/50"
                >
                  <Icon className={`h-4 w-4 shrink-0 ${meta.cls}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{s.storeName}</p>
                    <p className="text-xs text-steel">
                      {meta.label} · {s.submitted}/{s.expected} photos
                      {s.failed.length ? ` · ${s.failed.length} failing` : ''}
                      {s.review.length ? ` · ${s.review.length} to review` : ''}
                      {s.missing.length ? ` · ${s.missing.length} missing` : ''}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-mist" />
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-mist/60 bg-paper p-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-brand text-steel">{label}</span>
        {Icon ? <Icon className={`h-4 w-4 ${tone ?? 'text-mist'}`} /> : null}
      </div>
      <p className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-steel">{sub}</p> : null}
    </div>
  );
}

// Monochrome graphite ramp by severity so the bar reads in greyscale; the
// labels below carry the meaning (colour-blind safe).
function segShade(band: StoreBand): string {
  switch (band) {
    case 'good':
      return 'bg-[rgba(60,59,54,0.18)]';
    case 'incomplete':
      return 'bg-[rgba(60,59,54,0.38)]';
    case 'needs_review':
      return 'bg-[rgba(60,59,54,0.58)]';
    case 'not_good':
      return 'bg-signal';
    default:
      return 'bg-[rgba(60,59,54,0.3)]';
  }
}
