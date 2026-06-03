// Per-photo rollup — pure decision logic, ported from the Python POC (rollup.py).
// Escalation-first: anything unsure or missing → needs_review (never a silent pass).
import type {
  Criterion,
  CriterionResult,
  Flag,
  Overall,
  RollupRule,
  ScoreResult,
} from "@wally/types";

const DEFAULT_RULE: RollupRule = {
  not_good_if_any_critical_fails: true,
  good_if_only_noncritical_fails: true,
};

export interface RollupStamp {
  modelId: string;
  promptVersion: string;
  rubricVersion: string;
  rule?: RollupRule;
}

export function fixtureRollup(
  results: CriterionResult[],
  criteria: Criterion[],
  stamp: RollupStamp,
): ScoreResult {
  const byId = new Map(results.map((r) => [r.id, r]));
  const flags: Flag[] = [];
  let hasUnsure = false;
  let criticalFail = false;
  let nonCriticalFail = false;

  // Drive the loop off the rubric, so a criterion the model never graded
  // escalates instead of silently passing.
  for (const c of criteria) {
    const v = byId.get(c.id);
    if (!v || v.verdict === "unsure") {
      hasUnsure = true;
      flags.push({ id: c.id, kind: c.kind, text: c.text });
    } else if (v.verdict === "fail") {
      flags.push({ id: c.id, kind: c.kind, text: c.text });
      if (c.critical) criticalFail = true;
      else nonCriticalFail = true;
    }
  }

  // A verdict for a criterion not in the rubric is a contract violation → escalate.
  const known = new Set(criteria.map((c) => c.id));
  if (results.some((r) => !known.has(r.id))) hasUnsure = true;

  const rule = stamp.rule ?? DEFAULT_RULE;
  let overall: Overall;
  let needsReview: boolean;
  if (hasUnsure) {
    overall = "needs_review";
    needsReview = true;
  } else if (criticalFail && rule.not_good_if_any_critical_fails) {
    overall = "not_good";
    needsReview = false;
  } else if (nonCriticalFail && rule.good_if_only_noncritical_fails) {
    overall = "good";
    needsReview = false;
  } else {
    overall = "perfect";
    needsReview = false;
  }

  const confidence = results.length
    ? Math.min(...results.map((r) => r.confidence))
    : 1;

  return {
    overall,
    needsReview,
    confidence,
    flags,
    results,
    rubricVersion: stamp.rubricVersion,
    modelId: stamp.modelId,
    promptVersion: stamp.promptVersion,
  };
}

/** A pass/fail the model isn't confident about becomes "unsure" → routed to a human. */
export function applyConfidenceFloor(
  results: CriterionResult[],
  threshold: number,
): CriterionResult[] {
  return results.map((r) =>
    r.verdict !== "unsure" && r.confidence < threshold
      ? { ...r, verdict: "unsure" }
      : r,
  );
}
