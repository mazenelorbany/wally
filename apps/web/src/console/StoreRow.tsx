import * as React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Verdict } from '@wally/ui';

import type { StoreScore } from '@wally/types';
import { attentionCount, storeHeadline } from '../lib/format';

/** A small tally pill — count + label, neutral by default. */
function Tally({
  count,
  label,
  tone = 'neutral',
}: {
  count: number;
  label: string;
  tone?: 'neutral' | 'signal' | 'warn' | 'pass';
}) {
  if (count === 0) return null;
  const tones: Record<string, string> = {
    neutral: 'bg-surface text-steel',
    signal: 'bg-signal/10 text-signal',
    warn: 'bg-warn/10 text-warn',
    pass: 'bg-pass/10 text-pass',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      <span className="tabular-nums">{count}</span>
      <span className="font-normal opacity-80">{label}</span>
    </span>
  );
}

/**
 * One store in the reviewer queue. Attention-first: the verdict band and the
 * plain-English headline lead; tallies and the submitted/expected ratio give
 * the shape of the work without forcing a drill-in.
 */
export function StoreRow({ store }: { store: StoreScore }) {
  const needsAttention = attentionCount(store) > 0;
  return (
    <Link
      to={`/console/store/${encodeURIComponent(store.storeId)}`}
      className="tap group flex items-center gap-4 rounded-lg border border-mist/60 bg-paper px-4 py-3.5 hover:border-steel/60 hover:shadow-card"
    >
      {/* Attention rail — a structural marker, not hue-only (width + presence). */}
      <span
        aria-hidden="true"
        className={[
          'h-10 w-1 shrink-0 rounded-full',
          needsAttention ? 'bg-signal' : 'bg-mist/50',
        ].join(' ')}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <h3 className="truncate font-display text-base font-semibold text-ink">
            {store.storeName}
          </h3>
          <span className="shrink-0 text-xs tabular-nums text-steel">
            {store.submitted}/{store.expected}
          </span>
        </div>
        <p className="mt-0.5 truncate text-sm text-steel">{storeHeadline(store)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Tally count={store.failed.length} label="failing" tone="signal" />
          <Tally count={store.review.length} label="to review" tone="warn" />
          <Tally count={store.expected - store.submitted} label="missing" tone="neutral" />
          <Tally count={store.notApplicable.length} label="n/a" tone="neutral" />
        </div>
      </div>

      <Verdict tone={store.overall} className="shrink-0" />
      <ChevronRight className="h-5 w-5 shrink-0 text-mist transition-colors group-hover:text-steel" />
    </Link>
  );
}
