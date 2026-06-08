import * as React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import type { CaptureVerdict } from '@wally/sdk';

/**
 * The colour-blind-safe meaning map for a FixtureCapture verdict
 * (PASS / NEEDS_REVIEW / FAIL). Meaning is carried by an ICON + a text LABEL;
 * colour is reinforcement only (the GRB CEO is colour blind but sees red).
 *
 * Mirrors the manager floor loop's verdict styling (store/GuideView) so the
 * reviewer console and the field app read the same.
 */
export const CAPTURE_VERDICT_META: Record<
  CaptureVerdict,
  { icon: LucideIcon; label: string; cls: string; text: string }
> = {
  PASS: {
    icon: CheckCircle2,
    label: 'Pass',
    cls: 'border-pass/40 bg-pass/5 text-pass',
    text: 'text-pass',
  },
  NEEDS_REVIEW: {
    icon: AlertTriangle,
    label: 'Needs review',
    cls: 'border-mist bg-surface text-graphite',
    text: 'text-graphite',
  },
  FAIL: {
    icon: XCircle,
    label: 'Fail',
    cls: 'border-signal/40 bg-signal/5 text-signal',
    text: 'text-signal',
  },
};

/** Icon + label chip for a capture verdict — never colour alone. */
export function CaptureVerdictChip({
  verdict,
  size = 'sm',
}: {
  verdict: CaptureVerdict;
  size?: 'sm' | 'md';
}) {
  const meta = CAPTURE_VERDICT_META[verdict];
  const Icon = meta.icon;
  const dims =
    size === 'md'
      ? 'h-7 gap-1.5 px-2.5 text-xs'
      : 'h-6 gap-1 px-2 text-[11px]';
  const icon = size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5';
  return (
    <span
      role="status"
      aria-label={meta.label}
      className={`inline-flex shrink-0 items-center rounded-md border font-medium ${meta.cls} ${dims}`}
    >
      <Icon className={`shrink-0 ${icon}`} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

/** A short human date for stamps ("Jun 6, 2:14 PM"). */
export function fmtWhen(iso: string): string {
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
