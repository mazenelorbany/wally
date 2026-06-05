import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { Spinner } from '@wally/ui';
import type { StoreBand, StoreScore } from '@wally/types';

import { api } from '../../lib/api';
import { useSetStudioTopBar } from '../components/StudioContext';
import { useProject } from '../ProjectContext';

// Colour-blind-safe: every band carries an icon + label, never hue alone.
const BAND: Record<StoreBand, { icon: string; label: string; cls: string }> = {
  perfect: { icon: '✓', label: 'Perfect', cls: 'text-pass' },
  good: { icon: '✓', label: 'Good', cls: 'text-pass' },
  not_good: { icon: '✕', label: 'Not good', cls: 'text-fail' },
  needs_review: { icon: '◐', label: 'Review', cls: 'text-graphite' },
  incomplete: { icon: '!', label: 'Incomplete', cls: 'text-warn' },
};

interface Venue {
  storeId: string;
  storeName: string;
}

/** Every venue in the selected project, with its execution progress (if any). */
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
  // …and the compliance queue supplies each one's band + progress where present.
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

  const venues: Venue[] = venuesQ.data ?? [];

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-brand text-steel">Operations</p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
          Stores{' '}
          {project?.campaignKey ? (
            <span className="text-steel">· {project.campaignKey}</span>
          ) : null}
        </h1>
        <p className="mt-1 text-sm text-steel">
          Open a venue's floor plan, or track execution at a glance.
        </p>
      </header>

      {venuesQ.isLoading ? (
        <div className="grid h-40 place-items-center">
          <Spinner className="text-2xl text-steel" />
        </div>
      ) : !projectId ? (
        <p className="text-sm text-steel">No project selected.</p>
      ) : venues.length === 0 ? (
        <p className="text-sm text-steel">No stores in this project yet.</p>
      ) : (
        <ul className="divide-y divide-mist/50 overflow-hidden rounded-lg border border-mist/60 bg-paper">
          {venues.map((v) => (
            <StoreRow
              key={v.storeId}
              campaignId={campaignId}
              venue={v}
              score={scoreById.get(v.storeId)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function StoreRow({
  campaignId,
  venue,
  score,
}: {
  campaignId: string | undefined;
  venue: Venue;
  score?: StoreScore;
}) {
  const band = score ? BAND[score.overall] : null;
  const pct =
    score && score.expected > 0
      ? Math.round((score.submitted / score.expected) * 100)
      : 0;

  return (
    <li>
      <Link
        to={
          campaignId
            ? `/studio/${campaignId}/store/${venue.storeId}`
            : '/studio/stores'
        }
        className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface/60"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[15px] font-semibold text-ink">
            {venue.storeName}
          </span>
          <span className="mt-1 flex items-center gap-2">
            {score ? (
              <>
                <span className="h-1.5 w-28 overflow-hidden rounded-full bg-mist/50">
                  <span
                    className="block h-full rounded-full bg-graphite"
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <span className="text-xs text-steel">
                  {score.submitted}/{score.expected} scored
                </span>
              </>
            ) : (
              <span className="text-xs text-steel">Open floor plan to set up</span>
            )}
          </span>
        </span>

        {band ? (
          <span className={`flex items-center gap-1.5 text-sm font-medium ${band.cls}`}>
            <span aria-hidden="true">{band.icon}</span>
            {band.label}
          </span>
        ) : (
          <span className="text-sm font-medium text-steel">Not started</span>
        )}
        <ChevronRight className="h-4 w-4 shrink-0 text-mist" aria-hidden="true" />
      </Link>
    </li>
  );
}
