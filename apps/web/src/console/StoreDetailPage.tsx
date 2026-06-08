import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Download, FileText } from 'lucide-react';
import { Button, Card } from '@wally/ui';

import type { CaptureVerdict, FixtureCompliance } from '@wally/sdk';
import { useCampaigns, useCompliance, useQueue } from '../lib/hooks';
import { api, errorMessage } from '../lib/api';
import { ErrorState, Skeleton } from '../components/states';
import { CaptureVerdictChip } from './captureVerdict';

/** A fixture's effective verdict (a reviewer override beats the AI). */
function effective(f: FixtureCompliance): CaptureVerdict | null {
  return (f.effectiveVerdict ?? f.overall) ?? null;
}

/** Reviewer sort: what needs attention first (NEEDS_REVIEW, then FAIL, then PASS,
 *  then the un-scored), keeping fixtures with a photo above empty ones. */
const ATTENTION_ORDER: Record<CaptureVerdict | 'none', number> = {
  NEEDS_REVIEW: 0,
  FAIL: 1,
  PASS: 2,
  none: 3,
};

export function StoreDetailPage() {
  // Route is /studio/review/store/:id — `id` is the storeId the reviewer drilled into.
  const { id: storeId } = useParams();

  const compQ = useCompliance(storeId);

  // The store name comes from the (FixtureCapture-based) queue we drilled in
  // from — no extra round-trip. We don't hard-depend on it: the page works
  // without it, the name is just chrome.
  const campaignsQ = useCampaigns();
  const campaignId = campaignsQ.data?.[0]?.id;
  const queueQ = useQueue(campaignId);
  const storeRow = queueQ.data?.find((s) => s.storeId === storeId);
  const storeName = storeRow?.storeName;
  const campaignKey = storeRow?.campaignKey;

  if (compQ.isLoading) return <DetailSkeleton />;
  if (compQ.isError) {
    return (
      <div>
        <BackLink />
        <ErrorState error={compQ.error} onRetry={() => compQ.refetch()} />
      </div>
    );
  }

  const fixtures = compQ.data ?? [];
  const applicable = fixtures; // compliance returns the store's own fixtures
  const scored = applicable.filter((f) => f.state === 'scored');
  const needsReview = scored.filter((f) => effective(f) === 'NEEDS_REVIEW');
  const failing = scored.filter((f) => effective(f) === 'FAIL');
  const passing = scored.filter((f) => effective(f) === 'PASS');
  const submitted = applicable.filter((f) => f.state !== 'todo').length;

  const sorted = [...applicable].sort((a, b) => {
    const ra = ATTENTION_ORDER[effective(a) ?? 'none'];
    const rb = ATTENTION_ORDER[effective(b) ?? 'none'];
    if (ra !== rb) return ra - rb;
    return a.label.localeCompare(b.label);
  });

  return (
    <div>
      <BackLink />

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          {campaignKey ? (
            <p className="text-[11px] uppercase tracking-brand text-steel">
              {campaignKey}
            </p>
          ) : null}
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
            {storeName ?? 'Store'}
          </h1>
          <p className="mt-1 text-sm text-steel">
            {submitted} of {applicable.length} fixtures captured
          </p>
        </div>
        <div className="flex flex-col items-end gap-3">
          {storeId ? <ReportButton storeId={storeId} /> : null}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="order-2 lg:order-1">
          <FixtureLedger fixtures={sorted} storeId={storeId} />
        </div>
        <aside className="order-1 lg:order-2">
          <Rollup
            needsReview={needsReview.length}
            failing={failing.length}
            passing={passing.length}
            captured={submitted}
            total={applicable.length}
          />
        </aside>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/studio/review"
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-steel transition-colors hover:text-graphite"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to queue
    </Link>
  );
}

/** A compact tally of where this store's fixtures sit. */
function Rollup({
  needsReview,
  failing,
  passing,
  captured,
  total,
}: {
  needsReview: number;
  failing: number;
  passing: number;
  captured: number;
  total: number;
}) {
  const rows: { label: string; count: number; tone: string }[] = [
    { label: 'Need review', count: needsReview, tone: 'text-graphite' },
    { label: 'Failing', count: failing, tone: 'text-signal' },
    { label: 'Passing', count: passing, tone: 'text-pass' },
    { label: 'Not captured', count: total - captured, tone: 'text-steel' },
  ];
  return (
    <Card className="p-5">
      <p className="text-[11px] uppercase tracking-brand text-steel">At a glance</p>
      <ul className="mt-3 flex flex-col divide-y divide-mist/40">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between py-2 text-sm">
            <span className="text-graphite">{r.label}</span>
            <span className={`font-display text-base font-semibold tabular-nums ${r.tone}`}>
              {r.count}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 border-t border-mist/50 pt-3 text-[11px] text-steel">
        Open any captured fixture to confirm, override, or request a new photo.
      </p>
    </Card>
  );
}

/** The fixture ledger — every fixture, its verdict, and a way in to review it. */
function FixtureLedger({
  fixtures,
  storeId,
}: {
  fixtures: FixtureCompliance[];
  storeId?: string;
}) {
  return (
    <section>
      <p className="mb-2.5 text-[11px] uppercase tracking-brand text-steel">
        Fixture ledger
      </p>
      <div className="overflow-hidden rounded-lg border border-mist/60">
        {fixtures.length === 0 ? (
          <p className="px-4 py-6 text-sm text-steel">No fixtures recorded yet.</p>
        ) : (
          <ul className="divide-y divide-mist/50">
            {fixtures.map((f) => (
              <FixtureRow key={f.fixtureId} fixture={f} storeId={storeId} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function FixtureRow({
  fixture,
  storeId,
}: {
  fixture: FixtureCompliance;
  storeId?: string;
}) {
  const verdict = effective(fixture);
  // A reviewer can open any fixture that has been scored.
  const canOpen = fixture.state === 'scored' && Boolean(storeId);
  const attention = verdict === 'NEEDS_REVIEW' || verdict === 'FAIL';

  const inner = (
    <div className="flex items-center gap-3 px-4 py-3">
      <span
        aria-hidden="true"
        className={[
          'h-8 w-1 shrink-0 rounded-full',
          attention ? 'bg-signal' : 'bg-mist/40',
        ].join(' ')}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{fixture.label}</p>
        {fixture.overrideVerdict ? (
          <p className="text-[11px] text-steel">Reviewer override</p>
        ) : null}
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
          to={`/studio/review/fixture/${encodeURIComponent(fixture.fixtureId)}?store=${encodeURIComponent(storeId as string)}`}
          className="tap block bg-paper hover:bg-surface/60"
        >
          {inner}
        </Link>
      </li>
    );
  }
  return <li className="bg-paper">{inner}</li>;
}

function FixtureStatusChip({ fixture }: { fixture: FixtureCompliance }) {
  const verdict = effective(fixture);
  if (fixture.state === 'scored' && verdict) {
    return <CaptureVerdictChip verdict={verdict} size="sm" />;
  }
  if (fixture.state === 'submitted') {
    return (
      <span className="rounded-md bg-surface px-2 py-0.5 text-[11px] font-medium text-steel">
        Scoring…
      </span>
    );
  }
  return (
    <span className="rounded-md bg-surface px-2 py-0.5 text-[11px] font-medium text-steel">
      {fixture.needsPhoto ? 'Photo wanted' : 'Not captured'}
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
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    </div>
  );
}
