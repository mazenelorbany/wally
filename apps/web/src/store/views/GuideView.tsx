import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  Camera,
  CheckCircle2,
  ChevronRight,
  History,
  ImageOff,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { Button, Spinner } from '@wally/ui';
import type { CaptureAttempt, CaptureVerdict, Department, ManagerFixture } from '@wally/sdk';

import { api, errorMessage } from '../../lib/api';
import { useSession } from '../../lib/auth';
import { useManagerStore } from '../ManagerStoreContext';

const deptLabel = (d?: Department | 'shared' | null) =>
  d === 'The Custom Chef' ? 'The Custom Chef' : d === 'The Cook Shop' ? 'The Cook Shop' : 'Store';

export function GuideView() {
  const { storeId } = useManagerStore();
  const fixturesQ = useQuery({
    queryKey: ['manager', 'fixtures', storeId],
    queryFn: () => api.manager.fixtures(storeId),
  });

  if (fixturesQ.isLoading) {
    return (
      <div className="grid h-64 place-items-center">
        <Spinner className="text-2xl text-steel" />
      </div>
    );
  }

  const fixtures = (fixturesQ.data ?? []).filter((f) => f.applicable);
  const groups = groupByDept(fixtures);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Your guide
        </h1>
        <p className="mt-0.5 text-sm text-steel">
          The fixtures your store sets up this campaign — tap for how-to and products.
        </p>
      </header>

      {groups.map(([dept, items]) => (
        <section key={dept}>
          <h2 className="mb-2 text-[11px] uppercase tracking-brand text-steel">
            {deptLabel(dept)}
          </h2>
          <div className="divide-y divide-mist/40 overflow-hidden rounded-xl border border-mist/60 bg-paper">
            {items.map((f) => (
              <Link
                key={f.fixtureId}
                to={`/store/guide/${encodeURIComponent(f.fixtureId)}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-surface/50"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface text-graphite">
                  <Boxes className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{f.label}</p>
                  <p className="text-xs text-steel">
                    {f.productCount} product{f.productCount === 1 ? '' : 's'}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-mist" />
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function groupByDept(items: ManagerFixture[]): [Department | 'shared', ManagerFixture[]][] {
  const order: (Department | 'shared')[] = ['The Custom Chef', 'The Cook Shop', 'shared'];
  const map = new Map<Department | 'shared', ManagerFixture[]>();
  for (const f of items) {
    const k = (f.department ?? 'shared') as Department | 'shared';
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(f);
  }
  return order.filter((k) => map.has(k)).map((k) => [k, map.get(k)!]);
}

/**
 * The fixture compliance sheet: the guide reference + VM notes, the manager's
 * own photo, and the AI verdict from comparing them. This is the loop Jeremy
 * validated — photo vs guide → pass / needs-review / fail + notes. Products on
 * the fixture sit below for reference.
 */
export function GuideFixtureDetailView() {
  const { fixtureId = '' } = useParams();
  const { storeId } = useManagerStore();
  const { user } = useSession();
  const isReviewer = user?.role === 'REVIEWER' || user?.role === 'ADMIN';
  const qc = useQueryClient();
  const fileRef = React.useRef<HTMLInputElement>(null);

  const homeQ = useQuery({
    queryKey: ['manager', 'home', storeId],
    queryFn: () => api.manager.home(storeId),
  });
  const campaignId = homeQ.data?.campaignId;

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

  // Any change to the capture loop invalidates the same set of queries.
  const invalidateCapture = () => {
    void qc.invalidateQueries({
      queryKey: ['manager', 'fixture-compliance', storeId, fixtureId],
    });
    void qc.invalidateQueries({ queryKey: ['manager', 'compliance', storeId] });
    void qc.invalidateQueries({ queryKey: ['manager', 'home', storeId] });
  };

  const upload = useMutation({
    mutationFn: (file: File) =>
      api.manager.uploadFixturePhoto(fixtureId, file, storeId),
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

  if (compQ.isLoading || homeQ.isLoading) {
    return (
      <div className="grid h-64 place-items-center">
        <Spinner className="text-2xl text-steel" />
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
      <BackLink />
      <header>
        <p className="text-[11px] uppercase tracking-brand text-steel">
          {c?.kind ?? d?.kind}
        </p>
        <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight text-ink">
          {c?.label ?? d?.fixtureName}
        </h1>
      </header>

      {/* Compliance: reference + notes + my photo + verdict */}
      <section className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Frame label="Guide reference">
            {c?.referenceUrl ? (
              <img src={c.referenceUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <Placeholder text="No reference" />
            )}
          </Frame>
          <Frame label="Your photo">
            {c?.myPhotoUrl ? (
              <img src={c.myPhotoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <Placeholder text="Not submitted" icon={<Camera className="h-5 w-5 text-mist" />} />
            )}
          </Frame>
        </div>

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

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onPick}
          className="hidden"
        />
        <Button
          className="w-full"
          size="lg"
          onClick={() => fileRef.current?.click()}
          loading={upload.isPending}
        >
          <Camera className="h-4 w-4" />
          {c?.myPhotoUrl ? 'Retake photo' : 'Take / upload photo'}
        </Button>
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

      {/* Capture history — every preserved shot (a re-shoot never erases the prior). */}
      {c?.attempts && c.attempts.length > 0 ? (
        <CaptureHistory attempts={c.attempts} />
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
function CaptureHistory({ attempts }: { attempts: CaptureAttempt[] }) {
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
            <li key={a.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md bg-surface">
                {a.photoUrl ? (
                  <img src={a.photoUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <ImageOff className="h-4 w-4 text-mist" />
                )}
              </span>
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

function BackLink() {
  return (
    <Link
      to="/store/guide"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-steel hover:text-ink"
    >
      <ArrowLeft className="h-4 w-4" /> Guide
    </Link>
  );
}
