import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

import type { Criterion, CriterionResult } from '@wally/types';

import {
  buildScoringPrompt,
  SCORING_SYSTEM_PROMPT,
} from './prompt';
import {
  type ImageInput,
  type VisionProvider,
  VisionRefusalError,
  VisionResponseError,
} from './vision';

// =============================================================================
// AnthropicVisionProvider — the concrete VisionProvider backed by Claude.
// =============================================================================
//
// Sends the (sharp-normalised) photo plus the structured scoring prompt from
// prompt.ts and asks for per-criterion pass/fail/unsure + confidence + a
// one-line evidence string, as STRICT JSON. The response is parsed and
// validated with zod; anything that isn't a clean grading throws a *named*
// error so the worker can decide whether a retry is worthwhile:
//
//   VisionRefusalError  — model declined / returned a safety stop. Retrying the
//                         same image+prompt won't help → the worker should fail.
//   VisionResponseError — model replied but the body wasn't valid JSON of the
//                         expected shape (truncation, fence, hallucinated ids).
//                         A transient blip, so a retry may succeed.
//
// SECURITY: image bytes are NEVER logged (CLAUDE.md). Only ids, counts, and the
// stop_reason are logged. In-image text is treated as content by the prompt,
// not as instructions to the model.
// =============================================================================

/** Config this provider reads from the environment. Parsed once at construction
 *  so a missing key fails the first score call loudly, not silently. */
const AnthropicEnv = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required for the anthropic vision provider'),
  WALLY_VISION_MODEL: z.string().default('claude-sonnet-4-6'),
  // Plenty of headroom for a handful of criteria; the response is small JSON.
  WALLY_VISION_MAX_TOKENS: z.coerce.number().int().positive().default(1024),
});

/** zod shape of one graded criterion as it comes back from the model. We coerce
 *  defensively: clamp confidence into [0,1], lower-case the verdict. */
const RawCriterionResult = z.object({
  id: z.string().min(1),
  verdict: z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .pipe(z.enum(['pass', 'fail', 'unsure'])),
  confidence: z.coerce.number(),
  evidence: z.string().default(''),
});

const RawScoreResponse = z.object({
  results: z.array(RawCriterionResult),
});

@Injectable()
export class AnthropicVisionProvider implements VisionProvider {
  private readonly logger = new Logger(AnthropicVisionProvider.name);
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor() {
    const cfg = AnthropicEnv.parse(process.env);
    this.client = new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY });
    this.model = cfg.WALLY_VISION_MODEL;
    this.maxTokens = cfg.WALLY_VISION_MAX_TOKENS;
  }

  get modelId(): string {
    return this.model;
  }

  async score(
    image: ImageInput,
    criteria: Criterion[],
    reference?: ImageInput,
  ): Promise<CriterionResult[]> {
    if (criteria.length === 0) {
      // A rubric with no criteria is a config error upstream; refuse rather
      // than call the model with nothing to grade.
      throw new VisionResponseError('cannot score: rubric has no criteria');
    }

    const content = this.buildContent(image, criteria, reference);

    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        // Deterministic-ish grading: we want the same photo to score the same.
        temperature: 0,
        system: SCORING_SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
      });
    } catch (err) {
      // SDK / transport failure (network, 429, 5xx). Surface as a response
      // error so the worker retries with backoff.
      const msg = err instanceof Error ? err.message : String(err);
      throw new VisionResponseError(`anthropic request failed: ${msg}`);
    }

    // A non-`end_turn` stop with no usable text usually means a refusal.
    const text = this.extractText(message);
    if (!text) {
      throw new VisionRefusalError(
        `model returned no text (stop_reason=${message.stop_reason ?? 'unknown'})`,
      );
    }

    const parsed = this.parseResponse(text);
    return this.reconcile(parsed.results, criteria);
  }

  // ----- internals ---------------------------------------------------------

  /** Assemble the multimodal user turn: reference image (optional) → photo →
   *  the structured grading prompt. */
  private buildContent(
    image: ImageInput,
    criteria: Criterion[],
    reference?: ImageInput,
  ): UserContentBlock[] {
    const blocks: UserContentBlock[] = [];

    if (reference) {
      blocks.push({
        type: 'text',
        text: 'REFERENCE (the campaign standard / exemplar to compare against):',
      });
      blocks.push(toImageBlock(reference));
      blocks.push({
        type: 'text',
        text: 'PHOTO TO GRADE (the in-store submission):',
      });
    }

    blocks.push(toImageBlock(image));
    blocks.push({ type: 'text', text: buildScoringPrompt(criteria) });
    return blocks;
  }

  /** Concatenate the text blocks of the assistant turn. */
  private extractText(message: Anthropic.Message): string {
    return message.content
      .filter(
        (block): block is Anthropic.TextBlock => block.type === 'text',
      )
      .map((block) => block.text)
      .join('')
      .trim();
  }

  /** Parse the model's reply into the validated raw shape. Tolerates a stray
   *  ```json fence or surrounding prose by extracting the first {...} block. */
  private parseResponse(text: string): z.infer<typeof RawScoreResponse> {
    const json = extractJsonObject(text);
    if (!json) {
      throw new VisionResponseError('model reply contained no JSON object');
    }
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new VisionResponseError(`model reply was not valid JSON: ${msg}`);
    }
    const result = RawScoreResponse.safeParse(raw);
    if (!result.success) {
      throw new VisionResponseError(
        `model JSON did not match the expected shape: ${result.error.message}`,
      );
    }
    return result.data;
  }

  /**
   * Map raw model rows onto the rubric. Defends the rollup's contract:
   *   - clamp confidence into [0,1];
   *   - keep only criteria the rubric actually asked for (drop invented ids);
   *   - DO NOT fabricate entries for criteria the model skipped — the rollup
   *     intentionally escalates a missing criterion to needs_review, and a
   *     silent fake "unsure" here would hide that the model misbehaved.
   *
   * We log (ids only, never bytes) when the model under- or over-answered so a
   * reviewer can see why a verdict escalated.
   */
  private reconcile(
    rows: z.infer<typeof RawCriterionResult>[],
    criteria: Criterion[],
  ): CriterionResult[] {
    const allowed = new Set(criteria.map((c) => c.id));
    const seen = new Set<string>();
    const out: CriterionResult[] = [];

    for (const row of rows) {
      if (!allowed.has(row.id)) {
        this.logger.warn(`model returned unknown criterion id "${row.id}" — ignoring`);
        continue;
      }
      if (seen.has(row.id)) {
        this.logger.warn(`model returned duplicate criterion id "${row.id}" — keeping first`);
        continue;
      }
      seen.add(row.id);
      out.push({
        id: row.id,
        verdict: row.verdict,
        confidence: clamp01(row.confidence),
        evidence: row.evidence.slice(0, 500),
      });
    }

    const missing = criteria.filter((c) => !seen.has(c.id)).map((c) => c.id);
    if (missing.length > 0) {
      // Honest signal, not a fabricated pass: the rollup turns these into
      // needs_review because they're absent from the results array.
      this.logger.warn(
        `model omitted ${missing.length} criterion(s): ${missing.join(', ')} — they will escalate to needs_review`,
      );
    }
    return out;
  }
}

// ----- module-level helpers (pure, testable) -------------------------------

/** The content-block shapes we put in a user turn. SDK 0.32.1 exports the
 *  individual *Param block types but not a single `ContentBlockParam` union, so
 *  we compose the two we actually send (text + image) ourselves. */
type UserContentBlock = Anthropic.TextBlockParam | Anthropic.ImageBlockParam;

function toImageBlock(image: ImageInput): Anthropic.ImageBlockParam {
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: image.mediaType,
      data: image.bytes.toString('base64'),
    },
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Pull the first balanced JSON object out of a string, ignoring braces inside
 * string literals. Handles a bare object, a ```json fenced block, or an object
 * wrapped in stray prose. Returns null if no object is found.
 */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
