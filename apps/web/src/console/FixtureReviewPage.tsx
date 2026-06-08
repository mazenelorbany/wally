import * as React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, History, ImageOff, RotateCcw, ShieldCheck } from 'lucide-react';
import { Card } from '@wally/ui';

import type {
  CaptureAttempt,
  CaptureVerdict,
  FixtureComplianceDetail,
} from '@wally/sdk';
import {
  useFixtureCompliance,
  useOverrideCapture,
  useRequestCapturePhoto,
} from '../lib/hooks';
import { EmptyState, ErrorState, Skeleton } from '../components/states';
import { CAPTURE_VERDICT_META, CaptureVerdictChip, fmtWhen } from './captureVerdict';
import { ReviewActions } from './ReviewActions';

/**
 * Fixture review — the reviewer's bench, on the FixtureCapture path.
 *
 * One captured photo compared against the guide reference, the AI's single
 * effective verdict (a reviewer override beats the AI) + confidence + notes,
 * the "what good looks like" reference, and the capture history. The reviewer
 * confirms, overrides (PASS / NEEDS_REVIEW / FAIL), or requests a new photo.
 *
 * FixtureCapture has NO per-criterion results (unlike the legacy Verdict), so
 * there is no rubric grid — the verdict + notes are the model.
 *
 * We resolve the fixture through its store (`?store=<storeId>`), since a
 * reviewer reads any store's compliance by passing the storeId.
 */
export function FixtureReviewPage() {
  const { fixtureId } = useParams();
  const [search] = useSearchParams();
  const storeId = search.get('store') ?? undefined;
  const navigate = useNavigate();

  const compQ = useFixtureCompliance(fixtureId, storeId);
  const override = useOverrideCapture(storeId);
  const requestPhoto = useRequestCapturePhoto(storeId);

  const back = (
    <button
      type="button"
      onClick={() => navigate(-1)}
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-steel transition-colors hover:text-graphite"
    >
      <ArrowLeft className="h-4 w-4" />
      Back
    </button>
  );

  if (!storeId || !fixtureId) {
    return (
      <div>
        {back}
        <EmptyState
          icon={ImageOff}
          title="Open this fixture from a store"
          body="Fixture reviews load through their store. Head back to the queue and pick the fixture from a store."
        >
          <Link
            to="/studio/review"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-ink underline-offset-4 hover:underline"
          >
            Go to the queue
          </Link>
        </EmptyState>
      </div>
    );
  }

  if (compQ.isLoading) return <ReviewSkeleton back={back} />;
  if (compQ.isError) {
    return (
      <div>
        {back}
        <ErrorState error={compQ.error} onRetry={() => compQ.refetch()} />
      </div>
    );
  }

  const c = compQ.data!;
  const verdict = (c.effectiveVerdict ?? c.overall) ?? null;
  const isOverride = Boolean(c.overrideVerdict);

  return (
    <div>
      {back}

      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-brand text-steel">{c.kind}</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
            {c.label}
          </h1>
        </div>
        {verdict ? <CaptureVerdictChip verdict={verdict} size="md" /> : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Photo + reference */}
        <div className="order-1 flex flex-col gap-3">
          <PhotoStage url={c.myPhotoUrl} label={c.label} />
          <Reference url={c.referenceUrl} caption={c.referenceCaption} notes={c.notes} />
        </div>

        {/* Verdict + decision */}
        <div className="order-2 flex flex-col gap-4">
          {/* A reviewer's re-shoot request, if one is outstanding. */}
          {c.needsPhoto && c.requestedByName ? (
            <div className="flex items-start gap-2 rounded-lg border border-signal/40 bg-signal/5 px-4 py-3 text-sm text-graphite">
              <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-hidden="true" />
              <span>
                <span className="font-medium text-signal">New photo requested</span> by{' '}
                {c.requestedByName}
                {c.requestedAt ? ` · ${fmtWhen(c.requestedAt)}` : ''} — awaiting a re-shoot.
              </span>
            </div>
          ) : null}

          {verdict ? (
            <VerdictCard detail={c} verdict={verdict} isOverride={isOverride} />
          ) : c.state === 'submitted' ? (
            <Card className="p-5 text-sm text-steel">
              Photo received — the scorer is comparing it to the guide. The verdict
              will appear here shortly.
            </Card>
          ) : (
            <Card className="p-5 text-sm text-steel">
              No photo has been captured for this fixture yet. Request one below to
              put it on the store&apos;s list.
            </Card>
          )}

          <ReviewActions
            currentVerdict={verdict}
            hasPhoto={Boolean(c.myPhotoUrl)}
            onOverride={(body) => override.mutate({ fixtureId, body })}
            overridePending={override.isPending}
            overrideDone={override.isSuccess}
            overrideError={override.isError ? override.error : null}
            onRequestPhoto={() => requestPhoto.mutate(fixtureId)}
            requestPending={requestPhoto.isPending}
            requestDone={requestPhoto.isSuccess}
            requestError={requestPhoto.isError ? requestPhoto.error : null}
          />
        </div>
      </div>

      {/* Capture history — every preserved shot (a re-shoot never erases the prior). */}
      {c.attempts.length > 0 ? <CaptureHistory attempts={c.attempts} /> : null}
    </div>
  );
}

/** The captured photo — served only via the signed `url` the API hands back. */
function PhotoStage({ url, label }: { url?: string | null; label: string }) {
  return (
    <figure className="overflow-hidden rounded-lg border border-mist/70 bg-surface">
      {url ? (
        <img
          src={url}
          alt={`Captured photo for ${label}`}
          className="aspect-[4/3] w-full object-cover"
        />
      ) : (
        <div className="grid aspect-[4/3] w-full place-items-center text-center text-steel">
          <div>
            <ImageOff className="mx-auto h-6 w-6" aria-hidden="true" />
            <p className="mt-2 text-sm">No photo captured yet</p>
          </div>
        </div>
      )}
      <figcaption className="border-t border-mist/50 px-3 py-1.5 text-[11px] uppercase tracking-brand text-steel">
        Store photo
      </figcaption>
    </figure>
  );
}

/** "What good looks like" — the guide reference + VM notes. */
function Reference({
  url,
  caption,
  notes,
}: {
  url?: string | null;
  caption?: string | null;
  notes?: string | null;
}) {
  if (!url && !notes) return null;
  return (
    <div className="rounded-lg border border-mist/60 bg-surface/40 p-3.5">
      <p className="mb-2 text-[11px] uppercase tracking-brand text-steel">
        What good looks like
      </p>
      {url ? (
        <figure className="overflow-hidden rounded-md border border-mist/60 bg-surface">
          <img src={url} alt="Guide reference" className="aspect-[4/3] w-full object-cover" />
          {caption ? (
            <figcaption className="border-t border-mist/50 px-3 py-1.5 text-xs text-steel">
              {caption}
            </figcaption>
          ) : null}
        </figure>
      ) : null}
      {notes ? (
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-graphite">
          {notes}
        </p>
      ) : null}
    </div>
  );
}

/** The effective verdict card — colour-blind safe (icon + word + the red accent). */
function VerdictCard({
  detail,
  verdict,
  isOverride,
}: {
  detail: FixtureComplianceDetail;
  verdict: CaptureVerdict;
  isOverride: boolean;
}) {
  const meta = CAPTURE_VERDICT_META[verdict];
  const Icon = meta.icon;
  const notes = isOverride ? detail.overrideNote : detail.aiNotes;
  const confidence = isOverride ? null : detail.confidence;
  return (
    <div className={`rounded-xl border p-4 ${meta.cls}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5" aria-hidden="true" />
        <span className="font-display text-base font-semibold">{meta.label}</span>
        {isOverride ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-ink/10 px-2 py-0.5 text-[11px] font-medium text-ink">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Reviewer override
          </span>
        ) : null}
        {!isOverride && typeof confidence === 'number' ? (
          <span className="ml-auto text-xs opacity-70">
            {Math.round(confidence * 100)}% confidence
          </span>
        ) : null}
      </div>
      {isOverride ? (
        <p className="mt-1 text-xs text-steel">
          Set by {detail.reviewedByName ?? 'a reviewer'}
          {detail.reviewedAt ? ` · ${fmtWhen(detail.reviewedAt)}` : ''}
          {detail.overall ? ` · AI said ${CAPTURE_VERDICT_META[detail.overall].label}` : ''}
        </p>
      ) : null}
      {notes ? (
        <p className="mt-2 text-sm leading-relaxed text-graphite">{notes}</p>
      ) : null}
    </div>
  );
}

/** The capture history: every preserved shot, newest first (thumb + verdict + when). */
function CaptureHistory({ attempts }: { attempts: CaptureAttempt[] }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-brand text-steel">
        <History className="h-3.5 w-3.5" aria-hidden="true" /> Capture history
      </h2>
      <ol className="divide-y divide-mist/40 overflow-hidden rounded-xl border border-mist/60 bg-paper">
        {attempts.map((a, i) => {
          const meta = a.verdict ? CAPTURE_VERDICT_META[a.verdict] : null;
          const Icon = meta?.icon;
          return (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md bg-surface">
                {a.photoUrl ? (
                  <img src={a.photoUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <ImageOff className="h-4 w-4 text-mist" aria-hidden="true" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {Icon && meta ? (
                    <span className={`inline-flex items-center gap-1 text-sm font-medium ${meta.text}`}>
                      <Icon className="h-4 w-4" aria-hidden="true" />
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
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ReviewSkeleton({ back }: { back: React.ReactNode }) {
  return (
    <div>
      {back}
      <Skeleton className="mb-5 h-8 w-56" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="aspect-[4/3] w-full rounded-lg" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
