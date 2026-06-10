import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  ClipboardList,
  Loader,
} from 'lucide-react';
import { Spinner } from '@wally/ui';
import type { ManagerReportListItem, StoreReportStatus } from '@wally/sdk';

import { api } from '../../lib/api';
import { ErrorState } from '../../components/states';
import { useManagerStore } from '../ManagerStoreContext';

const STATUS: Record<
  StoreReportStatus,
  { label: string; cls: string; icon: React.ComponentType<{ className?: string }> }
> = {
  DRAFT: { label: 'Pending', cls: 'text-steel', icon: CircleDashed },
  PENDING: { label: 'Pending', cls: 'text-steel', icon: CircleDashed },
  IN_PROGRESS: { label: 'In progress', cls: 'text-gold-deep', icon: Loader },
  SUBMITTED: { label: 'Completed', cls: 'text-pass', icon: CheckCircle2 },
  REOPENED: { label: 'Reopened', cls: 'text-signal', icon: Loader },
};

const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

/** A manager's reports list — the current campaign's report + past submissions. */
export function TasksView() {
  const { storeId } = useManagerStore();
  const reportsQ = useQuery({
    queryKey: ['manager', 'reports', storeId],
    queryFn: () => api.manager.listReports(storeId),
  });

  if (reportsQ.isLoading) {
    return (
      <div className="grid h-64 place-items-center">
        <Spinner className="text-2xl text-steel" />
      </div>
    );
  }
  if (reportsQ.isError) {
    return (
      <div className="px-4 py-6">
        <ErrorState
          error={reportsQ.error}
          onRetry={() => void reportsQ.refetch()}
          title="Couldn't load your reports"
        />
      </div>
    );
  }

  const items = reportsQ.data ?? [];
  const current = items.filter((r) => r.current);
  const past = items.filter((r) => !r.current);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Reports
        </h1>
        <p className="mt-0.5 text-sm text-steel">
          The reports head office has sent your store to fill in.
        </p>
      </header>

      {items.length === 0 ? (
        <div className="rounded-xl border border-mist/60 bg-surface/40 px-5 py-10 text-center">
          <ClipboardList className="mx-auto h-7 w-7 text-steel" />
          <p className="mt-2 text-sm font-medium text-ink">No reports yet</p>
          <p className="mt-1 text-xs text-steel">
            When head office sends a report, it'll appear here.
          </p>
        </div>
      ) : (
        <>
          <section className="space-y-2.5">
            {current.map((r) => (
              <ReportRow key={r.campaignId} report={r} />
            ))}
          </section>
          {past.length > 0 ? (
            <section>
              <h2 className="mb-2 text-[11px] uppercase tracking-brand text-steel">
                Past reports
              </h2>
              <div className="space-y-2">
                {past.map((r) => (
                  <ReportRow key={r.campaignId} report={r} compact />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function ReportRow({
  report: r,
  compact = false,
}: {
  report: ManagerReportListItem;
  compact?: boolean;
}) {
  const meta = STATUS[r.status] ?? STATUS.PENDING;
  const Icon = meta.icon;
  const submitted = r.status === 'SUBMITTED';
  // Current + not submitted → fill it; otherwise open the read-only document.
  const to = r.current && !submitted ? '/store/report' : '/store/report/document';
  const overdue =
    !submitted && r.dueAt != null && new Date(r.dueAt).getTime() < Date.now();

  return (
    <Link
      to={to}
      className={`flex items-center gap-3 rounded-xl border border-mist/60 bg-paper transition-colors hover:border-steel ${
        compact ? 'px-4 py-3' : 'p-4'
      }`}
    >
      <span className={`shrink-0 ${meta.cls}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">
          {r.campaignName}{' '}
          <span className="font-normal text-steel">· {r.campaignKey}</span>
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className={`text-xs font-medium ${meta.cls}`}>{meta.label}</span>
          {submitted && r.submittedAt ? (
            <span className="text-[11px] text-steel">
              {dayFmt.format(new Date(r.submittedAt))}
            </span>
          ) : r.dueAt ? (
            <span
              className={`inline-flex items-center gap-1 text-[11px] ${
                overdue ? 'text-signal' : 'text-steel'
              }`}
            >
              <CalendarClock className="h-3 w-3" aria-hidden="true" />
              {overdue ? 'Overdue · ' : 'Due '}
              {dayFmt.format(new Date(r.dueAt))}
            </span>
          ) : null}
        </div>
      </div>
      {r.totalScore != null ? (
        <span className="shrink-0 font-display text-base font-semibold text-ink">
          {r.totalScore}%
        </span>
      ) : null}
      <ChevronRight className="h-4 w-4 shrink-0 text-mist" />
    </Link>
  );
}
