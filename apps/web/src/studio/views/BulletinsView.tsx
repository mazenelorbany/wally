import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  CircleDashed,
  FileText,
  Megaphone,
  Paperclip,
  Pin,
  PinOff,
  Plus,
  Send,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { Button, Card, Spinner } from '@wally/ui';
import type { BulletinDto } from '@wally/sdk';

import { api, errorMessage } from '../../lib/api';
import { useSetStudioTopBar } from '../components/StudioContext';
import { useProject } from '../ProjectContext';

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : null;

export function BulletinsView() {
  const { project, projectId } = useProject();
  const qc = useQueryClient();
  const [creating, setCreating] = React.useState(false);

  useSetStudioTopBar({ guideName: 'Bulletins', guideKey: project?.campaignKey ?? undefined, stores: [] });

  const bulletinsQ = useQuery({
    queryKey: ['studio', 'bulletins', projectId],
    queryFn: () => api.bulletins.list(projectId!),
    enabled: Boolean(projectId),
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['studio', 'bulletins', projectId] });

  const bulletins = bulletinsQ.data ?? [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-brand text-steel">
            {project?.name ?? 'Project'}
          </p>
          <h1 className="mt-1 flex items-center gap-2 font-display text-2xl font-semibold tracking-tight text-ink">
            <Megaphone className="h-5 w-5 text-graphite" /> Bulletins
          </h1>
          <p className="mt-1 text-sm text-steel">
            The memo that ships with each sale — stores read and acknowledge it.
          </p>
        </div>
        <Button onClick={() => setCreating((v) => !v)} variant={creating ? 'outline' : undefined}>
          {creating ? 'Cancel' : (<><Plus className="h-4 w-4" /> New bulletin</>)}
        </Button>
      </header>

      {creating && projectId ? (
        <NewBulletinForm
          projectId={projectId}
          onDone={() => {
            setCreating(false);
            void invalidate();
          }}
        />
      ) : null}

      {bulletinsQ.isLoading ? (
        <div className="grid h-40 place-items-center">
          <Spinner className="text-2xl text-steel" />
        </div>
      ) : bulletins.length === 0 ? (
        <div className="rounded-xl border border-dashed border-mist/70 bg-surface/40 px-6 py-12 text-center">
          <Megaphone className="mx-auto h-7 w-7 text-mist" />
          <p className="mt-2 text-sm font-medium text-ink">No bulletins yet</p>
          <p className="mt-1 text-xs text-steel">
            Post the sale memo so every store gets the same instructions.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {bulletins.map((b) => (
            <BulletinCard key={b.id} bulletin={b} onChanged={invalidate} />
          ))}
        </div>
      )}
    </div>
  );
}

function BulletinCard({
  bulletin: b,
  onChanged,
}: {
  bulletin: BulletinDto;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [showAcks, setShowAcks] = React.useState(false);

  const patch = useMutation({
    mutationFn: (body: { pinned?: boolean; publish?: boolean }) =>
      api.bulletins.update(b.id, body),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: () => api.bulletins.remove(b.id),
    onSuccess: onChanged,
  });
  const acksQ = useQuery({
    queryKey: ['studio', 'bulletin-acks', b.id],
    queryFn: () => api.bulletins.acks(b.id),
    enabled: showAcks,
  });

  const pct = b.ackTotal > 0 ? Math.round((b.ackCount / b.ackTotal) * 100) : 0;
  const draft = !b.publishedAt;

  return (
    <Card className="overflow-hidden">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {b.pinned ? <Pin className="h-3.5 w-3.5 text-signal" /> : null}
              <h2 className="font-display text-base font-semibold text-ink">{b.title}</h2>
              {draft ? (
                <span className="rounded-full border border-mist/70 bg-surface px-2 py-0.5 text-[10px] font-medium uppercase tracking-brand text-steel">
                  Draft
                </span>
              ) : null}
            </div>
            {(b.startsAt || b.endsAt) ? (
              <p className="mt-0.5 text-xs text-steel">
                {fmtDate(b.startsAt)}
                {b.endsAt ? ` – ${fmtDate(b.endsAt)}` : ''}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <IconAction
              label={b.pinned ? 'Unpin' : 'Pin'}
              onClick={() => patch.mutate({ pinned: !b.pinned })}
            >
              {b.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            </IconAction>
            <IconAction
              label={draft ? 'Publish' : 'Unpublish'}
              onClick={() => patch.mutate({ publish: draft })}
            >
              {draft ? <Send className="h-4 w-4" /> : <CircleDashed className="h-4 w-4" />}
            </IconAction>
            <IconAction
              label="Delete"
              danger
              onClick={() => {
                if (window.confirm('Delete this bulletin?')) remove.mutate();
              }}
            >
              <Trash2 className="h-4 w-4" />
            </IconAction>
          </div>
        </div>

        {b.body ? (
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-graphite">
            {b.body}
          </p>
        ) : null}

        {b.attachmentUrl ? (
          <a
            href={b.attachmentUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-mist/70 bg-surface px-2.5 py-1.5 text-xs font-medium text-graphite hover:border-steel hover:text-ink"
          >
            <FileText className="h-3.5 w-3.5" /> {b.attachmentName ?? 'Attachment'}
          </a>
        ) : null}
      </div>

      {/* Acknowledgement rollup */}
      <button
        type="button"
        onClick={() => setShowAcks((v) => !v)}
        className="flex w-full items-center gap-3 border-t border-mist/50 bg-surface/40 px-5 py-2.5 text-left hover:bg-surface/70"
      >
        <Users className="h-4 w-4 shrink-0 text-steel" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center justify-between text-[11px] text-steel">
            <span>Acknowledged</span>
            <span className="tabular-nums">
              {b.ackCount}/{b.ackTotal}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-mist/40">
            <div className="h-full rounded-full bg-ink" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </button>

      {showAcks ? (
        <div className="border-t border-mist/50 px-5 py-3">
          {acksQ.isLoading ? (
            <Spinner className="text-base text-steel" />
          ) : (
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {(acksQ.data ?? []).map((a) => (
                <li key={a.storeId} className="flex items-center gap-1.5 text-xs">
                  {a.acknowledged ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-pass" />
                  ) : (
                    <CircleDashed className="h-3.5 w-3.5 shrink-0 text-mist" />
                  )}
                  <span className={`truncate ${a.acknowledged ? 'text-ink' : 'text-steel'}`}>
                    {a.storeName}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </Card>
  );
}

function NewBulletinForm({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: () => void;
}) {
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [startsAt, setStartsAt] = React.useState('');
  const [endsAt, setEndsAt] = React.useState('');
  const [pinned, setPinned] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);

  const create = useMutation({
    mutationFn: (publish: boolean) =>
      api.bulletins.create(
        projectId,
        {
          title: title.trim(),
          body: body.trim() || undefined,
          startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
          endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
          pinned,
          publish,
        },
        file ?? undefined,
      ),
    onSuccess: onDone,
  });

  return (
    <Card className="mb-5 p-5">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Bulletin title (e.g. Mid-Season Sale Phase 2 — setup)"
        className="field mb-2.5 font-medium"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        placeholder="What stores need to do — key dates, setup notes, do's and don'ts…"
        className="field mb-2.5 resize-y"
      />
      <div className="mb-2.5 flex flex-wrap items-center gap-3">
        <label className="text-xs text-steel">
          Starts
          <input
            type="date"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className="ml-1.5 rounded-md border border-mist bg-paper px-2 py-1 text-xs text-ink"
          />
        </label>
        <label className="text-xs text-steel">
          Ends
          <input
            type="date"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            className="ml-1.5 rounded-md border border-mist bg-paper px-2 py-1 text-xs text-ink"
          />
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs text-graphite">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          <Pin className="h-3.5 w-3.5" /> Pin
        </label>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-mist bg-paper px-2.5 py-1 text-xs text-graphite hover:border-steel">
          <Paperclip className="h-3.5 w-3.5" />
          {file ? file.name : 'Attach PDF/image'}
          <input
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {file ? (
          <button type="button" onClick={() => setFile(null)} aria-label="Remove file">
            <X className="h-3.5 w-3.5 text-steel hover:text-ink" />
          </button>
        ) : null}
      </div>

      {create.isError ? (
        <p className="mb-2 text-xs text-fail">{errorMessage(create.error)}</p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={!title.trim() || create.isPending}
          onClick={() => create.mutate(false)}
        >
          Save draft
        </Button>
        <Button
          size="sm"
          disabled={!title.trim()}
          loading={create.isPending}
          onClick={() => create.mutate(true)}
        >
          <Send className="h-4 w-4" /> Publish to stores
        </Button>
      </div>
    </Card>
  );
}

function IconAction({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-md text-steel hover:bg-surface ${
        danger ? 'hover:text-signal' : 'hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}
