import * as React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  ImageOff,
  MinusCircle,
  Sparkles,
  XCircle,
} from 'lucide-react';
import type {
  CaptureVerdict,
  CreateReviewThreadBody,
  ReportDocFixture,
  ReviewThreadDto,
  StoreReportDocument,
} from '@wally/sdk';

import {
  NewThreadComposer,
  PhotoPins,
  PinComposerDialog,
  ThreadList,
  type ThreadActions,
} from './ReviewThreads';

/** Wiring for the review-comment loop; omit to render the plain document. */
export interface ReportReview {
  threads: ReviewThreadDto[];
  /** ADMIN/REVIEWER: can open new threads (incl. photo pins). */
  canCreate: boolean;
  actions: ThreadActions;
  onCreate: (body: Omit<CreateReviewThreadBody, 'storeId' | 'campaignId'>) => void;
}

const VERDICT: Record<
  CaptureVerdict,
  { icon: React.ComponentType<{ className?: string }>; label: string; cls: string }
> = {
  PASS: { icon: CheckCircle2, label: 'Pass', cls: 'text-pass' },
  NEEDS_REVIEW: { icon: HelpCircle, label: 'Review', cls: 'text-gold-deep' },
  FAIL: { icon: XCircle, label: 'Fail', cls: 'text-fail' },
};

const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';

/**
 * The rendered store report — the Myer-style document. Pure presentational; both
 * the manager's read-only view and the admin's report view render it. Header with
 * status / score / AI summary / flags, then every fixture step (photos + verdict
 * + completed-by) and every extra-question answer.
 */
export function ReportDocument({
  doc,
  onRegenerateSummary,
  regenerating,
  review,
}: {
  doc: StoreReportDocument;
  /** Admin-only: regenerate the AI summary. Omit to hide the control. */
  onRegenerateSummary?: () => void;
  regenerating?: boolean;
  review?: ReportReview;
}) {
  return (
    <div className="space-y-5">
      {/* Header */}
      <header className="rounded-xl border border-mist/60 bg-paper p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-brand text-steel">
              {doc.campaign.name} · {doc.campaign.key}
            </p>
            <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight text-ink">
              {doc.store.name}{' '}
              <span className="font-normal text-steel">· {doc.store.brand}</span>
            </h1>
            <p className="mt-1 text-sm text-steel">
              {doc.status === 'SUBMITTED'
                ? `Submitted ${fmt(doc.submittedAt)}${doc.submittedByName ? ` by ${doc.submittedByName}` : ''}`
                : doc.status === 'REOPENED'
                  ? 'Reopened — awaiting re-submission'
                  : 'Draft — not yet submitted'}
            </p>
          </div>
          {doc.totalScore != null ? (
            <div className="shrink-0 text-right">
              <p className="font-display text-3xl font-semibold tracking-tight text-ink">
                {doc.totalScore}%
              </p>
              <p className="text-[11px] uppercase tracking-brand text-steel">
                Total score
              </p>
            </div>
          ) : null}
        </div>

        {/* Flags */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {doc.flags.nonCompliant ? (
            <Flag icon={AlertTriangle} cls="text-fail" label="Non-compliant" />
          ) : null}
          {doc.flags.lowConfidence ? (
            <Flag icon={HelpCircle} cls="text-gold-deep" label="Low confidence" />
          ) : null}
          {doc.flags.incomplete ? (
            <Flag icon={MinusCircle} cls="text-steel" label="Incomplete" />
          ) : null}
          {!doc.flags.nonCompliant && !doc.flags.lowConfidence && !doc.flags.incomplete ? (
            <Flag icon={CheckCircle2} cls="text-pass" label="Clear" />
          ) : null}
        </div>

        {/* AI summary */}
        {doc.aiSummary || onRegenerateSummary ? (
          <div className="mt-4 rounded-lg border border-mist/60 bg-surface/40 p-3.5">
            <div className="mb-1 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-brand text-steel">
                <Sparkles className="h-3.5 w-3.5" /> AI summary
              </p>
              {onRegenerateSummary ? (
                <button
                  type="button"
                  onClick={onRegenerateSummary}
                  disabled={regenerating}
                  className="text-xs font-medium text-graphite hover:text-ink disabled:opacity-50"
                >
                  {regenerating ? 'Generating…' : doc.aiSummary ? 'Regenerate' : 'Generate'}
                </button>
              ) : null}
            </div>
            <p className="text-sm leading-relaxed text-graphite">
              {doc.aiSummary ?? 'No summary yet.'}
            </p>
          </div>
        ) : null}
      </header>

      {/* Fixture (photo) steps */}
      <section>
        <h2 className="mb-2 text-[11px] uppercase tracking-brand text-steel">Photos</h2>
        <div className="space-y-3">
          {doc.fixtures.map((f) => (
            <FixtureBlock key={f.fixtureId} fixture={f} review={review} />
          ))}
          {doc.fixtures.length === 0 ? (
            <p className="text-sm text-steel">No fixtures on this floor plan.</p>
          ) : null}
        </div>
      </section>

      {/* Extra-question answers */}
      {doc.questions.length > 0 ? (
        <section>
          <h2 className="mb-2 text-[11px] uppercase tracking-brand text-steel">
            Questions
          </h2>
          <ul className="divide-y divide-mist/50 overflow-hidden rounded-lg border border-mist/60 bg-paper">
            {doc.questions.map((q) => (
              <li key={q.id} className="px-4 py-3">
                <p className="text-sm font-medium text-ink">{q.label}</p>
                <p className="mt-0.5 text-sm text-graphite">
                  {q.isNA ? (
                    <span className="text-steel">N/A</span>
                  ) : q.type === 'YES_NO' ? (
                    q.valueBool == null ? (
                      <span className="text-steel">—</span>
                    ) : q.valueBool ? (
                      'Yes'
                    ) : (
                      'No'
                    )
                  ) : q.valueText ? (
                    <span className="whitespace-pre-line">{q.valueText}</span>
                  ) : (
                    <span className="text-steel">—</span>
                  )}
                </p>
                {q.answeredByName ? (
                  <p className="mt-0.5 text-[11px] text-steel">
                    {q.answeredByName}
                    {q.answeredAt ? ` · ${fmt(q.answeredAt)}` : ''}
                  </p>
                ) : null}
                {review ? (
                  <>
                    <ThreadList
                      threads={review.threads.filter((t) => t.questionId === q.id)}
                      actions={review.actions}
                    />
                    {review.canCreate ? (
                      <div className="mt-1.5">
                        <NewThreadComposer
                          busy={review.actions.busy}
                          onSubmit={(body) => review.onCreate({ questionId: q.id, body })}
                        />
                      </div>
                    ) : null}
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function FixtureBlock({
  fixture: f,
  review,
}: {
  fixture: ReportDocFixture;
  review?: ReportReview;
}) {
  const meta = f.verdict ? VERDICT[f.verdict] : null;
  const Icon = meta?.icon;
  // Admin pin flow: clicking a photo opens the click-to-pin composer.
  const [pinTarget, setPinTarget] = React.useState<{
    id: string;
    url: string;
    label: string;
  } | null>(null);

  const threads = review
    ? review.threads.filter((t) => t.fixtureId === f.fixtureId)
    : [];
  // Stable pin numbering per fixture: pinned threads in creation order.
  const pinned = threads
    .filter((t) => t.photoId && t.pinX != null && t.pinY != null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const pinNumberOf = (t: ReviewThreadDto) => {
    const i = pinned.findIndex((p) => p.id === t.id);
    return i === -1 ? undefined : i + 1;
  };

  return (
    <div className="rounded-lg border border-mist/60 bg-paper p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{f.label}</p>
        {f.status === 'not_applicable' ? (
          <span className="text-xs text-steel">Not applicable</span>
        ) : meta && Icon ? (
          <span className={`flex items-center gap-1 text-xs font-medium ${meta.cls}`}>
            <Icon className="h-4 w-4" /> {meta.label}
            {f.confidence != null ? (
              <span className="text-steel">· {Math.round(f.confidence * 100)}%</span>
            ) : null}
          </span>
        ) : (
          <span className="text-xs text-steel">No photo</span>
        )}
      </div>

      {f.photos.length > 0 ? (
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {f.photos.map((p, i) => {
            const photoPins = pinned
              .map((t, n) => ({ t, n: n + 1 }))
              .filter(({ t }) => t.photoId === p.id)
              .map(({ t, n }) => ({
                number: n,
                x: t.pinX!,
                y: t.pinY!,
                resolved: t.status === 'RESOLVED',
              }));
            const cell = (
              <>
                {p.url ? (
                  <img src={p.url} alt={`${f.label} ${i + 1}`} className="h-full w-full object-cover" />
                ) : (
                  <span className="grid h-full w-full place-items-center">
                    <ImageOff className="h-4 w-4 text-mist" />
                  </span>
                )}
                <PhotoPins pins={photoPins} />
                {(p.issues?.length ?? 0) > 0 ? (
                  <span className="absolute left-1 top-1 inline-flex items-center gap-0.5 rounded-full bg-signal px-1.5 py-0.5 text-[10px] font-semibold text-paper">
                    <AlertTriangle className="h-2.5 w-2.5" /> {p.issues!.length}
                  </span>
                ) : null}
              </>
            );
            // With create rights, clicking a photo marks a spot on it; otherwise
            // it opens the full image as before.
            return review?.canCreate && p.url ? (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  setPinTarget({ id: p.id, url: p.url!, label: `${f.label} — photo ${i + 1}` })
                }
                title="Click to comment on a spot"
                className="relative block aspect-square cursor-crosshair overflow-hidden rounded-md border border-mist/60 bg-surface"
              >
                {cell}
              </button>
            ) : (
              <a
                key={p.id}
                href={p.url ?? '#'}
                target="_blank"
                rel="noreferrer"
                className="relative block aspect-square overflow-hidden rounded-md border border-mist/60 bg-surface"
              >
                {cell}
              </a>
            );
          })}
        </div>
      ) : null}

      {f.aiNotes ? (
        <p className="mt-2 text-xs leading-snug text-graphite">{f.aiNotes}</p>
      ) : null}

      {f.issues && f.issues.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {f.issues.map((it, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-graphite">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-signal" />
              <span>
                <span className="font-medium text-ink">{it.label}</span>
                {it.fix ? ` — ${it.fix}` : ''}
                {it.severity ? (
                  <span className="ml-1 text-steel">({it.severity})</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {f.checklist && f.checklist.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {f.checklist.map((c) => (
            <li
              key={c.id}
              className="flex items-start gap-1.5 text-xs text-graphite"
            >
              {c.checked ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pass" />
              ) : (
                <MinusCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mist" />
              )}
              <span className={c.checked ? '' : 'text-steel'}>
                {c.label}
                {c.required ? <span className="text-fail"> *</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {f.completedByName ? (
        <p className="mt-2 text-[11px] text-steel">
          ✓ {f.completedByName}
          {f.completedAt ? ` · ${fmt(f.completedAt)}` : ''}
        </p>
      ) : null}

      {review ? (
        <>
          <ThreadList threads={threads} pinNumberOf={pinNumberOf} actions={review.actions} />
          {review.canCreate ? (
            <div className="mt-2">
              <NewThreadComposer
                busy={review.actions.busy}
                onSubmit={(body) => review.onCreate({ fixtureId: f.fixtureId, body })}
              />
            </div>
          ) : null}
          {review.canCreate ? (
            <PinComposerDialog
              photo={pinTarget}
              busy={review.actions.busy}
              onClose={() => setPinTarget(null)}
              onSubmit={(v) => {
                review.onCreate({ fixtureId: f.fixtureId, body: v.body, photoId: v.photoId, pinX: v.pinX, pinY: v.pinY });
                setPinTarget(null);
              }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Flag({
  icon: Icon,
  cls,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  cls: string;
  label: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      <Icon className="h-3 w-3" aria-hidden /> {label}
    </span>
  );
}
