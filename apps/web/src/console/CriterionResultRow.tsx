import * as React from 'react';
import { Verdict, ConfidenceBar } from '@wally/ui';

import type { Criterion, CriterionResult } from '@wally/types';

/**
 * One rubric criterion as graded against the photo: the verdict (icon+label),
 * the model's evidence sentence, and its confidence. Critical criteria are
 * flagged structurally (a label), never by colour alone.
 */
export function CriterionResultRow({
  result,
  criterion,
}: {
  result: CriterionResult;
  /** The matching rubric criterion, when the rubric is available. */
  criterion?: Criterion;
}) {
  return (
    <li className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">
            {criterion?.text ?? result.id}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {criterion?.critical ? (
              <span className="rounded bg-ink/[0.06] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-graphite">
                Critical
              </span>
            ) : null}
            {criterion?.kind ? (
              <span className="text-[11px] capitalize text-steel">{criterion.kind}</span>
            ) : null}
          </div>
        </div>
        <Verdict tone={result.verdict} size="sm" className="shrink-0" />
      </div>

      {result.evidence ? (
        <p className="mt-2 rounded-md bg-surface/70 px-3 py-2 text-sm leading-relaxed text-graphite">
          {result.evidence}
        </p>
      ) : null}

      <div className="mt-2 max-w-[200px]">
        <ConfidenceBar value={result.confidence} size="sm" />
      </div>
    </li>
  );
}
