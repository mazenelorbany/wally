import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { Spinner } from '@wally/ui';
import type { StoreBand, StoreScore } from '@wally/types';

import { api } from '../../lib/api';
import { useSetStudioTopBar } from '../components/StudioContext';

// Colour-blind-safe: every band carries an icon + label, never hue alone.
const BAND: Record<StoreBand, { icon: string; label: string; cls: string }> = {
  perfect: { icon: '✓', label: 'Perfect', cls: 'text-pass' },
  good: { icon: '✓', label: 'Good', cls: 'text-pass' },
  not_good: { icon: '✕', label: 'Not good', cls: 'text-fail' },
  needs_review: { icon: '◐', label: 'Review', cls: 'text-graphite' },
  incomplete: { icon: '!', label: 'Incomplete', cls: 'text-warn' },
};

/** Every store in the active guide, with its execution progress. */
export function StoresView() {
  const campaignsQ = useQuery({
    queryKey: ['studio', 'campaigns'],
    queryFn: () => api.campaigns.list(),
  });
  const campaign =
    campaignsQ.data?.find((c) => c.status === 'ACTIVE') ?? campaignsQ.data?.[0];

  useSetStudioTopBar({ guideName: 'Stores', guideKey: campaign?.key, stores: [] });

  const storesQ = useQuery({
    queryKey: ['studio', 'queue-stores', campaign?.id],
    queryFn: () => api.campaigns.queue(campaign!.id),
    enabled: Boolean(campaign?.id),
  });
  const stores = storesQ.data ?? [];

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-brand text-steel">
          Operations
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
          Stores {campaign ? <span className="text-steel">· {campaign.key}</span> : null}
        </h1>
        <p className="mt-1 text-sm text-steel">
          Open a store's floor plan, or track execution at a glance.
        </p>
      </header>

      {campaignsQ.isLoading || storesQ.isLoading ? (
        <div className="grid h-40 place-items-center">
          <Spinner className="text-2xl text-steel" />
        </div>
      ) : !campaign ? (
        <p className="text-sm text-steel">No active guide yet.</p>
      ) : stores.length === 0 ? (
        <p className="text-sm text-steel">No stores in this guide yet.</p>
      ) : (
        <ul className="divide-y divide-mist/50 overflow-hidden rounded-lg border border-mist/60 bg-paper">
          {stores.map((s) => (
            <StoreRow key={s.storeId} campaignId={campaign.id} store={s} />
          ))}
        </ul>
      )}
    </div>
  );
}

function StoreRow({ campaignId, store }: { campaignId: string; store: StoreScore }) {
  const band = BAND[store.overall];
  const pct = store.expected > 0 ? Math.round((store.submitted / store.expected) * 100) : 0;

  return (
    <li>
      <Link
        to={`/studio/${campaignId}/store/${store.storeId}`}
        className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface/60"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[15px] font-semibold text-ink">
            {store.storeName}
          </span>
          <span className="mt-1 flex items-center gap-2">
            <span className="h-1.5 w-28 overflow-hidden rounded-full bg-mist/50">
              <span
                className="block h-full rounded-full bg-graphite"
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="text-xs text-steel">
              {store.submitted}/{store.expected} scored
            </span>
          </span>
        </span>

        <span className={`flex items-center gap-1.5 text-sm font-medium ${band.cls}`}>
          <span aria-hidden="true">{band.icon}</span>
          {band.label}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-mist" aria-hidden="true" />
      </Link>
    </li>
  );
}
