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
// OllamaVisionProvider — the concrete VisionProvider backed by a LOCAL model.
// =============================================================================
//
// Talks to an Ollama daemon (default http://localhost:11434) over its /api/chat
// endpoint, sending the (sharp-normalised) photo plus the structured scoring
// prompt from prompt.ts and asking for per-criterion pass/fail/unsure as STRICT
// JSON. `format: 'json'` makes Ollama constrain decoding to valid JSON, so the
// reply is parseable; we still validate with zod and throw a *named* error on
// anything that isn't a clean grading, exactly like the Anthropic provider:
//
//   VisionRefusalError  — daemon produced no usable text (refusal / empty).
//   VisionResponseError — replied but the body wasn't valid JSON of the
//                         expected shape, or the request itself failed.
//
// This is the "local/offline provider" the vision.ts seam was built to accept:
// no cloud key, no image bytes leaving the machine. Default model is a
// vision-capable Qwen2.5-VL; override with WALLY_VISION_MODEL.
//
// SECURITY: image bytes are NEVER logged (CLAUDE.md). Only ids, counts, and the
// done_reason are logged. In-image text is treated as content by the prompt.
// =============================================================================

/** Config this provider reads from the environment. Parsed once at construction. */
const OllamaEnv = z.object({
  // Where the Ollama daemon listens. No trailing slash; we append paths.
  OLLAMA_HOST: z.string().url().default('http://localhost:11434'),
  // A vision-capable local model. Must be `ollama pull`ed already.
  WALLY_VISION_MODEL: z.string().default('qwen2.5vl:7b'),
  // Local inference is slower than a hosted API; give it room but stay bounded
  // so a wedged daemon can't hang the worker forever.
  WALLY_VISION_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
});

/** zod shape of one graded criterion as it comes back from the model. Coerced
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

/** Shape of the /api/chat reply we read. */
const OllamaChatResponse = z.object({
  message: z.object({ content: z.string() }).optional(),
  done_reason: z.string().optional(),
});

@Injectable()
export class OllamaVisionProvider implements VisionProvider {
  private readonly logger = new Logger(OllamaVisionProvider.name);
  private readonly host: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor() {
    const cfg = OllamaEnv.parse(process.env);
    this.host = cfg.OLLAMA_HOST.replace(/\/+$/, '');
    this.model = cfg.WALLY_VISION_MODEL;
    this.timeoutMs = cfg.WALLY_VISION_TIMEOUT_MS;
    this.logger.log(
      `local vision via Ollama @ ${this.host} (model=${this.model})`,
    );
  }

  get modelId(): string {
    // Stamp the verdict with the local model + a marker so a reviewer can tell
    // an offline grading apart from a hosted one.
    return `ollama:${this.model}`;
  }

  async score(
    image: ImageInput,
    criteria: Criterion[],
    reference?: ImageInput,
  ): Promise<CriterionResult[]> {
    if (criteria.length === 0) {
      throw new VisionResponseError('cannot score: rubric has no criteria');
    }

    const messages = this.buildMessages(image, criteria, reference);
    const text = await this.chat(messages);
    if (!text) {
      throw new VisionRefusalError('model returned no text');
    }

    const parsed = this.parseResponse(text);
    return this.reconcile(parsed.results, criteria);
  }

  // ----- internals ---------------------------------------------------------

  /**
   * Build the chat messages. Ollama carries images as an `images: [base64]`
   * array on the user turn (no data-URI prefix, no media type — the daemon
   * sniffs it). Reference first (if any), then the photo, then the grading
   * instruction text. The system prompt is its own turn.
   */
  private buildMessages(
    image: ImageInput,
    criteria: Criterion[],
    reference?: ImageInput,
  ): OllamaMessage[] {
    const images: string[] = [];
    const lines: string[] = [];

    if (reference) {
      lines.push(
        'The FIRST image is the REFERENCE (the campaign standard / exemplar to compare against).',
      );
      lines.push('The SECOND image is the PHOTO TO GRADE (the in-store submission).');
      images.push(reference.bytes.toString('base64'));
    } else {
      lines.push('The attached image is the PHOTO TO GRADE.');
    }
    images.push(image.bytes.toString('base64'));

    lines.push('');
    lines.push(buildScoringPrompt(criteria));

    return [
      { role: 'system', content: SCORING_SYSTEM_PROMPT },
      { role: 'user', content: lines.join('\n'), images },
    ];
  }

  /** POST one /api/chat request and return the assistant's text reply. */
  private async chat(messages: OllamaMessage[]): Promise<string> {
    const body = JSON.stringify({
      model: this.model,
      messages,
      stream: false,
      // Constrain decoding to valid JSON so the reply is parseable.
      format: 'json',
      // Deterministic-ish grading: same photo should score the same.
      options: { temperature: 0 },
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.host}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      // Daemon down / DNS / abort. Surface as a response error so the worker
      // retries with backoff.
      const msg = err instanceof Error ? err.message : String(err);
      throw new VisionResponseError(`ollama request failed: ${msg}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      // Don't echo the body verbatim; just the status.
      throw new VisionResponseError(`ollama request failed: HTTP ${res.status}`);
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new VisionResponseError(`ollama reply was not JSON: ${msg}`);
    }
    const reply = OllamaChatResponse.safeParse(json);
    if (!reply.success) {
      throw new VisionResponseError('ollama reply had an unexpected shape');
    }
    return (reply.data.message?.content ?? '').trim();
  }

  /** Parse the model's reply into the validated raw shape. With format:'json'
   *  this is usually clean, but tolerate a stray fence / prose just in case. */
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
   * Map raw model rows onto the rubric. Same contract as the Anthropic
   * provider: clamp confidence, drop invented/duplicate ids, and DO NOT
   * fabricate entries for skipped criteria — a missing criterion must escalate
   * to needs_review in the rollup, not be hidden behind a fake "unsure".
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

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
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
