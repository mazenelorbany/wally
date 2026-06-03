// Calibration metrics — a direct port of the POC's harness/metrics.py.
//
// The "positive" class is a *failure* (a display problem), because catching
// problems is the whole job (see wally-poc/docs/CALIBRATION.md):
//
//   recall    = of the displays the VM team marked wrong, how many Wally caught
//   precision = of the displays Wally flagged wrong, how many were actually wrong
//
// Verdicts Wally escalated (needs_review / unsure) are counted separately, not
// as auto decisions — they go to a human, so they neither help nor hurt these two.

import type { VerdictValue } from "@wally/types";

/** A VM gold label is only ever pass or fail (a human's ground-truth call). */
export type GoldLabel = "pass" | "fail";

/** What the model effectively decided for one criterion. `unsure` == escalated. */
export type WallyLabel = VerdictValue;

export class Counts {
  tp = 0; // gold fail, wally fail  (caught)
  fp = 0; // gold pass, wally fail  (false alarm)
  fn = 0; // gold fail, wally pass  (missed)
  tn = 0; // gold pass, wally pass  (correct ok)
  escalated = 0; // wally unsure — no auto decision

  add(gold: GoldLabel, wally: WallyLabel): void {
    if (wally === "unsure") {
      this.escalated += 1;
      return;
    }
    const goldFail = gold === "fail";
    const wallyFail = wally === "fail";
    if (goldFail && wallyFail) this.tp += 1;
    else if (!goldFail && wallyFail) this.fp += 1;
    else if (goldFail && !wallyFail) this.fn += 1;
    else this.tn += 1;
  }

  total(): number {
    return this.tp + this.fp + this.fn + this.tn + this.escalated;
  }
}

export function recall(c: Counts): number | null {
  const denom = c.tp + c.fn;
  return denom ? c.tp / denom : null;
}

export function precision(c: Counts): number | null {
  const denom = c.tp + c.fp;
  return denom ? c.tp / denom : null;
}

/** Format a rate as a whole percent, or "n/a" when there's nothing to measure. */
export function fmtPct(x: number | null): string {
  return x === null ? "n/a" : `${Math.round(x * 100)}%`;
}
