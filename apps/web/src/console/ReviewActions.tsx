import * as React from 'react';
import { Check, Pencil, RotateCcw } from 'lucide-react';
import { Button } from '@wally/ui';

import type { CaptureVerdict, OverrideCaptureBody } from '@wally/sdk';
import { errorMessage } from '../lib/api';
import { CAPTURE_VERDICT_META } from './captureVerdict';

type Mode = 'CONFIRM' | 'OVERRIDE' | 'REQUEST';

const VERDICTS: CaptureVerdict[] = ['PASS', 'NEEDS_REVIEW', 'FAIL'];

/**
 * The reviewer's decision surface for one FixtureCapture.
 *
 * - Confirm: accept the AI's call. We record it explicitly by overriding to the
 *   same verdict, so the audit trail shows a human signed off (and the effective
 *   verdict is unambiguous downstream).
 * - Override: correct the verdict to PASS / NEEDS_REVIEW / FAIL with an optional
 *   note.
 * - Request new photo: send the fixture back to the floor for a re-shoot.
 *
 * Colour-blind safe throughout: every action carries an icon + a text label.
 */
export function ReviewActions({
  currentVerdict,
  hasPhoto,
  onOverride,
  overridePending,
  overrideDone,
  overrideError,
  onRequestPhoto,
  requestPending,
  requestDone,
  requestError,
}: {
  /** The fixture's current effective verdict, if it has been scored. */
  currentVerdict: CaptureVerdict | null;
  hasPhoto: boolean;
  onOverride: (body: OverrideCaptureBody) => void;
  overridePending: boolean;
  overrideDone: boolean;
  overrideError: unknown;
  onRequestPhoto: () => void;
  requestPending: boolean;
  requestDone: boolean;
  requestError: unknown;
}) {
  const [mode, setMode] = React.useState<Mode | null>(null);
  const [pick, setPick] = React.useState<CaptureVerdict>(currentVerdict ?? 'PASS');
  const [note, setNote] = React.useState('');

  // Keep the override picker seeded from the live verdict.
  React.useEffect(() => {
    if (currentVerdict) setPick(currentVerdict);
  }, [currentVerdict]);

  const confirm = () => {
    if (!currentVerdict) return;
    onOverride({ verdict: currentVerdict, note: note.trim() || undefined });
  };
  const saveOverride = () => {
    onOverride({ verdict: pick, note: note.trim() || undefined });
  };

  return (
    <div className="rounded-lg border border-mist/60 bg-paper p-4">
      <p className="text-[11px] uppercase tracking-brand text-steel">Your decision</p>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <ModeButton
          active={mode === 'CONFIRM'}
          onClick={() => setMode('CONFIRM')}
          icon={Check}
          label="Confirm"
          disabled={!currentVerdict}
        />
        <ModeButton
          active={mode === 'OVERRIDE'}
          onClick={() => setMode('OVERRIDE')}
          icon={Pencil}
          label="Override"
        />
        <ModeButton
          active={mode === 'REQUEST'}
          onClick={() => setMode('REQUEST')}
          icon={RotateCcw}
          label="New photo"
          tone="signal"
        />
      </div>

      {/* CONFIRM */}
      {mode === 'CONFIRM' ? (
        <div className="mt-4">
          {currentVerdict ? (
            <p className="text-sm text-graphite">
              Accept the verdict —{' '}
              <span className="font-medium text-ink">
                {CAPTURE_VERDICT_META[currentVerdict].label}
              </span>
              . This records that you signed off.
            </p>
          ) : (
            <p className="text-sm text-steel">
              Nothing to confirm yet — this fixture hasn&apos;t been scored.
            </p>
          )}
          <NoteField mode="CONFIRM" note={note} setNote={setNote} />
          {overrideDone ? (
            <Done label="Confirmed." />
          ) : (
            <Actions
              cancel={() => setMode(null)}
              pending={overridePending}
              submit={confirm}
              submitLabel="Confirm verdict"
              disabled={!currentVerdict}
            />
          )}
          {overrideError ? <ErrLine error={overrideError} /> : null}
        </div>
      ) : null}

      {/* OVERRIDE */}
      {mode === 'OVERRIDE' ? (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-graphite">Set the verdict to</p>
          <div className="grid grid-cols-3 gap-1.5">
            {VERDICTS.map((v) => {
              const meta = CAPTURE_VERDICT_META[v];
              const Icon = meta.icon;
              const active = pick === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setPick(v)}
                  aria-pressed={active}
                  className={[
                    'tap flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[11px] font-medium transition',
                    active
                      ? `${meta.cls} ring-2 ring-ink/20`
                      : 'border-mist/60 bg-paper text-steel hover:bg-surface/60',
                  ].join(' ')}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {meta.label}
                </button>
              );
            })}
          </div>
          <NoteField mode="OVERRIDE" note={note} setNote={setNote} />
          {overrideDone ? (
            <Done label="Override saved." />
          ) : (
            <Actions
              cancel={() => setMode(null)}
              pending={overridePending}
              submit={saveOverride}
              submitLabel="Save override"
            />
          )}
          {overrideError ? <ErrLine error={overrideError} /> : null}
        </div>
      ) : null}

      {/* REQUEST NEW PHOTO */}
      {mode === 'REQUEST' ? (
        <div className="mt-4">
          <div className="flex items-start gap-2 rounded-md bg-signal/[0.06] px-3 py-2 text-sm text-graphite">
            <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-hidden="true" />
            <span>
              Sends this fixture back to the store for a re-shoot. The current
              photo and verdict are preserved in the history.
            </span>
          </div>
          {requestDone ? (
            <Done label="New photo requested." />
          ) : (
            <Actions
              cancel={() => setMode(null)}
              pending={requestPending}
              submit={onRequestPhoto}
              submitLabel={hasPhoto ? 'Request new photo' : 'Request a photo'}
              tone="signal"
            />
          )}
          {requestError ? <ErrLine error={requestError} /> : null}
        </div>
      ) : null}

      {mode === null ? (
        <p className="mt-3 text-sm text-steel">
          Pick an action above to record your call on this fixture.
        </p>
      ) : null}
    </div>
  );
}

function NoteField({
  mode,
  note,
  setNote,
}: {
  mode: 'CONFIRM' | 'OVERRIDE';
  note: string;
  setNote: (v: string) => void;
}) {
  return (
    <label className="mt-3 block">
      <span className="mb-1.5 block text-sm font-medium text-graphite">
        Note (optional)
      </span>
      <textarea
        className="field min-h-[64px] resize-y"
        placeholder={
          mode === 'OVERRIDE' ? 'What did the model miss?' : 'Anything worth noting…'
        }
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
    </label>
  );
}

function Actions({
  cancel,
  pending,
  submit,
  submitLabel,
  tone = 'primary',
  disabled = false,
}: {
  cancel: () => void;
  pending: boolean;
  submit: () => void;
  submitLabel: string;
  tone?: 'primary' | 'signal';
  disabled?: boolean;
}) {
  return (
    <div className="mt-3 flex justify-end gap-2">
      <Button variant="ghost" size="sm" onClick={cancel} disabled={pending}>
        Cancel
      </Button>
      <Button
        size="sm"
        variant={tone === 'signal' ? 'signal' : 'primary'}
        loading={pending}
        disabled={disabled}
        onClick={submit}
      >
        {submitLabel}
      </Button>
    </div>
  );
}

function Done({ label }: { label: string }) {
  return (
    <div className="mt-3 flex items-center gap-2 rounded-lg border border-pass/30 bg-pass/[0.06] px-4 py-2.5 text-sm text-pass">
      <Check className="h-4 w-4" aria-hidden="true" />
      {label}
    </div>
  );
}

function ErrLine({ error }: { error: unknown }) {
  return <p className="mt-2 text-sm text-signal">{errorMessage(error)}</p>;
}

function ModeButton({
  active,
  onClick,
  icon: Icon,
  label,
  tone = 'neutral',
  disabled = false,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tone?: 'neutral' | 'signal';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      disabled={disabled}
      className={[
        'tap flex flex-col items-center gap-1 rounded-md border px-2 py-2.5 text-xs font-medium',
        disabled ? 'cursor-not-allowed opacity-40' : '',
        active
          ? tone === 'signal'
            ? 'border-signal bg-signal/[0.06] text-signal'
            : 'border-ink bg-surface text-ink'
          : 'border-mist/70 text-graphite hover:border-steel',
      ].join(' ')}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}
