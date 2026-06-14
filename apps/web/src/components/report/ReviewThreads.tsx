import * as React from 'react';
import { CheckCircle2, CornerDownRight, MapPin, MessageSquarePlus, RotateCcw } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogTitle, Spinner, cn } from '@wally/ui';
import type { ReviewThreadDto } from '@wally/sdk';

// =============================================================================
// Review-thread UI primitives — shared by the admin report view (create / pin /
// resolve) and the manager surfaces (read + reply). Pure presentational; the
// caller owns the data and mutations.
// =============================================================================

const fmt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** What a surface is allowed to do with threads. */
export interface ThreadActions {
  canReply: boolean;
  canModerate: boolean;
  busy: boolean;
  onReply: (threadId: string, body: string) => void;
  onResolve: (threadId: string) => void;
  onReopen: (threadId: string) => void;
}

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Head office',
  REVIEWER: 'Reviewer',
  STORE_MANAGER: 'Store',
  VIEWER: 'Viewer',
  SETUP_CREW: 'Crew',
};

/** One conversation: status, comments, reply box, resolve/reopen. */
export function ThreadCard({
  thread,
  pinNumber,
  actions,
}: {
  thread: ReviewThreadDto;
  /** When the thread is pinned to a photo: its marker number on that photo. */
  pinNumber?: number;
  actions: ThreadActions;
}) {
  const [reply, setReply] = React.useState('');
  const resolved = thread.status === 'RESOLVED';

  const send = () => {
    const body = reply.trim();
    if (!body) return;
    actions.onReply(thread.id, body);
    setReply('');
  };

  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        resolved ? 'border-mist/50 bg-surface/40' : 'border-gold/40 bg-gold/5',
      )}
    >
      <div className="mb-1.5 flex items-center gap-2">
        {pinNumber != null ? (
          <span className="grid h-4.5 w-4.5 h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-signal text-[10px] font-bold text-paper">
            {pinNumber}
          </span>
        ) : null}
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-brand',
            resolved ? 'bg-pass/10 text-pass' : 'bg-gold/15 text-gold-deep',
          )}
        >
          {resolved ? 'Resolved' : 'Open'}
        </span>
        {resolved && thread.resolvedByName ? (
          <span className="text-[11px] text-steel">
            by {thread.resolvedByName}
            {thread.resolvedAt ? ` · ${fmt(thread.resolvedAt)}` : ''}
          </span>
        ) : null}
        <span className="flex-1" />
        {actions.canModerate ? (
          resolved ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={actions.busy}
              onClick={() => actions.onReopen(thread.id)}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reopen
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={actions.busy}
              onClick={() => actions.onResolve(thread.id)}
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
            </Button>
          )
        ) : null}
      </div>

      <ul className="space-y-2">
        {thread.comments.map((c) => (
          <li key={c.id} className="text-sm">
            <span className="font-medium text-ink">{c.authorName}</span>
            <span className="ml-1.5 rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-medium text-steel">
              {ROLE_LABEL[c.authorRole] ?? c.authorRole}
            </span>
            <span className="ml-1.5 text-[11px] text-steel">{fmt(c.createdAt)}</span>
            <p className="mt-0.5 whitespace-pre-line leading-snug text-graphite">{c.body}</p>
          </li>
        ))}
      </ul>

      {actions.canReply && !resolved ? (
        <div className="mt-2 flex items-start gap-1.5">
          <CornerDownRight className="mt-2 h-3.5 w-3.5 shrink-0 text-mist" aria-hidden />
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={1}
            placeholder="Reply…"
            className="min-h-[34px] flex-1 resize-y rounded-md border border-mist bg-white px-2.5 py-1.5 text-sm text-ink focus:outline-none"
          />
          <Button size="sm" disabled={!reply.trim() || actions.busy} onClick={send}>
            {actions.busy ? <Spinner className="text-xs" /> : 'Reply'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The thread list for one anchor (a fixture step or a question): open threads
 * expanded, resolved ones behind a count toggle so handled feedback doesn't
 * crowd the live conversation.
 */
export function ThreadList({
  threads,
  pinNumberOf,
  actions,
}: {
  threads: ReviewThreadDto[];
  /** Pin numbering for threads pinned to a photo (per-fixture, stable). */
  pinNumberOf?: (t: ReviewThreadDto) => number | undefined;
  actions: ThreadActions;
}) {
  const [showResolved, setShowResolved] = React.useState(false);
  if (threads.length === 0) return null;
  const open = threads.filter((t) => t.status === 'OPEN');
  const resolved = threads.filter((t) => t.status === 'RESOLVED');

  return (
    <div className="mt-2 space-y-2">
      {open.map((t) => (
        <ThreadCard key={t.id} thread={t} pinNumber={pinNumberOf?.(t)} actions={actions} />
      ))}
      {resolved.length > 0 ? (
        <button
          type="button"
          onClick={() => setShowResolved((v) => !v)}
          className="text-xs font-medium text-steel hover:text-ink"
        >
          {showResolved ? 'Hide' : 'Show'} {resolved.length} resolved comment
          {resolved.length === 1 ? '' : 's'}
        </button>
      ) : null}
      {showResolved
        ? resolved.map((t) => (
            <ThreadCard key={t.id} thread={t} pinNumber={pinNumberOf?.(t)} actions={actions} />
          ))
        : null}
    </div>
  );
}

/** "Comment" affordance + inline composer for an unpinned thread on one anchor. */
export function NewThreadComposer({
  onSubmit,
  busy,
  label = 'Comment',
}: {
  onSubmit: (body: string) => void;
  busy: boolean;
  label?: string;
}) {
  const [openComposer, setOpenComposer] = React.useState(false);
  const [body, setBody] = React.useState('');

  if (!openComposer) {
    return (
      <button
        type="button"
        onClick={() => setOpenComposer(true)}
        className="inline-flex items-center gap-1 text-xs font-medium text-steel transition-colors hover:text-ink"
      >
        <MessageSquarePlus className="h-3.5 w-3.5" /> {label}
      </button>
    );
  }
  return (
    <div className="mt-1.5 flex items-start gap-1.5">
      <textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="What should the store look at?"
        className="flex-1 resize-y rounded-md border border-mist bg-white px-2.5 py-1.5 text-sm text-ink focus:outline-none"
      />
      <div className="flex flex-col gap-1">
        <Button
          size="sm"
          disabled={!body.trim() || busy}
          onClick={() => {
            onSubmit(body.trim());
            setBody('');
            setOpenComposer(false);
          }}
        >
          Send
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpenComposer(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Numbered pin markers overlaying a photo (positions are normalized 0..1). */
export function PhotoPins({
  pins,
}: {
  pins: { number: number; x: number; y: number; resolved: boolean }[];
}) {
  return (
    <>
      {pins.map((p) => (
        <span
          key={p.number}
          style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
          className={cn(
            'absolute z-10 grid h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-paper text-[10px] font-bold text-paper shadow-card',
            p.resolved ? 'bg-pass' : 'bg-signal',
          )}
          aria-label={`Comment pin ${p.number}`}
        >
          {p.number}
        </span>
      ))}
    </>
  );
}

/**
 * Click-to-pin composer: the photo full-size; clicking places the marker, then
 * the comment describes what's wrong at that spot.
 */
export function PinComposerDialog({
  photo,
  onClose,
  onSubmit,
  busy,
}: {
  photo: { id: string; url: string; label: string } | null;
  onClose: () => void;
  onSubmit: (v: { photoId: string; pinX: number; pinY: number; body: string }) => void;
  busy: boolean;
}) {
  const [pin, setPin] = React.useState<{ x: number; y: number } | null>(null);
  const [body, setBody] = React.useState('');
  React.useEffect(() => {
    setPin(null);
    setBody('');
  }, [photo?.id]);

  const place = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPin({
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    });
  };

  return (
    <Dialog open={photo != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogTitle className="flex items-center gap-1.5 text-base">
          <MapPin className="h-4 w-4 text-signal" /> Mark a spot on {photo?.label}
        </DialogTitle>
        <p className="text-xs text-steel">
          Click where the problem is, then describe it for the store.
        </p>
        {photo ? (
          <button
            type="button"
            onClick={place}
            className="relative block w-full cursor-crosshair overflow-hidden rounded-lg border border-mist/60 bg-surface"
            aria-label="Place the pin"
          >
            <img src={photo.url} alt={photo.label} className="w-full object-contain" />
            {pin ? (
              <span
                style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
                className="absolute grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-paper bg-signal shadow-card"
                aria-hidden
              >
                <MapPin className="h-3 w-3 text-paper" />
              </span>
            ) : null}
          </button>
        ) : null}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder={pin ? 'Describe what to fix at the marked spot…' : 'Click the photo to place the pin first'}
          className="w-full resize-y rounded-md border border-mist bg-white px-2.5 py-1.5 text-sm text-ink focus:outline-none"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!pin || !body.trim() || busy}
            onClick={() => {
              if (!pin || !photo) return;
              onSubmit({ photoId: photo.id, pinX: pin.x, pinY: pin.y, body: body.trim() });
            }}
          >
            {busy ? <Spinner className="text-xs" /> : 'Add comment'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
