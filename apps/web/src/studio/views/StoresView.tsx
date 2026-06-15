import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Store as StoreIcon } from 'lucide-react';
import { Badge, Spinner } from '@wally/ui';
import type { StoreScore } from '@wally/types';

import { api } from '../../lib/api';
import { useSetStudioTopBar } from '../components/StudioContext';
import { useProject } from '../ProjectContext';
import { brandLabel, isDefaultBrand, splitVenueName } from '../lib/venue';

/** One physical venue with its concession mini-stores ("{Venue} — {Brand}"). */
interface VenueGroup {
  venue: string;
  entries: { storeId: string; brand: string }[];
}

/**
 * The door into each venue's floor plan — a GUIDE surface, deliberately free
 * of compliance judgment. One row per physical venue (concessions merge; the
 * floor plan's brand toggle switches between them), carrying only capture
 * progress; verdict bands live on the Dashboard, scoring on the report.
 */
export function StoresView() {
  const { project, projectId, campaignId } = useProject();

  useSetStudioTopBar({
    guideName: 'Stores',
    guideKey: project?.campaignKey ?? undefined,
    stores: [],
  });

  // The project's venues are the source of truth for the list…
  const venuesQ = useQuery({
    queryKey: ['studio', 'project-venues', projectId],
    queryFn: () => api.projects.venues(projectId!),
    enabled: Boolean(projectId),
  });
  // …and the compliance queue supplies capture progress where present.
  const queueQ = useQuery({
    queryKey: ['studio', 'queue-stores', campaignId],
    queryFn: () => api.campaigns.queue(campaignId!),
    enabled: Boolean(campaignId),
  });
  const scoreById = React.useMemo(() => {
    const m = new Map<string, StoreScore>();
    for (const s of queueQ.data ?? []) m.set(s.storeId, s);
    return m;
  }, [queueQ.data]);

  // Fold concession mini-stores into one row per venue, first-seen order.
  const groups = React.useMemo(() => {
    const map = new Map<string, VenueGroup>();
    for (const v of venuesQ.data ?? []) {
      const { venue, brand } = splitVenueName(v.storeName);
      const g = map.get(venue) ?? { venue, entries: [] };
      g.entries.push({ storeId: v.storeId, brand });
      map.set(venue, g);
    }
    return [...map.values()];
  }, [venuesQ.data]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-brand text-steel">Operations</p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
          Stores{' '}
          {project?.campaignKey ? (
            <span className="text-steel">· {project.campaignKey}</span>
          ) : null}
        </h1>
        <p className="mt-1 text-sm text-steel">Open a venue's floor plan.</p>
      </header>

      {venuesQ.isLoading ? (
        <div className="grid h-40 place-items-center">
          <Spinner className="text-2xl text-steel" />
        </div>
      ) : !projectId ? (
        <p className="text-sm text-steel">No project selected.</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-steel">No stores in this project yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <VenueCard
              key={g.venue}
              campaignId={campaignId}
              group={g}
              scoreById={scoreById}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function VenueCard({
  campaignId,
  group,
  scoreById,
}: {
  campaignId: string | undefined;
  group: VenueGroup;
  scoreById: Map<string, StoreScore>;
}) {
  // The floor plan opens on the venue's default concession (Custom Chef when
  // present); its brand toggle reaches the others.
  const target =
    group.entries.find((e) => isDefaultBrand(e.brand)) ?? group.entries[0]!;
  // Capture progress rolls up across the venue's concessions.
  const scores = group.entries
    .map((e) => scoreById.get(e.storeId))
    .filter((s): s is StoreScore => Boolean(s));
  const submitted = scores.reduce((a, s) => a + s.submitted, 0);
  const expected = scores.reduce((a, s) => a + s.expected, 0);
  const pct = expected > 0 ? Math.round((submitted / expected) * 100) : 0;

  return (
    <Link
      to={
        campaignId
          ? `/studio/${campaignId}/store/${target.storeId}`
          : '/studio/stores'
      }
      className="group flex flex-col rounded-lg border border-mist/70 bg-paper p-5 shadow-card transition-[transform,box-shadow,border-color] duration-base ease-out hover:-translate-y-0.5 hover:border-gold/40 hover:shadow-lift active:translate-y-0 active:scale-[0.99]"
    >
      <div className="flex items-center justify-between">
        <span
          aria-hidden="true"
          className="grid h-10 w-10 place-items-center rounded-md bg-surface text-graphite transition-colors group-hover:bg-gold/10 group-hover:text-gold-deep"
        >
          <StoreIcon className="h-5 w-5" />
        </span>
        <ArrowRight className="h-4 w-4 text-mist transition-colors group-hover:text-gold-deep" />
      </div>
      <h3 className="mt-4 font-display text-base font-semibold tracking-tight text-ink">
        {group.venue}
      </h3>
      {group.entries.length > 1 ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {group.entries.map((e) => (
            <Badge key={e.storeId} variant="muted">
              {brandLabel(e.brand)}
            </Badge>
          ))}
        </div>
      ) : null}
      <div className="mt-auto flex items-center gap-2 pt-4">
        {scores.length > 0 ? (
          <>
            <span className="h-1.5 w-28 overflow-hidden rounded-full bg-mist/50">
              <span
                className="block h-full rounded-full bg-graphite"
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="text-xs text-steel">
              {submitted}/{expected} photos
            </span>
          </>
        ) : (
          <span className="text-xs text-steel">Open floor plan to set up</span>
        )}
      </div>
    </Link>
  );
}
