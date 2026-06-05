import * as React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Camera,
  Check,
  CheckCircle2,
  ClipboardList,
  Receipt,
} from 'lucide-react';
import { Button, Spinner } from '@wally/ui';
import type { TaskDto, TaskKind } from '@wally/sdk';

import { api } from '../../lib/api';
import { useManagerStore } from '../ManagerStoreContext';

const KIND_META: Record<
  TaskKind,
  { icon: React.ComponentType<{ className?: string }>; label: string; to?: string }
> = {
  UPLOAD_PHOTO: { icon: Camera, label: 'Photo upload', to: '/capture' },
  LOG_SALES: { icon: Receipt, label: 'Log sales', to: '/store/sales' },
  GENERAL: { icon: ClipboardList, label: 'Task' },
};

export function TasksView() {
  const { storeId } = useManagerStore();
  const qc = useQueryClient();

  const tasksQ = useQuery({
    queryKey: ['manager', 'tasks', storeId],
    queryFn: () => api.manager.tasks(storeId),
  });

  // Opening the list clears the unread badge.
  const seen = React.useRef(false);
  React.useEffect(() => {
    if (seen.current || !tasksQ.data) return;
    if (tasksQ.data.some((t) => t.status === 'OPEN' && !t.seenAt)) {
      seen.current = true;
      void api.manager.markTasksSeen(storeId).then(() => {
        void qc.invalidateQueries({ queryKey: ['manager', 'home', storeId] });
      });
    }
  }, [tasksQ.data, storeId, qc]);

  const complete = useMutation({
    mutationFn: (id: string) => api.manager.completeTask(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['manager', 'tasks', storeId] });
      void qc.invalidateQueries({ queryKey: ['manager', 'home', storeId] });
    },
  });

  if (tasksQ.isLoading) {
    return (
      <div className="grid h-64 place-items-center">
        <Spinner className="text-2xl text-steel" />
      </div>
    );
  }

  const tasks = tasksQ.data ?? [];
  const open = tasks.filter((t) => t.status === 'OPEN');
  const done = tasks.filter((t) => t.status === 'DONE');

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Tasks
        </h1>
        <p className="mt-0.5 text-sm text-steel">
          What head office has asked your store to do.
        </p>
      </header>

      {open.length === 0 ? (
        <div className="rounded-xl border border-mist/60 bg-surface/40 px-5 py-10 text-center">
          <CheckCircle2 className="mx-auto h-7 w-7 text-pass" />
          <p className="mt-2 text-sm font-medium text-ink">You're all caught up</p>
          <p className="mt-1 text-xs text-steel">No open tasks right now.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {open.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              onComplete={() => complete.mutate(t.id)}
              completing={complete.isPending && complete.variables === t.id}
            />
          ))}
        </div>
      )}

      {done.length > 0 ? (
        <section>
          <h2 className="mb-2 text-[11px] uppercase tracking-brand text-steel">
            Done
          </h2>
          <div className="space-y-2">
            {done.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 rounded-lg border border-mist/40 bg-surface/30 px-3.5 py-2.5"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0 text-pass" />
                <p className="min-w-0 flex-1 truncate text-sm text-steel line-through">
                  {t.title}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function TaskRow({
  task,
  onComplete,
  completing,
}: {
  task: TaskDto;
  onComplete: () => void;
  completing: boolean;
}) {
  const meta = KIND_META[task.kind];
  const Icon = meta.icon;
  return (
    <div className="rounded-xl border border-mist/60 bg-paper p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface text-graphite">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {task.seenAt ? null : (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-signal" />
            )}
            <p className="text-sm font-semibold text-ink">{task.title}</p>
          </div>
          {task.body ? (
            <p className="mt-0.5 text-sm leading-snug text-steel">{task.body}</p>
          ) : null}
          <p className="mt-1 text-[11px] uppercase tracking-brand text-mist">
            {meta.label}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 border-t border-mist/40 pt-3">
        {meta.to ? (
          <Link to={meta.to}>
            <Button variant="outline" size="sm">
              <Icon className="h-4 w-4" />
              {task.kind === 'UPLOAD_PHOTO' ? 'Open capture' : 'Open'}
            </Button>
          </Link>
        ) : null}
        <Button size="sm" onClick={onComplete} loading={completing}>
          <Check className="h-4 w-4" />
          Mark done
        </Button>
      </div>
    </div>
  );
}
