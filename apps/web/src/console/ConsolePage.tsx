import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, ListChecks, RefreshCw } from 'lucide-react';
import { Button } from '@wally/ui';

import type { StoreScore } from '@wally/types';
import { useCampaigns, useQueue } from '../lib/hooks';
import { attentionCount } from '../lib/format';
import { EmptyState, ErrorState, Skeleton } from '../components/states';
import { CampaignPicker } from './CampaignPicker';
import { StoreRow } from './StoreRow';
import { ChaseList } from './ChaseList';

// Sort the queue so the work that matters surfaces first: most attention on top,
// then by completeness. A clean store sinks to the bottom — exactly where a
// reviewer wants it.
function byAttention(a: StoreScore, b: StoreScore): number {
  const d = attentionCount(b) - attentionCount(a);
  if (d !== 0) return d;
  return a.storeName.localeCompare(b.storeName);
}

export function ConsolePage() {
  const [search, setSearch] = useSearchParams();
  const campaignsQ = useCampaigns();

  const selectedId =
    search.get('campaign') ?? campaignsQ.data?.[0]?.id ?? undefined;

  const queueQ = useQueue(selectedId);

  const setCampaign = (id: string) => {
    const next = new URLSearchParams(search);
    next.set('campaign', id);
    setSearch(next, { replace: true });
  };

  if (campaignsQ.isLoading) return <QueueSkeleton />;
  if (campaignsQ.isError) {
    return <ErrorState error={campaignsQ.error} onRetry={() => campaignsQ.refetch()} />;
  }
  if (!campaignsQ.data || campaignsQ.data.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No campaigns yet"
        body="Once an admin sets up a campaign, scored stores will appear here."
      />
    );
  }

  const stores = (queueQ.data ?? []).slice().sort(byAttention);
  const attention = stores.filter((s) => attentionCount(s) > 0);
  const clear = stores.filter((s) => attentionCount(s) === 0);

  return (
    <div>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-brand text-steel">Reviewer console</p>
          <h1 className="mt-1 font-display text-xl font-semibold tracking-tight text-ink">
            The queue
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <CampaignPicker
            campaigns={campaignsQ.data}
            value={selectedId}
            onChange={setCampaign}
          />
          <Button
            variant="outline"
            size="icon"
            aria-label="Refresh queue"
            loading={queueQ.isFetching}
            onClick={() => queueQ.refetch()}
          >
            {queueQ.isFetching ? null : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      {queueQ.isLoading ? (
        <QueueSkeleton headerless />
      ) : queueQ.isError ? (
        <ErrorState error={queueQ.error} onRetry={() => queueQ.refetch()} />
      ) : stores.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No stores in this campaign"
          body="Stores will appear here as managers submit their checklists."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div>
            {attention.length > 0 ? (
              <section className="mb-6">
                <SectionLabel
                  text={`Needs your attention · ${attention.length}`}
                  tone="signal"
                />
                <div className="flex flex-col gap-2.5">
                  {attention.map((s) => (
                    <StoreRow key={s.storeId} store={s} />
                  ))}
                </div>
              </section>
            ) : null}

            <section>
              <SectionLabel
                text={
                  clear.length > 0
                    ? `Cleared · ${clear.length}`
                    : 'Cleared'
                }
              />
              {clear.length > 0 ? (
                <div className="flex flex-col gap-2.5">
                  {clear.map((s) => (
                    <StoreRow key={s.storeId} store={s} />
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-dashed border-mist/70 px-4 py-4 text-sm text-steel">
                  <CheckCircle2 className="h-4 w-4 text-pass" aria-hidden="true" />
                  Nothing cleared yet.
                </div>
              )}
            </section>
          </div>

          <aside>
            <ChaseList stores={stores} />
          </aside>
        </div>
      )}
    </div>
  );
}

function SectionLabel({
  text,
  tone = 'neutral',
}: {
  text: string;
  tone?: 'neutral' | 'signal';
}) {
  return (
    <div className="mb-2.5 flex items-center gap-2">
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${tone === 'signal' ? 'bg-signal' : 'bg-mist'}`}
      />
      <h2 className="text-[11px] font-medium uppercase tracking-brand text-steel">
        {text}
      </h2>
    </div>
  );
}

function QueueSkeleton({ headerless = false }: { headerless?: boolean }) {
  return (
    <div>
      {headerless ? null : (
        <div className="mb-5 flex items-center justify-between">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-9 w-48" />
        </div>
      )}
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
