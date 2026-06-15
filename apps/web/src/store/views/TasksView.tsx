import * as React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleDot,
  ClipboardList,
} from 'lucide-react';
import { Spinner, cn } from '@wally/ui';
import type { ManagerReportListItem, StoreReportStatus, TaskDto } from '@wally/sdk';

import { api } from '../../lib/api';
import { ErrorState } from '../../components/states';
import { useManagerStore } from '../ManagerStoreContext';

const STATUS: Record<
  StoreReportStatus,
  { label: string; cls: string; icon: React.ComponentType<{ className?: string }> }
> = {
  DRAFT: { label: 'To do', cls: 'text-steel', icon: Circle },
  PENDING: { label: 'To do', cls: 'text-steel', icon: Circle },
  IN_PROGRESS: { label: 'In progress', cls: 'text-graphite', icon: CircleDot },
  SUBMITTED: { label: 'Done', cls: 'text-pass', icon: CheckCircle2 },
  REOPENED: { label: 'Reopened', cls: 'text-signal', icon: CircleDot },
};

const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

// Every item (to-do notice or report) maps into one of three buckets, so the
// whole tab filters with a single toggle — no separate Tasks/Reports tabs.
type Bucket = 'todo' | 'inprogress' | 'done';
const BUCKET_ORDER: Bucket[] = ['inprogress', 'todo', 'done'];

const FILTERS: { key: Bucket | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'todo', label: 'To do' },
  { key: 'inprogress', label: 'In progress' },
  { key: 'done', label: 'Done' },
];

function reportBucket(status: StoreReportStatus): Bucket {
  if (status === 'SUBMITTED') return 'done';
  if (status === 'IN_PROGRESS' || status === 'REOPENED') return 'inprogress';
  return 'todo';
}

type Item =
  | { kind: 'notice'; bucket: Bucket; notice: TaskDto }
  | {
      kind: 'report';
      bucket: Bucket;
      report: ManagerReportListItem;
      /** The folded companion notice is unread → show the "New" dot. */
      isNew: boolean;
    };

/**
 * The store's single work tab: head-office to-dos AND the reports to fill, one
 * list, filterable by To do / In progress / Done. Opening the page marks the
 * notices seen, which clears the sidebar/top-bar badge.
 */
export function TasksView() {
  const { storeId } = useManagerStore();
  const qc = useQueryClient();
  const [filter, setFilter] = React.useState<Bucket | 'all'>('all');

  const reportsQ = useQuery({
    queryKey: ['manager', 'reports', storeId],
    queryFn: () => api.manager.listReports(storeId),
  });
  const tasksQ = useQuery({
    queryKey: ['manager', 'tasks', storeId],
    queryFn: () => api.manager.tasks(storeId),
  });

  // Opening the page = "I've seen these" → clear MY unseen badge.
  React.useEffect(() => {
    void api.manager.markTasksSeen(storeId).then(() => {
      void qc.invalidateQueries({ queryKey: ['manager', 'home', storeId] });
    });
  }, [storeId, qc]);

  const setNoticeDone = useMutation({
    mutationFn: (v: { taskId: string; done: boolean }) =>
      v.done
        ? api.manager.completeTask(v.taskId, storeId)
        : api.manager.reopenTask(v.taskId, storeId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['manager', 'tasks', storeId] });
      void qc.invalidateQueries({ queryKey: ['manager', 'home', storeId] });
    },
  });

  if (reportsQ.isLoading || tasksQ.isLoading) {
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
          title="Couldn't load your tasks"
        />
      </div>
    );
  }

  // "Report requested" notices accompany a report row — fold each into its
  // report (carrying the unread dot) instead of listing the same work twice.
  const reports = reportsQ.data ?? [];
  const reportCampaigns = new Set(reports.map((r) => r.campaignId));
  const folded = new Map<string, TaskDto>();
  const notices = (tasksQ.data ?? []).filter((t) => {
    if (t.campaignId && reportCampaigns.has(t.campaignId)) {
      folded.set(t.campaignId, t);
      return false;
    }
    return true;
  });

  const items: Item[] = [
    ...notices.map<Item>((t) => ({
      kind: 'notice',
      bucket: t.status === 'DONE' ? 'done' : 'todo',
      notice: t,
    })),
    ...reports.map<Item>((r) => ({
      kind: 'report',
      bucket: reportBucket(r.status),
      report: r,
      isNew:
        r.status !== 'SUBMITTED' && folded.get(r.campaignId)?.seen === false,
    })),
  ].sort(
    (a, b) => BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket),
  );

  const countOf = (key: Bucket | 'all') =>
    key === 'all' ? items.length : items.filter((i) => i.bucket === key).length;
  const visible = filter === 'all' ? items : items.filter((i) => i.bucket === filter);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Tasks
        </h1>
        <p className="mt-0.5 text-sm text-steel">
          Everything head office is asking of your store — to-dos and reports,
          in one place.
        </p>
      </header>

      {/* Status toggle */}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter tasks">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              filter === f.key
                ? 'border-ink bg-ink text-paper'
                : 'border-mist/70 bg-paper text-graphite hover:border-steel',
            )}
          >
            {f.label}
            <span className={cn('ml-1', filter === f.key ? 'text-paper/70' : 'text-steel')}>
              {countOf(f.key)}
            </span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-mist/60 bg-surface/40 px-5 py-10 text-center">
          <ClipboardList className="mx-auto h-7 w-7 text-steel" />
          <p className="mt-2 text-sm font-medium text-ink">
            {items.length === 0 ? 'Nothing here yet' : 'Nothing in this filter'}
          </p>
          <p className="mt-1 text-xs text-steel">
            {items.length === 0
              ? 'New asks and reports from head office land here.'
              : 'Switch filters to see the rest of your work.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((item) =>
            item.kind === 'notice' ? (
              <NoticeRow
                key={`n-${item.notice.id}`}
                notice={item.notice}
                pending={
                  setNoticeDone.isPending &&
                  setNoticeDone.variables?.taskId === item.notice.id
                }
                onToggle={(done) =>
                  setNoticeDone.mutate({ taskId: item.notice.id, done })
                }
              />
            ) : (
              <ReportRow
                key={`r-${item.report.campaignId}`}
                report={item.report}
                isNew={item.isNew}
              />
            ),
          )}
        </ul>
      )}
    </div>
  );
}

/** One to-do notice: complete/reopen toggle + title, body, due date, unread dot. */
function NoticeRow({
  notice: t,
  pending,
  onToggle,
}: {
  notice: TaskDto;
  pending: boolean;
  onToggle: (done: boolean) => void;
}) {
  const done = t.status === 'DONE';
  // Comparing against "now" in render is fine for a due-date label — staleness
  // resolves on the next natural re-render.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const overdue = !done && t.dueAt != null && new Date(t.dueAt).getTime() < now;

  return (
    <li
      className={`flex items-start gap-3 rounded-xl border border-mist/60 p-3.5 ${
        done ? 'bg-surface/50' : 'bg-white shadow-card'
      }`}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center">
        <button
          type="button"
          onClick={() => onToggle(!done)}
          disabled={pending}
          aria-label={done ? `Reopen “${t.title}”` : `Mark “${t.title}” done`}
          className={`grid h-5 w-5 place-items-center rounded-full border transition-colors ${
            done
              ? 'border-pass bg-pass text-paper'
              : 'border-mist text-transparent hover:border-steel'
          }`}
        >
          {pending ? (
            <Spinner className="text-[10px] text-steel" />
          ) : done ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : null}
        </button>
      </span>
      <div className="min-w-0 flex-1 pt-1.5">
        <p
          className={`text-sm font-medium leading-5 ${
            done ? 'text-steel line-through' : 'text-ink'
          }`}
        >
          {t.title}
          {!done && t.seen === false ? (
            <span
              className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-gold align-middle"
              aria-label="New"
            />
          ) : null}
        </p>
        {t.body ? (
          <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-steel">
            {t.body}
          </p>
        ) : null}
        {t.dueAt ? (
          <span
            className={`mt-1 inline-flex items-center gap-1 text-[11px] ${
              overdue ? 'text-signal' : 'text-steel'
            }`}
          >
            <CalendarClock className="h-3 w-3" aria-hidden="true" />
            {overdue ? 'Overdue · ' : 'Due '}
            {dayFmt.format(new Date(t.dueAt))}
          </span>
        ) : null}
      </div>
    </li>
  );
}

function ReportRow({
  report: r,
  isNew,
}: {
  report: ManagerReportListItem;
  isNew: boolean;
}) {
  const meta = STATUS[r.status] ?? STATUS.PENDING;
  const Icon = meta.icon;
  const submitted = r.status === 'SUBMITTED';
  // Not submitted → fill THIS campaign's report; submitted → its read-only document.
  const to = submitted
    ? `/store/report/document/${r.campaignId}`
    : `/store/report/${r.campaignId}`;
  // eslint-disable-next-line react-hooks/purity -- due-date label, see NoticeRow
  const now = Date.now();
  const overdue =
    !submitted && r.dueAt != null && new Date(r.dueAt).getTime() < now;

  return (
    <li>
      <Link
        to={to}
        className="group flex items-center gap-3 rounded-xl border border-mist/60 bg-white p-3.5 shadow-card transition-[border-color,box-shadow] duration-base ease-out hover:border-steel/50 hover:shadow-raised"
      >
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface ${meta.cls}`}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">
            {r.campaignName}{' '}
            <span className="font-normal text-steel">· {r.campaignKey}</span>
            {isNew ? (
              <span
                className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-gold align-middle"
                aria-label="New"
              />
            ) : null}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className={`text-xs font-medium ${meta.cls}`}>
              Report · {meta.label}
            </span>
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
          <span className="shrink-0 font-display text-sm font-semibold tabular-nums text-ink">
            {r.totalScore}%
          </span>
        ) : null}
        <ChevronRight className="h-4 w-4 shrink-0 text-mist transition-colors group-hover:text-steel" />
      </Link>
    </li>
  );
}
