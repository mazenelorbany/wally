import * as React from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  HelpCircle,
  Send,
  XCircle,
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
} from '@wally/ui';
import type { CaptureVerdict, FixtureCompliance } from '@wally/sdk';

import { api, errorMessage } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { ErrorState } from '../../components/states';
import { useManagerStore } from '../ManagerStoreContext';
import { ReportQuestions } from '../components/ReportQuestions';
import { FixtureCapture } from '../components/FixtureCapture';
import { ThreadList, type ThreadActions } from '../../components/report/ReviewThreads';
import { useReviewThreads } from '../../components/report/useReviewThreads';
import type { ReviewThreadDto } from '@wally/sdk';

const VERDICT: Record<
  CaptureVerdict,
  { icon: React.ComponentType<{ className?: string }>; label: string; cls: string }
> = {
  PASS: { icon: CheckCircle2, label: 'Pass', cls: 'text-pass' },
  NEEDS_REVIEW: { icon: HelpCircle, label: 'Review', cls: 'text-gold-deep' },
  FAIL: { icon: XCircle, label: 'Fail', cls: 'text-fail' },
};

export function ManagerReportView() {
  const { storeId } = useManagerStore();
  // An explicit campaign (a task row the manager opened) — without it, the
  // active campaign resolves server-side, the single-campaign default.
  const { campaignId } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirming, setConfirming] = React.useState(false);

  const reportQ = useQuery({
    queryKey: ['manager', 'report', storeId, campaignId],
    queryFn: () => api.manager.getReport(storeId, campaignId),
  });
  const compQ = useQuery({
    queryKey: ['manager', 'compliance', storeId, campaignId],
    queryFn: () => api.manager.compliance(storeId, campaignId),
  });

  // Head-office comments on this report — shown inline so the manager can fix
  // and reply without leaving the form. r.campaignId resolves the default route.
  const reportCampaignId = campaignId ?? reportQ.data?.campaignId;
  const review = useReviewThreads(reportCampaignId, reportQ.data?.storeId);
  const threadActions: ThreadActions = {
    canReply: true,
    canModerate: false,
    busy: review.busy,
    onReply: (threadId, body) => review.reply.mutate({ threadId, body }),
    onResolve: () => undefined,
    onReopen: () => undefined,
  };

  const submit = useMutation({
    mutationFn: () => api.manager.submitReport(storeId, campaignId),
    onSuccess: (r) => {
      qc.setQueryData(['manager', 'report', storeId, campaignId], r);
      void qc.invalidateQueries({ queryKey: ['manager', 'home', storeId] });
      setConfirming(false);
      toast.success('Report submitted');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (reportQ.isLoading || compQ.isLoading) {
    return (
      <div className="grid h-64 place-items-center">
        <Spinner className="text-2xl text-steel" />
      </div>
    );
  }
  if (reportQ.isError) {
    return (
      <div className="px-1 py-2">
        <ErrorState
          error={reportQ.error}
          onRetry={() => reportQ.refetch()}
          title="Couldn't load your report"
        />
      </div>
    );
  }

  const r = reportQ.data!;
  const fixtures = compQ.data ?? [];
  const submitted = r.status === 'SUBMITTED';

  const stepsTotal = r.fixturesExpected + r.questionsTotal + r.checklistTotal;
  const stepsDone = r.fixturesScored + r.questionsAnswered + r.checklistChecked;
  const pct = stepsTotal ? Math.round((stepsDone / stepsTotal) * 100) : 0;
  const requiredGaps = r.requiredUnanswered + r.requiredUnchecked;

  const missingFixtures = r.fixturesExpected - r.fixturesScored;

  return (
    <div className="space-y-5 pb-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-brand text-steel">
            Store report
          </p>
          <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight text-ink">
            {submitted ? 'Report submitted' : 'Complete your report'}
          </h1>
        </div>
        <StatusPill status={r.status} />
      </header>

      {/* Progress + score */}
      <div className="rounded-xl border border-mist/60 bg-paper p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-ink">
            {stepsDone} of {stepsTotal} steps done
          </span>
          {r.totalScore != null ? (
            <span className="text-steel">
              Score <span className="font-semibold text-ink">{r.totalScore}%</span>
            </span>
          ) : null}
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-mist/40">
          <div
            className="h-full rounded-full bg-gold transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Fixture (photo) steps — each expands in place to capture + tick. */}
      <section>
        <h2 className="mb-2 text-[11px] uppercase tracking-brand text-steel">
          Photos ({r.fixturesScored}/{r.fixturesExpected})
        </h2>
        <ul className="divide-y divide-mist/50 overflow-hidden rounded-lg border border-mist/60 bg-paper">
          {fixtures.map((f) => (
            <FixtureStep
              key={f.fixtureId}
              fixture={f}
              storeId={storeId}
              campaignId={r.campaignId}
              threads={review.threads.filter((t) => t.fixtureId === f.fixtureId)}
              threadActions={threadActions}
            />
          ))}
          {fixtures.length === 0 ? (
            <li className="px-4 py-4 text-sm text-steel">
              No fixtures on your floor plan yet.
            </li>
          ) : null}
        </ul>
      </section>

      {/* Extra questions */}
      <ReportQuestions storeId={storeId} campaignId={campaignId} readOnly={submitted} />

      {/* Head-office comments on the answers — reply inline. */}
      <QuestionThreads threads={review.threads} actions={threadActions} />

      {/* Sticky submit bar — sticks inside the content column's scroll area so
          it never overlays the sidebar (Settings / Sign out stay clickable). */}
      {!submitted ? (
        <div className="sticky bottom-0 z-30 -mx-4 border-t border-mist/60 bg-paper/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-paper/80 sm:-mx-6 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-steel">
              {requiredGaps > 0
                ? `${requiredGaps} required item${requiredGaps === 1 ? '' : 's'} left`
                : missingFixtures > 0
                  ? `${missingFixtures} fixture${missingFixtures === 1 ? '' : 's'} without a photo`
                  : 'Everything looks done'}
            </span>
            <Button
              size="lg"
              onClick={() => setConfirming(true)}
              disabled={requiredGaps > 0}
            >
              <Send className="h-4 w-4" /> Submit report
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-mist/60 bg-surface/40 px-4 py-3 text-sm text-graphite">
          Submitted{r.submittedAt ? ` ${new Date(r.submittedAt).toLocaleString()}` : ''}
          {r.submittedByName ? ` by ${r.submittedByName}` : ''}. Head office can now
          review it.
        </div>
      )}

      <SubmitDialog
        open={confirming}
        report={r}
        requiredGaps={requiredGaps}
        missingFixtures={missingFixtures}
        pending={submit.isPending}
        onConfirm={() => submit.mutate()}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}

/**
 * One photo step in the report. The row is a status header; tapping it expands
 * the full capture loop (reference, photos, AI verdict, instructions, checklist)
 * in place — the report never navigates to the floor map.
 */
function FixtureStep({
  fixture: f,
  storeId,
  campaignId,
  threads,
  threadActions,
}: {
  fixture: FixtureCompliance;
  storeId?: string;
  campaignId: string;
  threads: ReviewThreadDto[];
  threadActions: ThreadActions;
}) {
  const [open, setOpen] = React.useState(false);
  const openThreads = threads.filter((t) => t.status === 'OPEN').length;
  const verdict = f.effectiveVerdict ?? f.overall ?? null;
  let icon = <Camera className="h-4 w-4 text-gold-deep" />;
  let note = 'Needs a photo';
  let noteCls = 'text-gold-deep';
  if (f.needsPhoto) {
    // keep the camera CTA
  } else if (verdict) {
    const meta = VERDICT[verdict];
    const Icon = meta.icon;
    icon = <Icon className={`h-4 w-4 ${meta.cls}`} />;
    note = meta.label;
    noteCls = meta.cls;
  } else if (f.state === 'submitted') {
    icon = <CircleDashed className="h-4 w-4 text-steel" />;
    note = 'Awaiting score';
    noteCls = 'text-steel';
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface/50"
      >
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">
            {f.label}
          </span>
          <span className={`text-xs ${noteCls}`}>{note}</span>
        </span>
        {openThreads > 0 ? (
          <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-gold px-1.5 text-[10px] font-semibold text-chrome-ink">
            {openThreads}
          </span>
        ) : null}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-mist transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open ? (
        <div className="border-t border-mist/50 bg-surface/20 px-4 py-4">
          {threads.length > 0 ? (
            <div className="mb-3">
              <p className="mb-1 text-[11px] uppercase tracking-brand text-steel">
                Head office comments
              </p>
              <ThreadList threads={threads} actions={threadActions} />
            </div>
          ) : null}
          <FixtureCapture fixtureId={f.fixtureId} storeId={storeId} campaignId={campaignId} />
        </div>
      ) : null}
    </li>
  );
}

/**
 * Comments anchored to the report's QUESTION answers, grouped under one block
 * (the question text itself lives in ReportQuestions just above).
 */
function QuestionThreads({
  threads,
  actions,
}: {
  threads: ReviewThreadDto[];
  actions: ThreadActions;
}) {
  const questionThreads = threads.filter((t) => t.questionId);
  if (questionThreads.length === 0) return null;
  return (
    <section>
      <p className="mb-1 text-[11px] uppercase tracking-brand text-steel">
        Head office comments on your answers
      </p>
      <ThreadList threads={questionThreads} actions={actions} />
    </section>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    DRAFT: { label: 'Draft', cls: 'bg-surface text-steel' },
    PENDING: { label: 'Pending', cls: 'bg-surface text-steel' },
    IN_PROGRESS: { label: 'In progress', cls: 'bg-gold/15 text-gold-deep' },
    SUBMITTED: { label: 'Submitted', cls: 'bg-pass/15 text-pass' },
    REOPENED: { label: 'Reopened', cls: 'bg-signal/15 text-signal' },
  };
  const s = map[status] ?? { label: status, cls: 'bg-surface text-steel' };
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}

function SubmitDialog({
  open,
  report,
  requiredGaps,
  missingFixtures,
  pending,
  onConfirm,
  onClose,
}: {
  open: boolean;
  report: {
    flags: { nonCompliant: boolean; lowConfidence: boolean };
  };
  requiredGaps: number;
  missingFixtures: number;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const blocked = requiredGaps > 0;
  const warnings: string[] = [];
  if (missingFixtures > 0)
    warnings.push(
      `${missingFixtures} fixture${missingFixtures === 1 ? '' : 's'} without a photo`,
    );
  if (report.flags.nonCompliant) warnings.push('Some fixtures failed the check');
  if (report.flags.lowConfidence)
    warnings.push('Some photos scored low confidence — a reviewer will check');

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Submit report</DialogTitle>
          <DialogDescription>
            Head office can review it after you submit. You can still be asked to
            re-shoot a fixture.
          </DialogDescription>
        </DialogHeader>

        {blocked ? (
          <p className="flex items-start gap-2 rounded-lg border border-fail/40 bg-fail/5 px-3 py-2.5 text-sm text-graphite">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-fail" />
            Complete the {requiredGaps} required item
            {requiredGaps === 1 ? '' : 's'} first (questions + checklist).
          </p>
        ) : warnings.length > 0 ? (
          <ul className="space-y-1.5 rounded-lg border border-gold/40 bg-gold/5 px-3 py-2.5 text-sm text-graphite">
            {warnings.map((w) => (
              <li key={w} className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-gold-deep" />
                {w}
              </li>
            ))}
            <li className="pl-6 text-xs text-steel">
              You can still submit — these are just flagged for review.
            </li>
          </ul>
        ) : (
          <p className="text-sm text-graphite">Everything looks complete.</p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button">
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={onConfirm} disabled={blocked || pending} loading={pending}>
            <Send className="h-4 w-4" /> Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
