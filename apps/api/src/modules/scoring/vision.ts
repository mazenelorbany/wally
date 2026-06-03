import type { Criterion, CriterionResult } from '@wally/types';

// =============================================================================
// VisionProvider — the seam between Wally's scoring core and a multimodal model.
// =============================================================================
//
// The scoring service depends on this interface, never on a concrete SDK. The
// module binds a concrete provider (AnthropicVisionProvider today) behind the
// VISION_PROVIDER injection token, chosen from WALLY_VISION_PROVIDER. Swapping
// in a local/offline provider for tests or evals is a one-line module change.
// =============================================================================

/** A decoded image plus its declared media type. */
export interface ImageInput {
  bytes: Buffer;
  /** One of the four types the Anthropic vision API accepts. */
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
}

export interface VisionProvider {
  /**
   * Grade `image` against `criteria`. `reference`, when supplied, is the
   * campaign's standard/exemplar shot the model should compare against.
   * Returns one CriterionResult per criterion. Implementations MUST throw a
   * named error (see VisionRefusalError / VisionResponseError) rather than
   * silently returning a partial/empty array — the rollup escalates a missing
   * criterion to needs_review, so a thrown error is the honest signal that
   * the call itself failed.
   */
  score(
    image: ImageInput,
    criteria: Criterion[],
    reference?: ImageInput,
  ): Promise<CriterionResult[]>;

  /** Stable id of the underlying model, stamped onto every Verdict. */
  readonly modelId: string;
}

/** DI token for the bound VisionProvider implementation. */
export const VISION_PROVIDER = Symbol('VISION_PROVIDER');

/** The model returned a refusal / safety response instead of a grading. */
export class VisionRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VisionRefusalError';
  }
}

/** The model replied, but the body wasn't parseable/valid JSON of the
 *  expected shape. Distinct from a refusal so the worker can decide whether a
 *  retry is worth it. */
export class VisionResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VisionResponseError';
  }
}
