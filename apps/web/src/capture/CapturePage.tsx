import * as React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CloudUpload,
  LinkIcon,
  PartyPopper,
} from 'lucide-react';
import { Button, Card, ConfidenceBar } from '@wally/ui';

import { useSubmission } from '../lib/hooks';
import { qk } from '../lib/queryKeys';
import { useQueryClient } from '@tanstack/react-query';
import {
  selectUploadsForSubmission,
  useCaptureQueue,
} from '../lib/captureQueue';
import { ErrorState, Skeleton } from '../components/states';
import { buildSlots, slotProgress, type Slot } from './slots';
import { CaptureSlot } from './CaptureSlot';
import { SlotRail } from './SlotRail';

const LAST_SUBMISSION_KEY = 'wally.lastSubmissionId';

/** Resolve the submission to work against from route/query/last-used. */
function useSubmissionId(): string | undefined {
  const params = useParams();
  const [search] = useSearchParams();
  const fromRoute = params.submissionId;
  const fromQuery = search.get('submission') ?? undefined;
  const id = fromRoute ?? fromQuery ?? undefined;
  React.useEffect(() => {
    if (id) localStorage.setItem(LAST_SUBMISSION_KEY, id);
  }, [id]);
  if (id) return id;
  return localStorage.getItem(LAST_SUBMISSION_KEY) ?? undefined;
}

export function CapturePage() {
  const submissionId = useSubmissionId();

  if (!submissionId) {
    return <ConnectChecklist />;
  }
  return <CaptureFlow submissionId={submissionId} />;
}

/** Entry screen when we don't yet know which submission to capture for. */
function ConnectChecklist() {
  const navigate = useNavigate();
  const [value, setValue] = React.useState('');

  const open = (e: React.FormEvent) => {
    e.preventDefault();
    const id = extractSubmissionId(value.trim());
    if (id) navigate(`/capture/${encodeURIComponent(id)}`);
  };

  return (
    <div className="mx-auto max-w-md pt-6">
      <Card className="p-6 text-center">
        <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-surface text-ink">
          <LinkIcon className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 className="font-display text-lg font-semibold text-ink">
          Open your store checklist
        </h1>
        <p className="mt-1 text-sm text-steel">
          Paste the checklist link from your invite, or its ID, to start capturing.
        </p>
        <form onSubmit={open} className="mt-4 flex flex-col gap-2">
          <input
            className="field text-center"
            placeholder="Checklist link or ID"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
          <Button type="submit" size="lg" className="w-full" disabled={!value.trim()}>
            Open checklist
            <ArrowRight className="h-4 w-4" />
          </Button>
        </form>
      </Card>
    </div>
  );
}

function extractSubmissionId(raw: string): string {
  // Accept a bare id, a `?submission=` URL, or a `/capture/<id>` path.
  try {
    const url = new URL(raw);
    const q = url.searchParams.get('submission');
    if (q) return q;
    const seg = url.pathname.split('/').filter(Boolean).pop();
    if (seg) return seg;
  } catch {
    /* not a URL — fall through */
  }
  return raw;
}

function CaptureFlow({ submissionId }: { submissionId: string }) {
  const qc = useQueryClient();
  const submissionQ = useSubmission(submissionId);

  const items = useCaptureQueue((s) => s.items);
  const enqueue = useCaptureQueue((s) => s.enqueue);
  const retry = useCaptureQueue((s) => s.retry);
  const remove = useCaptureQueue((s) => s.remove);
  const draining = useCaptureQueue((s) => s.draining);

  const queued = React.useMemo(
    () => selectUploadsForSubmission(items, submissionId),
    [items, submissionId],
  );

  // Client-only "don't have it" set + local previews for instant feedback.
  const [skipped, setSkipped] = React.useState<Set<string>>(new Set());
  const [previews, setPreviews] = React.useState<Record<string, string>>({});

  // Once a queued upload lands, refetch the server submission to get the
  // signed URL + (eventually) the score.
  const doneCount = queued.filter((q) => q.status === 'done').length;
  React.useEffect(() => {
    if (doneCount > 0) {
      void qc.invalidateQueries({ queryKey: qk.submission(submissionId) });
    }
  }, [doneCount, qc, submissionId]);

  // Revoke object URLs on unmount to avoid leaking blobs.
  React.useEffect(
    () => () => {
      Object.values(previews).forEach((u) => URL.revokeObjectURL(u));
    },
    [previews],
  );

  const slots = React.useMemo(
    () =>
      buildSlots({
        submission: submissionQ.data,
        // The submission's own photo list defines the checklist keys; the
        // campaign fixture list isn't exposed via the SDK, so empty slots come
        // from photos the API seeded as not_submitted.
        fixtureKeys: submissionQ.data?.photos.map((p) => p.fixtureKey),
        queued,
        skipped,
        previews,
      }),
    [submissionQ.data, queued, skipped, previews],
  );

  const [activeIndex, setActiveIndex] = React.useState(0);
  // Park on the first not-yet-done slot the first time we have slots.
  const settledRef = React.useRef(false);
  React.useEffect(() => {
    if (settledRef.current || slots.length === 0) return;
    const firstTodo = slots.findIndex((s) => s.state === 'todo');
    setActiveIndex(firstTodo === -1 ? 0 : firstTodo);
    settledRef.current = true;
  }, [slots]);

  if (submissionQ.isLoading) return <CaptureSkeleton />;
  if (submissionQ.isError) {
    return (
      <ErrorState
        error={submissionQ.error}
        onRetry={() => submissionQ.refetch()}
        title="Could not open this checklist"
      />
    );
  }

  const submission = submissionQ.data!;
  const { done, total } = slotProgress(slots);
  const active = slots[Math.min(activeIndex, slots.length - 1)] as Slot | undefined;
  // Slots whose photo is still on its way to the server (queued / uploading).
  const stillUploading = slots.filter(
    (s) => s.state === 'queued' || s.state === 'uploading',
  ).length;
  // The manager's hands-on work is done once every slot is captured, skipped,
  // or already landed — even if some uploads are still draining. An `error`
  // slot still needs them (retry / re-take), so it keeps the flow open.
  const handsOnDone =
    total > 0 &&
    slots.every(
      (s) =>
        s.state === 'uploaded' ||
        s.state === 'scored' ||
        s.state === 'skipped' ||
        s.state === 'queued' ||
        s.state === 'uploading',
    );

  const capture = (slot: Slot, file: File) => {
    const url = URL.createObjectURL(file);
    setPreviews((p) => {
      const prev = p[slot.fixtureKey];
      if (prev) URL.revokeObjectURL(prev);
      return { ...p, [slot.fixtureKey]: url };
    });
    setSkipped((s) => {
      if (!s.has(slot.fixtureKey)) return s;
      const next = new Set(s);
      next.delete(slot.fixtureKey);
      return next;
    });
    void enqueue({
      submissionId,
      fixtureKey: slot.fixtureKey,
      blob: file,
      filename: file.name || `${slot.fixtureKey}.jpg`,
    });
  };

  const retake = (slot: Slot) => {
    if (slot.queued) void remove(slot.queued.id);
    setPreviews((p) => {
      const prev = p[slot.fixtureKey];
      if (prev) URL.revokeObjectURL(prev);
      const next = { ...p };
      delete next[slot.fixtureKey];
      return next;
    });
  };

  const skip = (slot: Slot) =>
    setSkipped((s) => new Set(s).add(slot.fixtureKey));
  const unskip = (slot: Slot) =>
    setSkipped((s) => {
      const next = new Set(s);
      next.delete(slot.fixtureKey);
      return next;
    });

  return (
    <div>
      <header className="mb-5">
        <p className="text-[11px] uppercase tracking-brand text-steel">
          {submission.campaignKey}
        </p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <h1 className="font-display text-xl font-semibold tracking-tight text-ink">
            {submission.storeName}
          </h1>
          <div className="flex items-center gap-2 text-sm text-steel">
            {draining ? (
              <CloudUpload className="h-4 w-4 animate-pulse text-graphite" aria-hidden="true" />
            ) : null}
            <span className="tabular-nums">
              {done} of {total} done
            </span>
          </div>
        </div>
        <div className="mt-3">
          <ConfidenceBar
            value={total ? done / total : 0}
            showValue={false}
            label="Checklist progress"
          />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Active slot */}
        <div className="order-2 lg:order-1">
          {handsOnDone ? (
            <DonePanel storeName={submission.storeName} pending={stillUploading} />
          ) : active ? (
            <Card className="p-5 sm:p-6">
              <CaptureSlot
                slot={active}
                index={activeIndex}
                total={total}
                onCapture={(file) => capture(active, file)}
                onRetake={() => retake(active)}
                onSkip={() => skip(active)}
                onUnskip={() => unskip(active)}
                onRetry={() => active.queued && retry(active.queued.id)}
                onRemove={() => retake(active)}
              />

              <div className="mt-6 flex items-center justify-between border-t border-mist/50 pt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={activeIndex === 0}
                  onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={activeIndex >= slots.length - 1}
                  onClick={() => setActiveIndex((i) => Math.min(slots.length - 1, i + 1))}
                >
                  Next fixture
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          ) : (
            <Card className="p-6 text-sm text-steel">
              This checklist has no fixtures yet.
            </Card>
          )}
        </div>

        {/* Checklist rail */}
        <aside className="order-1 lg:order-2">
          <p className="mb-2 text-[11px] uppercase tracking-brand text-steel">Checklist</p>
          <SlotRail slots={slots} activeIndex={activeIndex} onSelect={setActiveIndex} />
        </aside>
      </div>
    </div>
  );
}

function DonePanel({ storeName, pending }: { storeName: string; pending: number }) {
  return (
    <Card className="p-8 text-center">
      <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-pass/10 text-pass">
        {pending > 0 ? (
          <CloudUpload className="h-7 w-7" aria-hidden="true" />
        ) : (
          <PartyPopper className="h-7 w-7" aria-hidden="true" />
        )}
      </span>
      <h2 className="font-display text-xl font-semibold text-ink">
        {pending > 0 ? 'Finishing up…' : 'Checklist complete'}
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-steel">
        {pending > 0 ? (
          <>
            Every fixture for <strong className="text-graphite">{storeName}</strong> is
            captured. {pending} photo{pending === 1 ? '' : 's'} still uploading — leave
            this open and they&apos;ll finish automatically.
          </>
        ) : (
          <>
            Every fixture for <strong className="text-graphite">{storeName}</strong> is in.
            Your reviewer takes it from here — no further action needed.
          </>
        )}
      </p>
      {pending === 0 ? (
        <div className="mt-4 inline-flex items-center gap-1.5 text-sm text-pass">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          All photos uploaded
        </div>
      ) : null}
    </Card>
  );
}

function CaptureSkeleton() {
  return (
    <div>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-2 h-7 w-48" />
      <Skeleton className="mt-4 h-1.5 w-full" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Skeleton className="h-80 w-full rounded-lg" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
