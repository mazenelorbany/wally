import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Crown, Medal, Star, Trophy } from 'lucide-react';
import { Badge, Spinner, cn } from '@wally/ui';
import type { StoreBand, StoreScore } from '@wally/types';

import { api } from '../../lib/api';
import { useSetStudioTopBar } from '../components/StudioContext';

// Colour-blind-safe band chips: every band carries a label, never hue alone.
const BAND: Record<StoreBand, { label: string; cls: string }> = {
  perfect: { label: 'Perfect', cls: 'text-pass' },
  good: { label: 'Good', cls: 'text-pass' },
  needs_review: { label: 'Review', cls: 'text-graphite' },
  not_good: { label: 'Failing', cls: 'text-fail' },
  incomplete: { label: 'Incomplete', cls: 'text-warn' },
};

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

type Ranked = StoreScore & {
  rank: number;
  score: number;
  done: number;
  passing: number;
};

/** Store league table — best→worst by compliance pass-rate. */
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

  const queueQ = useQuery({
    queryKey: ['studio', 'leaderboard-queue', campaign?.id],
    queryFn: () => api.campaigns.queue(campaign!.id),
    enabled: Boolean(campaign?.id),
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
        ...new Set((queueQ.data ?? []).map((s) => s.region).filter(Boolean)),
      ].sort() as string[],
    [queueQ.data],
  );

  const ranked: Ranked[] = React.useMemo(() => {
    const stores = (queueQ.data ?? []).filter(
      (s) => region === 'all' || s.region === region,
    );
    return stores
      .map((s) => ({
        ...s,
        score: passRate(s),
        done: completion(s),
        passing: s.fixtures.filter(
          (f) =>
            f.status === 'scored' &&
            (f.overall === 'perfect' || f.overall === 'good'),
        ).length,
      }))
      .sort((a, b) => b.score - a.score || b.done - a.done || a.storeName.localeCompare(b.storeName))
      .map((s, i) => ({ ...s, rank: i + 1 }));
  }, [queueQ.data, region]);

  const fleetExpected = ranked.reduce((a, s) => a + s.expected, 0);
  const fleetPassing = ranked.reduce((a, s) => a + s.passing, 0);
  const fleetRate = fleetExpected ? fleetPassing / fleetExpected : 0;

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
            Stores ranked by VM compliance — passing fixtures against the full
            checklist.
          </p>
        </div>
        <div className="flex shrink-0 items-end gap-4">
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
                {Math.round(fleetRate * 100)}%
              </p>
              <p className="text-[11px] uppercase tracking-brand text-steel">
                Fleet pass-rate
              </p>
            </div>
          ) : null}
        </div>
      </header>

      {campaignsQ.isLoading || queueQ.isLoading ? (
        <div className="grid h-40 place-items-center">
          <Spinner className="text-2xl text-steel" />
        </div>
      ) : !campaign ? (
        <p className="text-sm text-steel">No active guide yet.</p>
      ) : ranked.length === 0 ? (
        <p className="text-sm text-steel">No stores in this guide yet.</p>
      ) : (
        <>
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
                <Star className="h-3.5 w-3.5 text-signal" aria-hidden="true" />
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
  { icon: Crown, cls: 'text-signal', ring: 'border-signal/40 bg-signal/5' },
  { icon: Trophy, cls: 'text-graphite', ring: 'border-mist/70 bg-surface/50' },
  { icon: Medal, cls: 'text-graphite', ring: 'border-mist/70 bg-surface/50' },
] as const;

function PodiumCard({ store: s }: { store: Ranked }) {
  const m = MEDAL[s.rank - 1] ?? MEDAL[2];
  const Icon = m.icon;
  const band = BAND[s.overall];
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
          {Math.round(s.score * 100)}%
        </span>
        <span className={cn('text-xs font-medium', band.cls)}>{band.label}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-steel">
        {s.passing}/{s.expected} fixtures passing
      </p>
    </div>
  );
}

function Row({ store: s }: { store: Ranked }) {
  const band = BAND[s.overall];
  return (
    <li className="flex items-center gap-4 px-5 py-3.5">
      <span className="w-7 shrink-0 text-center font-display text-sm font-bold tabular-nums text-steel">
        {s.rank}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[15px] font-semibold text-ink">
          {s.storeName}
        </span>
        <span className="mt-1 flex items-center gap-2">
          <span className="h-1.5 w-28 overflow-hidden rounded-full bg-mist/50">
            <span
              className="block h-full rounded-full bg-graphite"
              style={{ width: `${Math.round(s.done * 100)}%` }}
            />
          </span>
          <span className="text-xs text-steel">
            {s.submitted}/{s.expected} submitted
          </span>
        </span>
      </span>

      <Badge variant="muted" className={cn('shrink-0', band.cls)}>
        {band.label}
      </Badge>

      <span className="w-14 shrink-0 text-right font-display text-base font-semibold tabular-nums text-ink">
        {Math.round(s.score * 100)}%
      </span>
    </li>
  );
}
