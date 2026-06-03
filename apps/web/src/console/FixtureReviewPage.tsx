import * as React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ImageOff } from 'lucide-react';
import { Card, ConfidenceBar, Verdict } from '@wally/ui';

import type { SubmissionPhoto } from '@wally/sdk';
import { useReview, useSubmission } from '../lib/hooks';
import { humanizeKey } from '../lib/format';
import { EmptyState, ErrorState, Skeleton } from '../components/states';
import { CriterionResultRow } from './CriterionResultRow';
import { ReviewActions } from './ReviewActions';

/**
 * Fixture review — the reviewer's bench. One photo, the rubric criteria graded
 * against it (verdict + confidence + evidence), and the confirm/override/
 * escalate decision.
 *
 * We resolve the photo through its submission (`?submission=<id>`), since the
 * SDK loads photos as part of a Submission. Without it we can't fetch the
 * verdict, so we say so plainly rather than guess.
 */
export function FixtureReviewPage() {
  const { photoId } = useParams();
  const [search] = useSearchParams();
  const submissionId = search.get('submission') ?? undefined;

  const submissionQ = useSubmission(submissionId);
  const review = useReview();
  const navigate = useNavigate();
  const [submitted, setSubmitted] = React.useState(false);

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

  if (!submissionId) {
    return (
      <div>
        {back}
        <EmptyState
          icon={ImageOff}
          title="Open this fixture from a store"
          body="Fixture reviews load through their store's ledger. Head back to the queue and pick the fixture from a store."
        >
          <Link
            to="/console"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-ink underline-offset-4 hover:underline"
          >
            Go to the queue
          </Link>
        </EmptyState>
      </div>
    );
  }

  if (submissionQ.isLoading) return <ReviewSkeleton back={back} />;
  if (submissionQ.isError) {
    return (
      <div>
        {back}
        <ErrorState error={submissionQ.error} onRetry={() => submissionQ.refetch()} />
      </div>
    );
  }

  const submission = submissionQ.data!;
  const photo = submission.photos.find((p) => p.id === photoId);

  if (!photo) {
    return (
      <div>
        {back}
        <EmptyState
          icon={ImageOff}
          title="Fixture not found"
          body="This photo isn't part of the submission anymore."
        />
      </div>
    );
  }

  const score = photo.score;

  return (
    <div>
      {back}

      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-brand text-steel">
            {submission.storeName} · {submission.campaignKey}
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
            {humanizeKey(photo.fixtureKey)}
          </h1>
        </div>
        {score ? <Verdict tone={score.overall} size="lg" /> : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Photo */}
        <div className="order-1">
          <PhotoStage photo={photo} />
          {score ? (
            <div className="mt-3 rounded-lg border border-mist/60 bg-surface/40 px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-graphite">Overall confidence</span>
              </div>
              <div className="mt-2">
                <ConfidenceBar value={score.confidence} />
              </div>
              <p className="mt-3 text-[11px] text-steel">
                {score.modelId} · {score.rubricVersion} · prompt {score.promptVersion}
              </p>
            </div>
          ) : null}
        </div>

        {/* Criteria + decision */}
        <div className="order-2 flex flex-col gap-4">
          {score ? (
            <Card className="overflow-hidden">
              <div className="border-b border-mist/50 px-4 py-3">
                <p className="text-[11px] uppercase tracking-brand text-steel">
                  Rubric criteria
                </p>
              </div>
              <ul className="divide-y divide-mist/50">
                {score.results.map((r) => (
                  <CriterionResultRow key={r.id} result={r} />
                ))}
              </ul>
            </Card>
          ) : (
            <Card className="p-5 text-sm text-steel">
              This photo hasn&apos;t been scored yet. It will appear here once the
              scorer runs.
            </Card>
          )}

          {score ? (
            <ReviewActions
              currentOverall={score.overall}
              pending={review.isPending}
              done={submitted}
              onSubmit={(body) =>
                review.mutate(
                  { verdictId: photo.id, body },
                  { onSuccess: () => setSubmitted(true) },
                )
              }
            />
          ) : null}

          {review.isError ? (
            <ErrorState error={review.error} title="Could not record your decision" />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** The photo itself — served only via the signed `url` the API hands back. */
function PhotoStage({ photo }: { photo: SubmissionPhoto }) {
  return (
    <div className="overflow-hidden rounded-lg border border-mist/70 bg-surface">
      {photo.url ? (
        <img
          src={photo.url}
          alt={`Submitted photo for ${humanizeKey(photo.fixtureKey)}`}
          className="aspect-[4/3] w-full object-cover"
        />
      ) : (
        <div className="grid aspect-[4/3] w-full place-items-center text-center text-steel">
          <div>
            <ImageOff className="mx-auto h-6 w-6" aria-hidden="true" />
            <p className="mt-2 text-sm">Photo unavailable</p>
          </div>
        </div>
      )}
    </div>
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
          <Skeleton className="h-64 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
