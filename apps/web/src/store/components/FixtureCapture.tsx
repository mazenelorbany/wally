import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  History,
  ImageOff,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  X,
  XCircle,
  ZoomIn,
} from 'lucide-react';
import { Button, Spinner } from '@wally/ui';
import type {
  CaptureAttempt,
  CapturePhoto,
  CaptureVerdict,
  ComplianceIssue,
} from '@wally/sdk';

import { api, errorMessage } from '../../lib/api';
import { useSession } from '../../lib/auth';

// Mirror the API cap (MAX_PHOTOS_PER_FIXTURE) so the UI hides "add" at the limit.
const MAX_PHOTOS_PER_FIXTURE = 6;

/**
 * The fixture capture loop, inlined wherever a manager fills a report: the guide
 * reference, the manager's own photo gallery, the AI verdict from comparing
 * them, the setup instructions, and the per-fixture checklist they tick. This is
 * the loop Jeremy validated — photo vs guide → pass / needs-review / fail.
 *
 * It is fully self-contained (no navigation, no page chrome) so the report stays
 * a single scrollable form: opening a photo field expands this in place rather
 * than routing into the floor map. REVIEWER/ADMIN also get the override controls.
 */
export function FixtureCapture({
  fixtureId,
  storeId,
  campaignId,
}: {
  fixtureId: string;
  storeId?: string;
  campaignId?: string;
}) {
  const { user } = useSession();
  const isReviewer = user?.role === 'REVIEWER' || user?.role === 'ADMIN';
  const qc = useQueryClient();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [zoom, setZoom] = React.useState<ZoomTarget | null>(null);

  const compQ = useQuery({
    queryKey: ['manager', 'fixture-compliance', storeId, fixtureId],
    queryFn: () => api.manager.fixtureCompliance(fixtureId, storeId),
    enabled: Boolean(fixtureId),
  });

  const detailQ = useQuery({
    queryKey: ['manager', 'guide-fixture', campaignId, fixtureId],
    queryFn: () => api.guideFixtures.detail(campaignId!, fixtureId),
    enabled: Boolean(campaignId && fixtureId),
  });

  // Any change to the capture loop invalidates the same set of queries —
  // including the report progress, so the form's step counter updates live.
  const invalidateCapture = () => {
    void qc.invalidateQueries({
      queryKey: ['manager', 'fixture-compliance', storeId, fixtureId],
    });
    void qc.invalidateQueries({ queryKey: ['manager', 'compliance', storeId] });
    void qc.invalidateQueries({ queryKey: ['manager', 'report', storeId] });
    void qc.invalidateQueries({ queryKey: ['manager', 'home', storeId] });
  };

  const upload = useMutation({
    mutationFn: (file: File) =>
      api.manager.uploadFixturePhoto(fixtureId, file, storeId),
    onSuccess: invalidateCapture,
  });

  const removePhoto = useMutation({
    mutationFn: (photoId: string) =>
      api.manager.deleteFixturePhoto(fixtureId, photoId, storeId),
    onSuccess: invalidateCapture,
  });

  // Tick/untick a checklist item while filling the report.
  const tick = useMutation({
    mutationFn: (v: { itemId: string; checked: boolean }) =>
      api.manager.tickChecklist(fixtureId, v.itemId, v.checked, storeId),
    onSuccess: invalidateCapture,
  });

  // REVIEWER/ADMIN: re-request a photo ("redo this").
  const requestPhoto = useMutation({
    mutationFn: () => api.manager.requestCapturePhoto(fixtureId, storeId),
    onSuccess: invalidateCapture,
  });

  // REVIEWER/ADMIN: override the AI verdict with a human decision.
  const override = useMutation({
    mutationFn: (body: { verdict: CaptureVerdict; note?: string }) =>
      api.manager.overrideCapture(fixtureId, body, storeId),
    onSuccess: invalidateCapture,
  });

  if (compQ.isLoading) {
    return (
      <div className="grid h-32 place-items-center">
        <Spinner className="text-xl text-steel" />
      </div>
    );
  }
  const c = compQ.data;
  const d = detailQ.data;

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) upload.mutate(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-5">
      {/* Compliance: reference + notes + my photo gallery + verdict */}
      <section className="space-y-3">
        <Frame label="Guide reference">
          {c?.referenceUrl ? (
            <ZoomableImage src={c.referenceUrl} label="Guide reference" onZoom={setZoom} />
          ) : (
            <Placeholder text="No reference" />
          )}
        </Frame>

        {/* Your photos — a fixture step can hold several angles of one display. */}
        <YourPhotos
          photos={c?.photos ?? []}
          onZoom={setZoom}
          onRemove={(id) => removePhoto.mutate(id)}
          removingId={
            removePhoto.isPending ? (removePhoto.variables as string) : null
          }
        />
        {removePhoto.isError ? (
          <p className="text-center text-sm text-fail">
            {errorMessage(removePhoto.error)}
          </p>
        ) : null}

        {/* Setup instructions — ordered steps from the guide. */}
        {d?.instructions && d.instructions.length > 0 ? (
          <div className="rounded-lg border border-mist/60 bg-surface/40 p-3.5">
            <p className="mb-1.5 text-[11px] uppercase tracking-brand text-steel">
              Instructions
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed text-graphite">
              {d.instructions.map((s) => (
                <li key={s.id}>{s.text}</li>
              ))}
            </ol>
          </div>
        ) : null}

        {/* Checklist — the manager ticks these as part of the report. */}
        {c?.checklist && c.checklist.length > 0 ? (
          <div className="rounded-lg border border-mist/60 bg-paper p-3.5">
            <p className="mb-1.5 text-[11px] uppercase tracking-brand text-steel">
              Checklist
            </p>
            <ul className="space-y-1.5">
              {c.checklist.map((item) => (
                <li key={item.id}>
                  <label className="flex cursor-pointer items-start gap-2.5 text-sm text-graphite">
                    <input
                      type="checkbox"
                      checked={item.checked}
                      disabled={tick.isPending}
                      onChange={(e) =>
                        tick.mutate({ itemId: item.id, checked: e.target.checked })
                      }
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-mist accent-graphite"
                    />
                    <span className={item.checked ? 'text-steel line-through' : ''}>
                      {item.label}
                      {item.required ? <span className="text-fail"> *</span> : null}
                      {item.aiTicked ? (
                        <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-surface px-1.5 py-0.5 align-middle text-[10px] font-medium text-steel no-underline">
                          <Sparkles className="h-3 w-3" /> AI
                          {typeof item.aiConfidence === 'number'
                            ? ` · ${Math.round(item.aiConfidence * 100)}%`
                            : ''}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {c?.notes ? (
          <div className="rounded-lg border border-mist/60 bg-surface/40 p-3.5">
            <p className="mb-1 text-[11px] uppercase tracking-brand text-steel">
              VM notes
            </p>
            <p className="whitespace-pre-line text-sm leading-relaxed text-graphite">
              {c.notes}
            </p>
          </div>
        ) : !c?.referenceUrl ? (
          // Neither a reference image nor written notes were published for this
          // fixture — be honest about it instead of showing two blank boxes, and
          // tell the manager they can still submit a photo for review.
          <div className="rounded-lg border border-dashed border-mist/70 bg-surface/30 p-3.5 text-sm text-steel">
            Head office hasn't published a guide for this fixture yet. Set it up
            using your usual standard, then submit a photo for review.
          </div>
        ) : null}

        {/* A reviewer's re-shoot request — shown above the verdict as the ask. */}
        {c?.needsPhoto && c?.requestedByName ? (
          <div className="flex items-start gap-2 rounded-lg border border-signal/40 bg-signal/5 px-4 py-3 text-sm text-graphite">
            <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
            <span>
              <span className="font-medium text-signal">New photo requested</span> by{' '}
              {c.requestedByName}
              {c.requestedAt ? ` · ${fmtWhen(c.requestedAt)}` : ''} — please re-shoot
              this fixture.
            </span>
          </div>
        ) : null}

        {/* Verdict / progress — EFFECTIVE verdict (a reviewer override beats the AI). */}
        {upload.isPending ? (
          <div className="flex items-center gap-2 rounded-lg border border-mist/60 bg-paper px-4 py-3 text-sm text-graphite">
            <Spinner className="text-base" /> Comparing your photo to the guide…
          </div>
        ) : c?.effectiveVerdict ?? c?.overall ? (
          <VerdictCard
            overall={(c?.effectiveVerdict ?? c?.overall) as CaptureVerdict}
            notes={c?.overrideVerdict ? c?.overrideNote : c?.aiNotes}
            confidence={c?.overrideVerdict ? null : c?.confidence}
            override={
              c?.overrideVerdict
                ? { by: c.reviewedByName, when: c.reviewedAt, aiWas: c.overall }
                : null
            }
          />
        ) : c?.state === 'submitted' ? (
          <div className="rounded-lg border border-mist/60 bg-paper px-4 py-3 text-sm text-steel">
            Photo received — scoring shortly.
          </div>
        ) : null}

        {/* AI-flagged issues, numbered to match the boxes on each photo. */}
        {!upload.isPending && c?.issues && c.issues.length > 0 ? (
          <IssueList issues={c.issues} photos={c?.photos ?? []} onOpen={setZoom} />
        ) : null}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onPick}
          className="hidden"
        />
        {(c?.photos?.length ?? 0) >= MAX_PHOTOS_PER_FIXTURE ? (
          <p className="text-center text-sm text-steel">
            Maximum {MAX_PHOTOS_PER_FIXTURE} photos — remove one to add another.
          </p>
        ) : (
          <Button
            className="w-full"
            size="lg"
            onClick={() => fileRef.current?.click()}
            loading={upload.isPending}
          >
            <Camera className="h-4 w-4" />
            {(c?.photos?.length ?? 0) > 0 ? 'Add a photo' : 'Take / upload photo'}
          </Button>
        )}
        {upload.isError ? (
          <p className="text-center text-sm text-fail">{errorMessage(upload.error)}</p>
        ) : null}

        {/* REVIEWER / ADMIN: request a re-shoot + override the verdict. */}
        {isReviewer ? (
          <ReviewerControls
            hasPhoto={Boolean(c?.myPhotoUrl)}
            onRequestPhoto={() => requestPhoto.mutate()}
            requesting={requestPhoto.isPending}
            requestError={
              requestPhoto.isError ? errorMessage(requestPhoto.error) : null
            }
            onOverride={(verdict, note) => override.mutate({ verdict, note })}
            overriding={override.isPending}
            overrideError={override.isError ? errorMessage(override.error) : null}
            current={c?.overrideVerdict ?? null}
          />
        ) : null}
      </section>

      {/* Capture history — reviewers/admins only. The store manager just fills in
          and submits the report; the per-shot history is noise for them. */}
      {isReviewer && c?.attempts && c.attempts.length > 0 ? (
        <CaptureHistory attempts={c.attempts} onZoom={setZoom} />
      ) : null}

      {/* Products on this fixture */}
      {d && d.merchandise.length > 0 ? (
        <section>
          <h2 className="mb-2 text-[11px] uppercase tracking-brand text-steel">
            Products on this fixture
          </h2>
          <div className="space-y-4">
            {d.merchandise.map((row) => (
              <div key={row.row}>
                {row.row ? (
                  <p className="mb-1.5 text-xs font-medium text-graphite">{row.row}</p>
                ) : null}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {row.products.map((p) => (
                    <div
                      key={p.id}
                      className="overflow-hidden rounded-lg border border-mist/60 bg-paper"
                    >
                      <div className="grid aspect-square place-items-center bg-surface">
                        {p.imageUrl ? (
                          <img src={p.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <ImageOff className="h-5 w-5 text-mist" />
                        )}
                      </div>
                      <div className="px-2 py-1.5">
                        <p className="truncate text-xs font-medium text-ink">{p.name}</p>
                        {p.brand ? (
                          <p className="truncate text-[11px] text-steel">{p.brand}</p>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <Lightbox image={zoom} onClose={() => setZoom(null)} />
    </div>
  );
}

/** A full-screen image opened from the capture loop (guide ref / photo / history). */
type ZoomTarget = { url: string; label: string; issues?: ComplianceIssue[] | null };

/** Issues that carry a usable on-image box. */
const withBoxes = (issues?: ComplianceIssue[] | null) =>
  (issues ?? []).filter((it) => it.box && it.box.w > 0 && it.box.h > 0);

/** Thumbnail that opens its image full-screen on click, with a hover affordance.
 *  Shows a small badge when the AI flagged issues on this image. */
function ZoomableImage({
  src,
  label,
  issues,
  onZoom,
}: {
  src: string;
  label: string;
  issues?: ComplianceIssue[] | null;
  onZoom: (t: ZoomTarget) => void;
}) {
  const count = (issues ?? []).length;
  return (
    <button
      type="button"
      onClick={() => onZoom({ url: src, label, issues })}
      aria-label={`View ${label} larger${count ? ` — ${count} issue${count === 1 ? '' : 's'}` : ''}`}
      className="group relative block h-full w-full cursor-zoom-in"
    >
      <img src={src} alt="" className="h-full w-full object-cover" />
      {count > 0 ? (
        <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-signal px-2 py-0.5 text-[10px] font-semibold text-paper shadow-sm">
          <AlertTriangle className="h-3 w-3" /> {count}
        </span>
      ) : null}
      <span className="pointer-events-none absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-ink/55 text-paper opacity-0 transition-opacity duration-base group-hover:opacity-100">
        <ZoomIn className="h-4 w-4" />
      </span>
    </button>
  );
}

/**
 * Full-screen lightbox. Shows the image at object-contain (the whole frame, not
 * the cropped thumbnail) so a manager/reviewer can read shelf detail, and draws
 * the AI's defect boxes ON the photo (numbered, in the stop colour). Closes on
 * backdrop click, the X, or Escape; locks body scroll while open.
 */
function Lightbox({
  image,
  onClose,
}: {
  image: ZoomTarget | null;
  onClose: () => void;
}) {
  React.useEffect(() => {
    if (!image) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [image, onClose]);

  if (!image) return null;
  const boxed = withBoxes(image.issues);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.label}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/85 p-4 backdrop-blur-sm"
    >
      <div className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-3">
        <span className="text-[11px] uppercase tracking-brand text-paper/70">
          {image.label}
          {boxed.length ? ` · ${boxed.length} flagged` : ''}
        </span>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full bg-paper/15 text-paper transition-colors hover:bg-paper/25"
      >
        <X className="h-5 w-5" />
      </button>
      {/* inline-block wrapper shrink-wraps the contained image, so % box coords
          land on the image itself (not the letterboxed container). */}
      <div
        className="relative inline-block"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={image.url}
          alt={image.label}
          className="block max-h-[88vh] max-w-[94vw] rounded-lg object-contain shadow-lift"
        />
        {boxed.map((it, i) => (
          <span
            key={i}
            className="pointer-events-none absolute rounded-sm border-2 border-signal shadow-[0_0_0_2px_rgba(0,0,0,0.35)]"
            style={{
              left: `${it.box!.x * 100}%`,
              top: `${it.box!.y * 100}%`,
              width: `${it.box!.w * 100}%`,
              height: `${it.box!.h * 100}%`,
            }}
          >
            <span className="absolute -left-0.5 -top-5 inline-flex items-center gap-1 rounded bg-signal px-1.5 py-0.5 text-[10px] font-semibold leading-none text-paper">
              {i + 1} {it.label}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The AI's defect list under the verdict — numbered to match the boxes drawn on
 * the photo. Tapping one opens the photo full-screen with the boxes highlighted.
 */
function IssueList({
  issues,
  photos,
  onOpen,
}: {
  issues: ComplianceIssue[];
  photos: CapturePhoto[];
  onOpen: (t: ZoomTarget) => void;
}) {
  if (issues.length === 0) return null;
  const multi = photos.length > 1;
  return (
    <ul className="space-y-1.5">
      {issues.map((it, i) => {
        // Each issue points at the photo it was found on (photoIndex).
        const idx = it.photoIndex ?? 0;
        const target = photos[idx] ?? photos[0];
        const targetUrl = target?.url ?? null;
        return (
        <li key={i}>
          <button
            type="button"
            disabled={!targetUrl}
            onClick={() =>
              targetUrl &&
              onOpen({
                url: targetUrl,
                label: multi ? `Your photo ${idx + 1}` : 'Your photo',
                issues: target?.issues ?? [it],
              })
            }
            className="flex w-full items-start gap-2.5 rounded-lg border border-mist/60 bg-paper px-3 py-2 text-left transition-colors enabled:hover:bg-surface/60 disabled:cursor-default"
          >
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-signal text-[11px] font-semibold text-paper">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="text-sm font-medium text-ink">{it.label}</span>
                {it.severity ? (
                  <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-tight text-steel">
                    {it.severity}
                  </span>
                ) : null}
              </span>
              {it.fix ? (
                <span className="mt-0.5 block text-xs leading-snug text-graphite">{it.fix}</span>
              ) : null}
            </span>
            {targetUrl ? <ZoomIn className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mist" /> : null}
          </button>
        </li>
        );
      })}
    </ul>
  );
}

/**
 * The manager's photo gallery for a fixture — several angles of one display.
 * Each tile opens full-screen (with its own AI boxes) and carries a remove (X).
 */
function YourPhotos({
  photos,
  onZoom,
  onRemove,
  removingId,
}: {
  photos: CapturePhoto[];
  onZoom: (t: ZoomTarget) => void;
  onRemove: (photoId: string) => void;
  removingId: string | null;
}) {
  const multi = photos.length > 1;
  return (
    <div>
      <p className="mb-1.5 text-[11px] uppercase tracking-brand text-steel">
        Your photos{photos.length ? ` (${photos.length})` : ''}
      </p>
      {photos.length === 0 ? (
        <div className="grid aspect-[4/3] max-w-[220px] place-items-center rounded-lg border border-dashed border-mist/70 bg-surface/40">
          <span className="flex flex-col items-center gap-1 text-sm text-steel">
            <Camera className="h-5 w-5 text-mist" /> No photos yet
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((p, i) => (
            <figure
              key={p.id}
              className="relative overflow-hidden rounded-lg border border-mist/60 bg-surface"
            >
              <div className="relative aspect-square">
                {p.url ? (
                  <ZoomableImage
                    src={p.url}
                    label={multi ? `Your photo ${i + 1}` : 'Your photo'}
                    issues={p.issues}
                    onZoom={onZoom}
                  />
                ) : (
                  <Placeholder text="Unavailable" />
                )}
                <button
                  type="button"
                  onClick={() => onRemove(p.id)}
                  disabled={removingId === p.id}
                  aria-label={`Remove photo ${i + 1}`}
                  className="absolute right-1 top-1 z-10 grid h-6 w-6 place-items-center rounded-full bg-ink/55 text-paper transition-colors hover:bg-fail disabled:opacity-50"
                >
                  {removingId === p.id ? (
                    <Spinner className="text-xs" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

function Frame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <figure className="overflow-hidden rounded-lg border border-mist/60 bg-surface">
      <div className="relative aspect-[4/3]">{children}</div>
      <figcaption className="border-t border-mist/50 px-2.5 py-1.5 text-[11px] uppercase tracking-brand text-steel">
        {label}
      </figcaption>
    </figure>
  );
}

function Placeholder({ text, icon }: { text: string; icon?: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center bg-surface">
      <div className="text-center">
        {icon ?? <ImageOff className="mx-auto h-5 w-5 text-mist" />}
        <p className="mt-1 text-[11px] text-mist">{text}</p>
      </div>
    </div>
  );
}

/** Icon + label + colour for a verdict — colour-blind safe (never colour alone). */
const VERDICT_META: Record<
  CaptureVerdict,
  { icon: typeof CheckCircle2; label: string; cls: string }
> = {
  PASS: { icon: CheckCircle2, label: 'Pass', cls: 'border-pass/40 bg-pass/5 text-pass' },
  NEEDS_REVIEW: {
    icon: AlertTriangle,
    label: 'Needs review',
    cls: 'border-mist bg-surface text-graphite',
  },
  FAIL: { icon: XCircle, label: 'Fail', cls: 'border-signal/40 bg-signal/5 text-signal' },
};

/** A short human date for stamps ("Jun 6, 2:14 PM"). */
function fmtWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** Colour-blind safe: icon + word + the red accent the CEO can see. */
function VerdictCard({
  overall,
  notes,
  confidence,
  override,
}: {
  overall: CaptureVerdict;
  notes?: string | null;
  confidence?: number | null;
  /** Set when a reviewer's human decision is the effective verdict. */
  override?: { by?: string | null; when?: string | null; aiWas?: CaptureVerdict | null } | null;
}) {
  const meta = VERDICT_META[overall];
  const Icon = meta.icon;
  return (
    <div className={`rounded-xl border p-4 ${meta.cls}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5" />
        <span className="font-display text-base font-semibold">{meta.label}</span>
        {override ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-ink/10 px-2 py-0.5 text-[11px] font-medium text-ink">
            <ShieldCheck className="h-3 w-3" /> Reviewer override
          </span>
        ) : null}
        {!override && typeof confidence === 'number' ? (
          <span className="ml-auto text-xs opacity-70">
            {Math.round(confidence * 100)}% confidence
          </span>
        ) : null}
      </div>
      {override ? (
        <p className="mt-1 text-xs text-steel">
          Set by {override.by ?? 'a reviewer'}
          {override.when ? ` · ${fmtWhen(override.when)}` : ''}
          {override.aiWas ? ` · AI said ${VERDICT_META[override.aiWas].label}` : ''}
        </p>
      ) : null}
      {notes ? <p className="mt-2 text-sm leading-relaxed text-graphite">{notes}</p> : null}
    </div>
  );
}

/** The capture history: every preserved shot, newest first (thumb + verdict + when). */
function CaptureHistory({
  attempts,
  onZoom,
}: {
  attempts: CaptureAttempt[];
  onZoom: (t: ZoomTarget) => void;
}) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-brand text-steel">
        <History className="h-3.5 w-3.5" /> Capture history
      </h2>
      <ol className="divide-y divide-mist/40 overflow-hidden rounded-xl border border-mist/60 bg-paper">
        {attempts.map((a, i) => {
          const meta = a.verdict ? VERDICT_META[a.verdict] : null;
          const Icon = meta?.icon;
          return (
            <li key={a.id} className="flex items-start gap-3 px-3 py-2.5">
              {a.photoUrl ? (
                <button
                  type="button"
                  onClick={() =>
                    onZoom({
                      url: a.photoUrl!,
                      label: `Capture · ${fmtWhen(a.capturedAt)}`,
                      issues: a.issues,
                    })
                  }
                  aria-label="View this capture larger"
                  className="grid h-12 w-12 shrink-0 cursor-zoom-in place-items-center overflow-hidden rounded-md bg-surface"
                >
                  <img src={a.photoUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                </button>
              ) : (
                <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md bg-surface">
                  <ImageOff className="h-4 w-4 text-mist" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {Icon && meta ? (
                    <span
                      className={`inline-flex items-center gap-1 text-sm font-medium ${meta.cls.split(' ').find((cl) => cl.startsWith('text-')) ?? 'text-graphite'}`}
                    >
                      <Icon className="h-4 w-4" />
                      {meta.label}
                    </span>
                  ) : (
                    <span className="text-sm text-steel">Not scored</span>
                  )}
                  {i === 0 ? (
                    <span className="rounded-full bg-ink/10 px-1.5 py-0.5 text-[10px] font-medium text-ink">
                      Current
                    </span>
                  ) : null}
                </div>
                <p className="truncate text-xs text-steel">
                  {fmtWhen(a.capturedAt)}
                  {a.capturedByName ? ` · ${a.capturedByName}` : ''}
                  {typeof a.confidence === 'number'
                    ? ` · ${Math.round(a.confidence * 100)}%`
                    : ''}
                </p>
                {a.aiNotes ? (
                  <p className="mt-1 text-xs leading-snug text-graphite">{a.aiNotes}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** REVIEWER/ADMIN controls: re-request a photo + override the AI verdict. */
function ReviewerControls({
  hasPhoto,
  onRequestPhoto,
  requesting,
  requestError,
  onOverride,
  overriding,
  overrideError,
  current,
}: {
  hasPhoto: boolean;
  onRequestPhoto: () => void;
  requesting: boolean;
  requestError: string | null;
  onOverride: (verdict: CaptureVerdict, note?: string) => void;
  overriding: boolean;
  overrideError: string | null;
  current: CaptureVerdict | null;
}) {
  const [pick, setPick] = React.useState<CaptureVerdict | null>(current);
  const [note, setNote] = React.useState('');
  const verdicts: CaptureVerdict[] = ['PASS', 'NEEDS_REVIEW', 'FAIL'];

  return (
    <div className="space-y-3 rounded-xl border border-ink/15 bg-surface/40 p-3.5">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-brand text-steel">
        <ShieldCheck className="h-3.5 w-3.5" /> Reviewer
      </p>

      <div>
        <Button
          variant="secondary"
          className="w-full"
          onClick={onRequestPhoto}
          loading={requesting}
        >
          <RotateCcw className="h-4 w-4" />
          {hasPhoto ? 'Request new photo' : 'Request a photo'}
        </Button>
        {requestError ? (
          <p className="mt-1 text-center text-xs text-fail">{requestError}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-graphite">Override verdict</p>
        <div className="grid grid-cols-3 gap-1.5">
          {verdicts.map((v) => {
            const meta = VERDICT_META[v];
            const Icon = meta.icon;
            const active = pick === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => setPick(v)}
                className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[11px] font-medium transition ${
                  active ? `${meta.cls} ring-2 ring-ink/20` : 'border-mist/60 bg-paper text-steel hover:bg-surface/60'
                }`}
                aria-pressed={active}
              >
                <Icon className="h-4 w-4" />
                {meta.label}
              </button>
            );
          })}
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note (why)…"
          rows={2}
          className="w-full resize-none rounded-lg border border-mist/60 bg-paper px-3 py-2 text-sm text-ink placeholder:text-mist focus:border-ink/30 focus:outline-none"
        />
        <Button
          className="w-full"
          disabled={!pick}
          loading={overriding}
          onClick={() => pick && onOverride(pick, note.trim() || undefined)}
        >
          Apply override
        </Button>
        {overrideError ? (
          <p className="text-center text-xs text-fail">{overrideError}</p>
        ) : null}
      </div>
    </div>
  );
}
