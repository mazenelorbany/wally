import * as React from 'react';
import { AlertTriangle, Check, Flag, Pencil } from 'lucide-react';
import { Button, Verdict } from '@wally/ui';

import type { Overall } from '@wally/types';
import type { ReviewAction, ReviewBody } from '@wally/sdk';

const OVERRIDE_BANDS: Overall[] = ['perfect', 'good', 'not_good', 'needs_review'];

/**
 * The reviewer's decision surface for one verdict. Confirm accepts the model's
 * call; Override corrects the band (and demands a chosen band); Escalate flags
 * it for a second pair of eyes. A note is optional except where override needs
 * a justification.
 */
export function ReviewActions({
  currentOverall,
  onSubmit,
  pending,
  done,
}: {
  currentOverall: Overall;
  onSubmit: (body: ReviewBody) => void;
  pending: boolean;
  done: boolean;
}) {
  const [mode, setMode] = React.useState<ReviewAction | null>(null);
  const [overall, setOverall] = React.useState<Overall>(currentOverall);
  const [note, setNote] = React.useState('');

  if (done) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-pass/30 bg-pass/[0.06] px-4 py-3 text-sm text-pass">
        <Check className="h-4 w-4" aria-hidden="true" />
        Decision recorded.
      </div>
    );
  }

  const submit = (action: ReviewAction) => {
    const body: ReviewBody =
      action === 'OVERRIDE'
        ? { action, overall, note: note.trim() || undefined }
        : { action, note: note.trim() || undefined };
    onSubmit(body);
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
        />
        <ModeButton
          active={mode === 'OVERRIDE'}
          onClick={() => setMode('OVERRIDE')}
          icon={Pencil}
          label="Override"
        />
        <ModeButton
          active={mode === 'ESCALATE'}
          onClick={() => setMode('ESCALATE')}
          icon={Flag}
          label="Escalate"
          tone="signal"
        />
      </div>

      {mode === 'OVERRIDE' ? (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-graphite">Correct the verdict to</p>
          <div className="flex flex-wrap gap-2">
            {OVERRIDE_BANDS.map((band) => (
              <button
                key={band}
                type="button"
                onClick={() => setOverall(band)}
                className={[
                  'tap rounded-md border px-1.5 py-1',
                  overall === band
                    ? 'border-ink ring-1 ring-ink'
                    : 'border-mist/70 hover:border-steel',
                ].join(' ')}
                aria-pressed={overall === band}
              >
                <Verdict tone={band} size="sm" />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {mode === 'ESCALATE' ? (
        <div className="mt-3 flex items-start gap-2 rounded-md bg-signal/[0.06] px-3 py-2 text-sm text-graphite">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-hidden="true" />
          <span>Sends this fixture for a second review. Add context below.</span>
        </div>
      ) : null}

      {mode ? (
        <div className="mt-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-graphite">
              Note {mode === 'CONFIRM' ? '(optional)' : ''}
            </span>
            <textarea
              className="field min-h-[72px] resize-y"
              placeholder={
                mode === 'OVERRIDE'
                  ? 'What did the model miss?'
                  : mode === 'ESCALATE'
                    ? 'Why does this need a second look?'
                    : 'Anything worth noting…'
              }
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setMode(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant={mode === 'ESCALATE' ? 'signal' : 'primary'}
              loading={pending}
              onClick={() => submit(mode)}
            >
              {mode === 'CONFIRM'
                ? 'Confirm verdict'
                : mode === 'OVERRIDE'
                  ? 'Save override'
                  : 'Escalate'}
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-steel">
          Pick an action above to record your call on this fixture.
        </p>
      )}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon: Icon,
  label,
  tone = 'neutral',
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tone?: 'neutral' | 'signal';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'tap flex flex-col items-center gap-1 rounded-md border px-2 py-2.5 text-xs font-medium',
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
