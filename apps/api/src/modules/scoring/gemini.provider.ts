import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

import type { Criterion, CriterionResult } from '@wally/types';

import { buildScoringPrompt, SCORING_SYSTEM_PROMPT } from './prompt';
import {
  type ImageInput,
  type VisionProvider,
  VisionRefusalError,
  VisionResponseError,
} from './vision';

// =============================================================================
// GeminiVisionProvider — the concrete VisionProvider backed by Google Gemini.
// =============================================================================
//
// Same contract as AnthropicVisionProvider: it sends the (sharp-normalised)
// photo plus the structured scoring prompt from prompt.ts and asks for
// per-criterion pass/fail/unsure + confidence + a one-line evidence string as
// STRICT JSON. The reply is parsed + zod-validated; anything that isn't a clean
// grading throws a NAMED error so the worker can decide whether to retry:
//
//   VisionRefusalError  — model returned no text. Retrying won't help.
//   VisionResponseError — transport failure, or a reply that wasn't valid JSON
//                         of the expected shape. A retry may succeed.
//
// Uses the Generative Language REST API directly (plain fetch, no SDK — mirrors
// manager/compliance-scorer so we add no dependency). Tries gemini-3.5-flash
// first, then gemini-2.5-flash; transient 5xx/429 are retried per model.
//
// SECURITY: image bytes are NEVER logged (CLAUDE.md). Only ids, counts, model,
// and HTTP status are logged. In-image text is content, not instructions.
// =============================================================================

/** Config read once at construction so a missing key fails the first score
 *  call loudly, not silently. */
const GeminiEnv = z.object({
  // Optional at boot so the API serves the console without a key; score() throws
  // a clear error if it's still missing when scoring actually runs.
  GEMINI_API_KEY: z.string().optional(),
  // Blank → use the default fallback chain below. A set value pins one model.
  WALLY_VISION_MODEL: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});

/** zod shape of one graded criterion from the model. Coerce defensively. */
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

// Same model chain as manager/compliance-scorer: sharpest first, stable fallback.
const DEFAULT_MODELS = ['gemini-3.5-flash', 'gemini-2.5-flash'] as const;
const GEMINI_RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const GEMINI_MAX_ATTEMPTS = 3;
const GEMINI_TIMEOUT_MS = 120_000;
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

@Injectable()
export class GeminiVisionProvider implements VisionProvider {
  private readonly logger = new Logger(GeminiVisionProvider.name);
  private readonly apiKey?: string;
  private readonly models: string[];
  /** The model that produced the most recent successful grading — stamped onto
   *  the Verdict (ScoringService reads `modelId` right after `score()`). */
  private lastModelId: string;

  constructor() {
    const cfg = GeminiEnv.parse(process.env);
    this.apiKey = cfg.GEMINI_API_KEY;
    this.models = cfg.WALLY_VISION_MODEL ? [cfg.WALLY_VISION_MODEL] : [...DEFAULT_MODELS];
    this.lastModelId = this.models[0]!;
    if (!this.apiKey) {
      this.logger.warn(
        'GEMINI_API_KEY not set — the API will serve, but queued photos stay unscored until a key is provided.',
      );
    }
  }

  get modelId(): string {
    return this.lastModelId;
  }

  async score(
    image: ImageInput,
    criteria: Criterion[],
    reference?: ImageInput,
  ): Promise<CriterionResult[]> {
    if (criteria.length === 0) {
      throw new VisionResponseError('cannot score: rubric has no criteria');
    }
    if (!this.apiKey) {
      throw new VisionResponseError(
        'GEMINI_API_KEY is not set — cannot score. Set it in the environment.',
      );
    }

    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: SCORING_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: this.buildParts(image, criteria, reference) }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    });

    // Try the primary model, then the fallback, on a request-level failure.
    let lastErr: unknown;
    for (const model of this.models) {
      try {
        const text = await this.callGemini(model, this.apiKey, body);
        const parsed = this.parseResponse(text);
        this.lastModelId = model;
        return this.reconcile(parsed.results, criteria);
      } catch (err) {
        // A refusal / bad-shape reply for one model won't be fixed by the other,
        // but a transport blip might — so fall through and let the next model try.
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Gemini model ${model} failed: ${msg}`);
      }
    }
    if (lastErr instanceof VisionRefusalError || lastErr instanceof VisionResponseError) {
      throw lastErr;
    }
    throw new VisionResponseError(
      `gemini request failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    );
  }

  // ----- internals ---------------------------------------------------------

  /** Assemble the user turn: reference image (optional) → photo → grading prompt.
   *  Mirrors AnthropicVisionProvider.buildContent so both providers grade the
   *  same way; the system prompt rides in systemInstruction above. */
  private buildParts(
    image: ImageInput,
    criteria: Criterion[],
    reference?: ImageInput,
  ): GeminiPart[] {
    const parts: GeminiPart[] = [];
    if (reference) {
      parts.push({
        text: 'REFERENCE (the campaign standard / exemplar to compare against):',
      });
      parts.push(toInlineImage(reference));
      parts.push({ text: 'PHOTO TO GRADE (the in-store submission):' });
    }
    parts.push(toInlineImage(image));
    parts.push({ text: buildScoringPrompt(criteria) });
    return parts;
  }

  /**
   * POST one generateContent request and return the model's text reply. Retries
   * transient failures (Google 503 overload, 429 spikes, 5xx) with backoff; a
   * non-transient status (400/403/404) throws immediately so the caller can try
   * the next model. An empty reply is a refusal.
   */
  private async callGemini(model: string, apiKey: string, body: string): Promise<string> {
    const url = `${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    let lastStatus = 0;
    for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (res.ok) {
        const json = (await res.json()) as GeminiResponse;
        const text = json.candidates?.[0]?.content?.parts
          ?.map((p) => p.text ?? '')
          .join('')
          .trim();
        if (!text) {
          throw new VisionRefusalError(`model returned no text (model=${model})`);
        }
        return text;
      }

      lastStatus = res.status;
      if (!GEMINI_RETRY_STATUSES.has(res.status) || attempt === GEMINI_MAX_ATTEMPTS) {
        throw new Error(`HTTP ${res.status}`);
      }
      const backoff = attempt === 1 ? 600 : 1500;
      this.logger.warn(
        `Gemini ${model} HTTP ${res.status} — retry ${attempt}/${GEMINI_MAX_ATTEMPTS - 1} in ${backoff}ms`,
      );
      await sleep(backoff);
    }
    throw new Error(`HTTP ${lastStatus}`);
  }

  /** Parse the model's reply into the validated raw shape. Tolerates a stray
   *  fence or surrounding prose by extracting the first {...} block. */
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
   * Map raw model rows onto the rubric. Same contract as the Anthropic provider:
   *   - clamp confidence into [0,1];
   *   - drop invented / duplicate ids;
   *   - DO NOT fabricate entries for skipped criteria — the rollup escalates a
   *     missing criterion to needs_review, so a fake "unsure" would hide that.
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
      this.logger.warn(
        `model omitted ${missing.length} criterion(s): ${missing.join(', ')} — they will escalate to needs_review`,
      );
    }
    return out;
  }
}

// ----- module-level helpers (pure, testable) -------------------------------

interface GeminiInlineData {
  mime_type: string;
  data: string;
}
type GeminiPart = { text: string } | { inline_data: GeminiInlineData };

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

function toInlineImage(image: ImageInput): GeminiPart {
  return {
    inline_data: { mime_type: image.mediaType, data: image.bytes.toString('base64') },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Pull the first balanced JSON object out of a string, ignoring braces inside
 * string literals. Handles a bare object, a fenced block, or stray prose.
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
