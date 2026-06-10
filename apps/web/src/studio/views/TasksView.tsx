import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ClipboardList,
  FileText,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Send,
  Square,
} from 'lucide-react';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
  cn,
} from '@wally/ui';
import type { CampaignSummary } from '@wally/sdk';

import { api, errorMessage } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { EmptyState, ErrorState } from '../../components/states';
import { useSetStudioTopBar } from '../components/StudioContext';
import { CampaignQuestionsDialog } from './CampaignQuestionsDialog';

const fieldCls =
  'w-full rounded-md border border-mist/70 bg-paper px-3 py-2 text-sm text-ink transition-colors focus:border-graphite focus:outline-none';

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

/** "Runs Feb 6 – Feb 10" / "Starts Feb 6" / "Ends Feb 10" — advisory window. */
function windowLabel(c: CampaignSummary): string {
  if (c.startsAt && c.endsAt) return `${fmtDay(c.startsAt)} – ${fmtDay(c.endsAt)}`;
  if (c.startsAt) return `From ${fmtDay(c.startsAt)}`;
  if (c.endsAt) return `Until ${fmtDay(c.endsAt)}`;
  return '';
}

// The three buckets a task lives in. Each campaign status maps to one.
type Bucket = 'live' | 'draft' | 'done';
const BUCKET_OF: Record<string, Bucket> = {
  ACTIVE: 'live',
  DRAFT: 'draft',
  CLOSED: 'done',
};
const BUCKETS: { key: Bucket; label: string; dot: string }[] = [
  { key: 'live', label: 'Live', dot: 'bg-pass' },
  { key: 'draft', label: 'Draft', dot: 'bg-steel' },
  { key: 'done', label: 'Done', dot: 'bg-graphite' },
];

/**
 * The Tasks hub — the single place an admin builds a job (fixtures + questions),
 * sends it to stores, and watches it get completed. Tasks are grouped by Live /
 * Draft / Done; each card shows what it contains and how far along it is, with
 * one primary action and the rest tucked behind a ⋯ menu.
 */
export function TasksView() {
  const qc = useQueryClient();
  const toast = useToast();
  useSetStudioTopBar({ guideName: 'Tasks', stores: [] });

  const tasksQ = useQuery({
    queryKey: ['studio', 'campaigns'],
    queryFn: () => api.campaigns.list(),
  });

  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<CampaignSummary | null>(null);
  const [questioning, setQuestioning] = React.useState<CampaignSummary | null>(null);
  const [sending, setSending] = React.useState<CampaignSummary | null>(null);

  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: ['studio', 'campaigns'] });

  const lifecycle = {
    activate: useMutation({
      mutationFn: (id: string) => api.campaigns.activate(id),
      onSuccess: (c) => {
        invalidate();
        toast.success(`“${c.key}” is now live`);
      },
      onError: (e) => toast.error(errorMessage(e)),
    }),
    close: useMutation({
      mutationFn: (id: string) => api.campaigns.close(id),
      onSuccess: (c) => {
        invalidate();
        toast.success(`“${c.key}” closed`);
      },
      onError: (e) => toast.error(errorMessage(e)),
    }),
    reopen: useMutation({
      mutationFn: (id: string) => api.campaigns.reopen(id),
      onSuccess: (c) => {
        invalidate();
        toast.success(`“${c.key}” reopened`);
      },
      onError: (e) => toast.error(errorMessage(e)),
    }),
    archive: useMutation({
      mutationFn: (id: string) => api.campaigns.archive(id),
      onSuccess: (c) => {
        invalidate();
        toast.success(`“${c.key}” archived`);
      },
      onError: (e) => toast.error(errorMessage(e)),
    }),
  };
  const busy =
    lifecycle.activate.isPending ||
    lifecycle.close.isPending ||
    lifecycle.reopen.isPending ||
    lifecycle.archive.isPending;

  const tasks = tasksQ.data ?? [];
  const grouped = React.useMemo(() => {
    const m: Record<Bucket, CampaignSummary[]> = { live: [], draft: [], done: [] };
    for (const t of tasks) m[BUCKET_OF[t.status] ?? 'draft'].push(t);
    return m;
  }, [tasks]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-brand text-steel">Admin</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
            Tasks
          </h1>
          <p className="mt-1 text-sm text-steel">
            Build a job, send it to your stores, and track who's done. Each store
            fills it in from their Tasks tab.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setCreating((v) => !v);
          }}
          variant={creating ? 'outline' : undefined}
        >
          {creating ? (
            'Cancel'
          ) : (
            <>
              <Plus className="h-4 w-4" /> New task
            </>
          )}
        </Button>
      </header>

      {creating ? <CreateForm onDone={() => setCreating(false)} /> : null}
      {editing ? (
        <EditForm task={editing} onDone={() => setEditing(null)} />
      ) : null}

      <CampaignQuestionsDialog
        campaign={questioning}
        onClose={() => setQuestioning(null)}
      />
      <SendTaskDialog task={sending} onClose={() => setSending(null)} />

      {tasksQ.isLoading ? (
        <div className="grid h-40 place-items-center">
          <Spinner className="text-2xl text-steel" />
        </div>
      ) : tasksQ.isError ? (
        <ErrorState
          error={tasksQ.error}
          onRetry={() => tasksQ.refetch()}
          title="Couldn't load tasks"
        />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No tasks yet"
          body="Create your first task, add its fixtures and questions, then send it to your stores."
        />
      ) : (
        <div className="space-y-7">
          {BUCKETS.map(({ key, label, dot }) =>
            grouped[key].length > 0 ? (
              <section key={key}>
                <h2 className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-brand text-steel">
                  <span className={cn('h-2 w-2 rounded-full', dot)} aria-hidden />
                  {label}
                  <span className="text-steel/70">({grouped[key].length})</span>
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {grouped[key].map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      bucket={key}
                      busy={busy}
                      onSend={() => setSending(t)}
                      onEdit={() => {
                        setCreating(false);
                        setEditing(t);
                      }}
                      onQuestions={() => setQuestioning(t)}
                      onSetLive={() => lifecycle.activate.mutate(t.id)}
                      onClose={() => lifecycle.close.mutate(t.id)}
                      onReopen={() => lifecycle.reopen.mutate(t.id)}
                      onArchive={() => lifecycle.archive.mutate(t.id)}
                    />
                  ))}
                </div>
              </section>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

function TaskCard({
  task: t,
  bucket,
  busy,
  onSend,
  onEdit,
  onQuestions,
  onSetLive,
  onClose,
  onReopen,
  onArchive,
}: {
  task: CampaignSummary;
  bucket: Bucket;
  busy: boolean;
  onSend: () => void;
  onEdit: () => void;
  onQuestions: () => void;
  onSetLive: () => void;
  onClose: () => void;
  onReopen: () => void;
  onArchive: () => void;
}) {
  const navigate = useNavigate();
  const sent = t.storesSent > 0;
  const pct = sent ? Math.round((t.storesSubmitted / t.storesSent) * 100) : 0;
  const viewSubmissions = () => navigate(`/studio/tasks/${t.id}`);
  const build = () => navigate(`/studio/tasks/${t.id}/build`);

  // The single most-likely next action for this task's state: a fresh draft
  // wants Building (add questions + photo requests), a sent task wants viewing,
  // a live-but-unsent task wants sending.
  const primary =
    bucket === 'done' || (bucket === 'live' && sent)
      ? { label: 'View submissions', icon: FileText, onClick: viewSubmissions }
      : bucket === 'draft'
        ? { label: 'Build', icon: ListChecks, onClick: build }
        : { label: 'Send to stores', icon: Send, onClick: onSend };
  const PrimaryIcon = primary.icon;

  // Everything else lives in the ⋯ menu, in context order.
  const menu: MenuAction[] = [
    ...(bucket !== 'draft'
      ? [{ label: 'Edit content', icon: ListChecks, onClick: build }]
      : []),
    { label: 'Edit details', icon: Pencil, onClick: onEdit },
    { label: 'Questions', icon: ClipboardList, onClick: onQuestions },
    ...(bucket !== 'done' && primary.onClick !== onSend
      ? [
          {
            label: sent ? 'Send to more stores' : 'Send to stores',
            icon: Send,
            onClick: onSend,
          },
        ]
      : []),
    ...(sent ? [{ label: 'View submissions', icon: FileText, onClick: viewSubmissions }] : []),
    ...(bucket === 'draft'
      ? [{ label: 'Set live (no send)', icon: Play, onClick: onSetLive }]
      : []),
    ...(bucket === 'live' ? [{ label: 'Close task', icon: Square, onClick: onClose }] : []),
    ...(bucket === 'done' ? [{ label: 'Reopen', icon: RotateCcw, onClick: onReopen }] : []),
    { label: 'Archive', icon: Archive, onClick: onArchive, danger: true },
  ].filter((a) => a.label !== primary.label);

  return (
    <div className="flex flex-col rounded-xl border border-mist/60 bg-paper p-4 shadow-card">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-[15px] font-semibold text-ink">
            {t.name}
          </h3>
          <p className="truncate text-xs text-steel">
            {t.key}
            {windowLabel(t) ? ` · ${windowLabel(t)}` : ''}
          </p>
        </div>
        <TaskMenu actions={menu} disabled={busy} />
      </div>

      <p className="mt-2 text-xs text-steel">
        {sent ? `${t.storesSent} store${t.storesSent === 1 ? '' : 's'}` : 'Not sent yet'}
        {' · '}
        {t.fixtureCount} fixture{t.fixtureCount === 1 ? '' : 's'}
        {' · '}
        {t.questionCount} question{t.questionCount === 1 ? '' : 's'}
      </p>

      {sent ? (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-graphite">
              {t.storesSubmitted}/{t.storesSent} submitted
            </span>
            <span className="text-steel">{pct}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-mist/40">
            <div
              className="h-full rounded-full bg-pass transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      ) : null}

      <div className="mt-4">
        <Button className="w-full" onClick={primary.onClick} disabled={busy}>
          <PrimaryIcon className="h-4 w-4" /> {primary.label}
        </Button>
      </div>
    </div>
  );
}

interface MenuAction {
  label: string;
  icon: typeof Pencil;
  onClick: () => void;
  danger?: boolean;
}

/** A compact ⋯ popover menu (click-outside / Escape to close). */
function TaskMenu({ actions, disabled }: { actions: MenuAction[]; disabled?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="grid h-8 w-8 place-items-center rounded-md text-steel transition-colors hover:bg-surface hover:text-ink disabled:opacity-50"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open ? (
        <div
          role="menu"
          className="menu-in absolute right-0 top-[calc(100%+4px)] z-30 w-48 overflow-hidden rounded-md border border-mist/70 bg-paper py-1 shadow-lift"
        >
          {actions.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  a.onClick();
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-surface',
                  a.danger ? 'text-fail' : 'text-graphite',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {a.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [key, setKey] = React.useState('');
  const [name, setName] = React.useState('');
  const [startsAt, setStartsAt] = React.useState('');
  const [endsAt, setEndsAt] = React.useState('');

  const create = useMutation({
    mutationFn: () =>
      api.campaigns.create({
        key: key.trim(),
        name: name.trim(),
        ...(startsAt ? { startsAt } : {}),
        ...(endsAt ? { endsAt } : {}),
      }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['studio', 'campaigns'] });
      toast.success(`Task “${c.key}” created`);
      onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim() || !name.trim() || create.isPending) return;
    create.mutate();
  };

  return (
    <form
      onSubmit={submit}
      className="mb-6 space-y-3 rounded-lg border border-mist/60 bg-surface/40 p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-graphite">Key</span>
          <input
            autoFocus
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="MSP2-2026"
            maxLength={40}
            className={fieldCls}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-graphite">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Stocktake Sale P2"
            maxLength={160}
            className={fieldCls}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-graphite">
            Starts <span className="text-steel">(optional)</span>
          </span>
          <input
            type="date"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className={fieldCls}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-graphite">
            Ends <span className="text-steel">(optional)</span>
          </span>
          <input
            type="date"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            className={fieldCls}
          />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!key.trim() || !name.trim() || create.isPending}>
          {create.isPending ? 'Creating…' : 'Create task'}
        </Button>
      </div>
    </form>
  );
}

/** Edit name + window. `key` is immutable, so it's shown read-only. */
function EditForm({ task, onDone }: { task: CampaignSummary; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = React.useState(task.name);
  const [startsAt, setStartsAt] = React.useState(
    task.startsAt ? task.startsAt.slice(0, 10) : '',
  );
  const [endsAt, setEndsAt] = React.useState(task.endsAt ? task.endsAt.slice(0, 10) : '');

  const update = useMutation({
    mutationFn: () =>
      api.campaigns.update(task.id, {
        name: name.trim(),
        startsAt: startsAt ? startsAt : null,
        endsAt: endsAt ? endsAt : null,
      }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['studio', 'campaigns'] });
      toast.success(`Task “${c.key}” updated`);
      onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || update.isPending) return;
    update.mutate();
  };

  return (
    <form
      onSubmit={submit}
      className="mb-6 space-y-3 rounded-lg border border-graphite/40 bg-surface/40 p-4"
    >
      <p className="text-[11px] uppercase tracking-brand text-steel">
        Editing · {task.key}{' '}
        <span className="lowercase tracking-normal text-steel/80">
          (key can't be changed)
        </span>
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-graphite">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={160}
            className={fieldCls}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-graphite">
            Starts <span className="text-steel">(optional)</span>
          </span>
          <input
            type="date"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className={fieldCls}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-graphite">
            Ends <span className="text-steel">(optional)</span>
          </span>
          <input
            type="date"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            className={fieldCls}
          />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!name.trim() || update.isPending}>
          {update.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}

/**
 * Send (assign) a task's report to a chosen set of stores. Sending a DRAFT task
 * also makes it live (one button = "go live + assign") so the stores it's sent
 * to immediately see it in their Tasks.
 */
export function SendTaskDialog({
  task,
  onClose,
}: {
  task: CampaignSummary | null;
  onClose: () => void;
}) {
  const open = task != null;
  const qc = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [storeFilter, setStoreFilter] = React.useState('');
  const [dueAt, setDueAt] = React.useState('');

  // The candidate stores = every store with a floor plan for this task.
  const storesQ = useQuery({
    queryKey: ['studio', 'reports', task?.id],
    queryFn: () => api.reports.list(task!.id),
    enabled: open,
  });
  const stores = storesQ.data ?? [];

  React.useEffect(() => {
    if (open) {
      setStoreFilter('');
      setDueAt('');
    }
  }, [open]);
  // Default to all stores once the candidate list loads.
  React.useEffect(() => {
    if (open && storesQ.data) {
      setSelected(new Set(storesQ.data.map((s) => s.storeId)));
    }
  }, [open, storesQ.data]);

  const filtered = React.useMemo(() => {
    const q = storeFilter.trim().toLowerCase();
    if (!q) return stores;
    return stores.filter((s) =>
      `${s.storeName} ${s.brand} ${s.region ?? ''}`.toLowerCase().includes(q),
    );
  }, [stores, storeFilter]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const send = useMutation({
    mutationFn: async () => {
      // A draft goes live the moment it's sent — assign would otherwise land in
      // a task the stores can't see (only the active task shows in their app).
      if (task!.status === 'DRAFT') await api.campaigns.activate(task!.id);
      return api.reports.send(task!.id, {
        storeIds: [...selected],
        ...(dueAt ? { dueAt: new Date(`${dueAt}T00:00:00`).toISOString() } : {}),
      });
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['studio', 'campaigns'] });
      void qc.invalidateQueries({ queryKey: ['studio', 'reports', task!.id] });
      toast.success(`Sent to ${r.sent} store${r.sent === 1 ? '' : 's'}`);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const isDraft = task?.status === 'DRAFT';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Send to stores</DialogTitle>
          <DialogDescription>
            {isDraft
              ? `Sending makes “${task?.name}” live and assigns it to the chosen stores.`
              : `Assign “${task?.name}” to stores. Each gets it in their Tasks to fill in.`}
          </DialogDescription>
        </DialogHeader>

        {storesQ.isLoading ? (
          <div className="grid h-32 place-items-center">
            <Spinner className="text-2xl text-steel" />
          </div>
        ) : stores.length === 0 ? (
          <p className="rounded-md border border-mist/60 bg-surface/40 px-3 py-4 text-center text-sm text-steel">
            No stores have a floor plan for this task yet. Set up the floor plans
            first, then send.
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-graphite">
                  Stores ({selected.size}/{stores.length})
                </span>
                <div className="flex gap-3 text-xs">
                  <button
                    type="button"
                    className="text-steel transition-colors hover:text-ink"
                    onClick={() => setSelected(new Set(stores.map((s) => s.storeId)))}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="text-steel transition-colors hover:text-ink"
                    onClick={() => setSelected(new Set())}
                  >
                    Clear
                  </button>
                </div>
              </div>
              <input
                value={storeFilter}
                onChange={(e) => setStoreFilter(e.target.value)}
                placeholder="Filter by name, brand, region…"
                className={fieldCls}
              />
              <ul className="mt-2 max-h-56 space-y-0.5 overflow-y-auto rounded-md border border-mist/70 bg-paper p-1">
                {filtered.map((s) => (
                  <li key={s.storeId}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-mist/30">
                      <input
                        type="checkbox"
                        checked={selected.has(s.storeId)}
                        onChange={() => toggle(s.storeId)}
                        className="h-4 w-4 shrink-0 rounded border-mist accent-graphite"
                      />
                      <span className="min-w-0 flex-1 truncate text-ink">
                        {s.storeName}
                      </span>
                      <span className="shrink-0 text-xs text-steel">{s.brand}</span>
                    </label>
                  </li>
                ))}
                {filtered.length === 0 ? (
                  <li className="px-2 py-3 text-center text-xs text-steel">
                    No stores match.
                  </li>
                ) : null}
              </ul>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-graphite">
                Due date (optional)
              </span>
              <input
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className={fieldCls}
              />
            </label>
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button">
              Cancel
            </Button>
          </DialogClose>
          <Button
            onClick={() => send.mutate()}
            disabled={selected.size === 0 || send.isPending || stores.length === 0}
            loading={send.isPending}
          >
            <Send className="h-4 w-4" />
            {isDraft
              ? 'Send & go live'
              : selected.size > 1
                ? `Send to ${selected.size} stores`
                : 'Send'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
