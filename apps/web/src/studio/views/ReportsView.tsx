import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  HelpCircle,
  MinusCircle,
} from 'lucide-react';
import { Badge, Spinner } from '@wally/ui';
import type { StoreReportSummaryDto } from '@wally/sdk';

import { api } from '../../lib/api';
import { EmptyState, ErrorState } from '../../components/states';
import { useSetStudioTopBar } from '../components/StudioContext';

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Live',
  DRAFT: 'Draft',
  CLOSED: 'Done',
};

type FilterKey = 'all' | 'flagged' | 'nonCompliant' | 'lowConfidence' | 'incomplete';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'flagged', label: 'Flagged' },
  { key: 'nonCompliant', label: 'Non-compliant' },
  { key: 'lowConfidence', label: 'Low confidence' },
  { key: 'incomplete', label: 'Incomplete' },
];

/** Severity for flagged-first sort — lower sorts first. */
function attentionRank(r: StoreReportSummaryDto): number {
  if (r.flags.nonCompliant) return 0;
  if (r.flags.lowConfidence) return 1;
  if (r.flags.incomplete) return 2;
  return 3;
}

/**
 * A task's submissions — every store's report for one task, flagged for
 * non-compliant fixtures, low-confidence photos, and incomplete reports. Reached
 * from a Task card's "View submissions"; sending is done back on the Tasks hub.
 */
export function ReportsView() {
  const { campaignId: paramId } = useParams();
  const campaignsQ = useQuery({
    queryKey: ['studio', 'campaigns'],
    queryFn: () => api.campaigns.list(),
  });
  // Scoped to the task in the URL; falls back to the active task for the bare
  // /studio/reports entry (kept so old links don't 404).
  const campaign =
    (paramId ? campaignsQ.data?.find((c) => c.id === paramId) : undefined) ??
    campaignsQ.data?.find((c) => c.status === 'ACTIVE') ??
    campaignsQ.data?.[0];

  // This view IS the submissions list (the sidebar item that lands here is
  // "Submissions") — labelling the top bar "Tasks" made two modules look
  // interlinked when they aren't.
  useSetStudioTopBar({ guideName: 'Submissions', guideKey: campaign?.key, stores: [] });

  const [filter, setFilter] = React.useState<FilterKey>('all');

  const reportsQ = useQuery({
    queryKey: ['studio', 'reports', campaign?.id],
    queryFn: () => api.reports.list(campaign!.id),
    enabled: Boolean(campaign?.id),
  });

  const rows = React.useMemo(() => {
    const all = reportsQ.data ?? [];
    const filtered = all.filter((r) => {
      switch (filter) {
        case 'flagged':
          return r.flags.nonCompliant || r.flags.lowConfidence || r.flags.incomplete;
        case 'nonCompliant':
          return r.flags.nonCompliant;
        case 'lowConfidence':
          return r.flags.lowConfidence;
        case 'incomplete':
          return r.flags.incomplete;
        default:
          return true;
      }
    });
    return [...filtered].sort(
      (a, b) =>
        attentionRank(a) - attentionRank(b) ||
        (a.totalScore ?? -1) - (b.totalScore ?? -1) ||
        a.storeName.localeCompare(b.storeName),
    );
  }, [reportsQ.data, filter]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <Link
        to="/studio/tasks"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-steel transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> All tasks
      </Link>

      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-brand text-steel">
          Submissions
          {campaign ? ` · ${STATUS_LABEL[campaign.status] ?? campaign.status}` : ''}
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
          {campaign?.name ?? 'Task'}{' '}
          {campaign ? <span className="text-steel">· {campaign.key}</span> : null}
        </h1>
        <p className="mt-1 text-sm text-steel">
          Each store's submission — flagged for non-compliant fixtures,
          low-confidence photos, and incomplete reports.
        </p>
      </header>

      {/* Flag filters */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === f.key
                ? 'bg-graphite text-paper'
                : 'bg-surface text-graphite hover:bg-mist/40'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {campaignsQ.isLoading || reportsQ.isLoading ? (
        <div className="grid h-40 place-items-center">
          <Spinner className="text-2xl text-steel" />
        </div>
      ) : reportsQ.isError ? (
        <ErrorState
          error={reportsQ.error}
          onRetry={() => reportsQ.refetch()}
          title="Couldn't load submissions"
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={filter === 'all' ? 'No stores yet' : 'Nothing matches this filter'}
          body={
            filter === 'all'
              ? 'Stores appear here once they have a floor plan for this task.'
              : 'Try a different filter.'
          }
        />
      ) : (
        <ul className="divide-y divide-mist/50 overflow-hidden rounded-lg border border-mist/60 bg-paper">
          {rows.map((r) => (
            <li key={r.storeId}>
              <Link
                to={`/studio/tasks/${campaign!.id}/${r.storeId}`}
                className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[15px] font-semibold text-ink">
                    {r.storeName}{' '}
                    <span className="font-normal text-steel">· {r.brand}</span>
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={r.status} />
                    {r.flags.nonCompliant ? (
                      <Badge variant="muted" className="text-fail">
                        <AlertTriangle className="h-3 w-3" aria-hidden /> Non-compliant
                      </Badge>
                    ) : null}
                    {r.flags.lowConfidence ? (
                      <Badge variant="muted" className="text-gold-deep">
                        <HelpCircle className="h-3 w-3" aria-hidden /> Low confidence
                      </Badge>
                    ) : null}
                    {r.flags.incomplete ? (
                      <Badge variant="muted" className="text-steel">
                        <MinusCircle className="h-3 w-3" aria-hidden /> Incomplete
                      </Badge>
                    ) : null}
                    {!r.flags.nonCompliant &&
                    !r.flags.lowConfidence &&
                    !r.flags.incomplete ? (
                      <Badge variant="muted" className="text-pass">
                        <CheckCircle2 className="h-3 w-3" aria-hidden /> Clear
                      </Badge>
                    ) : null}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-display text-lg font-semibold text-ink">
                    {r.totalScore != null ? `${r.totalScore}%` : '—'}
                  </span>
                  {r.submittedAt ? (
                    <span className="text-[11px] text-steel">
                      {new Date(r.submittedAt).toLocaleDateString()}
                    </span>
                  ) : null}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-mist" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    DRAFT: { label: 'Draft', cls: 'text-steel' },
    PENDING: { label: 'Pending', cls: 'text-steel' },
    IN_PROGRESS: { label: 'In progress', cls: 'text-gold-deep' },
    SUBMITTED: { label: 'Submitted', cls: 'text-pass' },
    REOPENED: { label: 'Reopened', cls: 'text-signal' },
  };
  const s = map[status] ?? { label: status, cls: 'text-steel' };
  return (
    <Badge variant="muted" className={s.cls}>
      {s.label}
    </Badge>
  );
}
