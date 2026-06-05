import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronRight,
  Download,
  FileText,
} from 'lucide-react';
import { Button, Card, Verdict } from '@wally/ui';

import type { FixtureOutcome, StoreScore } from '@wally/types';
import { useCampaigns, useStoreScore } from '../lib/hooks';
import { api, errorMessage } from '../lib/api';
import { bandLabel, humanizeKey, storeReasons } from '../lib/format';
import { ErrorState, Skeleton } from '../components/states';

export function StoreDetailPage() {
  const { id } = useParams();
  const campaignsQ = useCampaigns();
  const campaignId = campaignsQ.data?.[0]?.id;
  const q = useStoreScore(id, campaignId);

  if (q.isLoading) return <DetailSkeleton />;
  if (q.isError) {
    return (
      <div>
        <BackLink />
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </div>
    );
  }

  const store = q.data!;
  return (
    <div>
      <BackLink />

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-brand text-steel">
            {store.campaignKey}
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
            {store.storeName}
          </h1>
          <p className="mt-1 text-sm text-steel">
            {store.submitted} of {store.expected} fixtures submitted
          </p>
        </div>
        <div className="flex flex-col items-end gap-3">
          <Verdict tone={store.overall} size="lg" />
          <ReportButton storeId={store.storeId} />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="order-2 lg:order-1">
          <FixtureLedger store={store} />
        </div>
        <aside className="order-1 lg:order-2">
          <Rollup store={store} />
        </aside>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/console"
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-steel transition-colors hover:text-graphite"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to queue
    </Link>
  );
}

/** Plain-English verdict explanation — why the store landed where it did. */
function Rollup({ store }: { store: StoreScore }) {
  const reasons = storeReasons(store);
  return (
    <Card className="p-5">
      <p className="text-[11px] uppercase tracking-brand text-steel">In plain English</p>
      <p className="mt-2 font-display text-lg font-semibold leading-snug text-ink">
        This store is{' '}
        <span className="text-graphite">{bandLabel(store.overall).toLowerCase()}</span>.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {reasons.map((r, i) => (
          <li key={i} className="flex gap-2 text-sm text-graphite">
            <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-mist" />
            <span>{r}</span>
          </li>
        ))}
      </ul>

      {store.rubricVersions.length > 0 ? (
        <p className="mt-4 border-t border-mist/50 pt-3 text-[11px] text-steel">
          Scored against {store.rubricVersions.join(', ')}
        </p>
      ) : null}
    </Card>
  );
}

/** The fixture ledger — every fixture, its status, and a way in to review it. */
function FixtureLedger({ store }: { store: StoreScore }) {
  return (
    <section>
      <p className="mb-2.5 text-[11px] uppercase tracking-brand text-steel">
        Fixture ledger
      </p>
      <div className="overflow-hidden rounded-lg border border-mist/60">
        {store.fixtures.length === 0 ? (
          <p className="px-4 py-6 text-sm text-steel">No fixtures recorded yet.</p>
        ) : (
          <ul className="divide-y divide-mist/50">
            {store.fixtures.map((f) => (
              <FixtureRow
                key={f.fixture}
                fixture={f}
                submissionId={store.submissionId ?? undefined}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function FixtureRow({
  fixture,
  submissionId,
}: {
  fixture: FixtureOutcome;
  submissionId?: string;
}) {
  const canOpen = fixture.status === 'scored' && fixture.photoId && submissionId;
  const inner = (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">
          {fixture.label || humanizeKey(fixture.fixture)}
        </p>
      </div>
      <FixtureStatusChip fixture={fixture} />
      {canOpen ? (
        <ChevronRight className="h-5 w-5 shrink-0 text-mist" />
      ) : (
        <span className="h-5 w-5 shrink-0" aria-hidden="true" />
      )}
    </div>
  );

  if (canOpen) {
    return (
      <li>
        <Link
          to={`/console/fixture/${encodeURIComponent(fixture.photoId as string)}?submission=${encodeURIComponent(submissionId as string)}`}
          className="tap block bg-paper hover:bg-surface/60"
        >
          {inner}
        </Link>
      </li>
    );
  }
  return <li className="bg-paper">{inner}</li>;
}

function FixtureStatusChip({ fixture }: { fixture: FixtureOutcome }) {
  if (fixture.status === 'scored' && fixture.overall) {
    return <Verdict tone={fixture.overall} size="sm" />;
  }
  if (fixture.status === 'not_applicable') {
    return (
      <span className="rounded-md bg-surface px-2 py-0.5 text-[11px] font-medium text-steel">
        Not applicable
      </span>
    );
  }
  return (
    <span className="rounded-md bg-surface px-2 py-0.5 text-[11px] font-medium text-steel">
      Not submitted
    </span>
  );
}

/** Resolve a signed report URL on click (never prefetch the bytes). */
function ReportButton({ storeId }: { storeId: string }) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const open = async () => {
    setLoading(true);
    setError(null);
    try {
      const { url } = await api.reports.url(storeId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="text-right">
      <Button variant="outline" size="sm" onClick={open} loading={loading}>
        {loading ? <FileText className="h-4 w-4" /> : <Download className="h-4 w-4" />}
        Store report
      </Button>
      {error ? <p className="mt-1 text-xs text-signal">{error}</p> : null}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div>
      <Skeleton className="mb-4 h-4 w-28" />
      <div className="mb-6 flex items-start justify-between">
        <div>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-2 h-8 w-56" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    </div>
  );
}
