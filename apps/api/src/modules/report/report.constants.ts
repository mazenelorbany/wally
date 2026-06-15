// Single source of truth for the low-confidence flag threshold: a scored
// capture whose AI confidence is below this is flagged for a human to review.
// Overridable via WALLY_LOW_CONFIDENCE_THRESHOLD (parsed once at load).
const fromEnv = Number(process.env.WALLY_LOW_CONFIDENCE_THRESHOLD);
export const LOW_CONFIDENCE_THRESHOLD =
  Number.isFinite(fromEnv) && fromEnv > 0 && fromEnv <= 1 ? fromEnv : 0.6;
