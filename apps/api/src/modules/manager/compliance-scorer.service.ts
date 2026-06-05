import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import type { CaptureVerdict } from '@wally/types';

// =============================================================================
// ComplianceScorer — the store-manager floor-map compliance check.
// =============================================================================
//
// Compares ONE store photo of a fixture to the VM guide's "what good looks like"
// reference image + notes and returns a verdict (PASS / NEEDS_REVIEW / FAIL),
// a confidence, and one or two short actionable sentences for the store.
//
// Two paths, picked at call time:
//   - GEMINI_API_KEY set → the Google Generative Language REST API (no SDK; a
//     plain `fetch` so we add no dependency). Model `gemini-2.5-flash`, falling
//     back to `gemini-2.0-flash`. The reply is parsed as compact JSON.
//   - no key, OR any error (network / parse / quota) → a DETERMINISTIC stub so
//     the demo always produces a plausible verdict. NEVER throws.
//
// SECURITY (CLAUDE.md): image bytes are NEVER logged — only the verdict, the
// model id, and short reasons. We read ONLY `process.env.GEMINI_API_KEY`; no
// .env file is ever opened here.
// =============================================================================

/** The inputs one compare needs. Reference image is optional — when the guide
 *  fixture has no example image we still judge the photo against the notes. */
export interface ComplianceScoreInput {
  referenceBytes?: Buffer;
  referenceMime?: string;
  photoBytes: Buffer;
  photoMime: string;
  notes: string;
  fixtureLabel: string;
}

/** The compare result the service persists onto the FixtureCapture. */
export interface ComplianceScoreResult {
  verdict: CaptureVerdict;
  confidence: number;
  notes: string;
  modelId: string;
}

// Google Generative Language REST: `gemini-2.5-flash` first, then a fallback.
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'] as const;
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// A generous-but-bounded timeout: the compare is a tiny JSON reply over two
// small images; we don't want a hung request to block the upload response.
const GEMINI_TIMEOUT_MS = 20_000;

const VERDICTS: readonly CaptureVerdict[] = ['PASS', 'NEEDS_REVIEW', 'FAIL'];

@Injectable()
export class ComplianceScorer {
  private readonly logger = new Logger(ComplianceScorer.name);

  /**
   * Score the photo against the reference + notes. Resolves to a verdict on the
   * happy path (Gemini) and ALWAYS resolves (never throws) on any failure by
   * falling back to the deterministic stub.
   */
  async score(input: ComplianceScoreInput): Promise<ComplianceScoreResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return this.stub(input);
    }
    try {
      return await this.scoreWithGemini(input, apiKey);
    } catch (err) {
      // Network / quota / parse — fall back so the demo always gets a verdict.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Gemini compliance score failed (${msg}); falling back to stub.`,
      );
      return this.stub(input);
    }
  }

  // ----- Gemini path --------------------------------------------------------

  private async scoreWithGemini(
    input: ComplianceScoreInput,
    apiKey: string,
  ): Promise<ComplianceScoreResult> {
    const instruction = buildInstruction(input);

    // contents → one user turn: instruction text, then the reference image (if
    // any), then the store photo. inline_data carries the base64 bytes + mime.
    const parts: GeminiPart[] = [{ text: instruction }];
    if (input.referenceBytes?.length) {
      parts.push({
        inline_data: {
          mime_type: input.referenceMime || 'image/jpeg',
          data: input.referenceBytes.toString('base64'),
        },
      });
    }
    parts.push({
      inline_data: {
        mime_type: input.photoMime || 'image/jpeg',
        data: input.photoBytes.toString('base64'),
      },
    });

    const body = JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    });

    // Try the primary model, then the fallback, on a request-level failure.
    let lastErr: unknown;
    for (const model of GEMINI_MODELS) {
      try {
        const text = await this.callGemini(model, apiKey, body);
        const parsed = parseGeminiVerdict(text);
        this.logger.log(
          `compliance score via ${model}: ${parsed.verdict} (conf ${parsed.confidence})`,
        );
        return { ...parsed, modelId: model };
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Gemini model ${model} failed: ${msg}`);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  /** POST one generateContent request and return the model's text reply. */
  private async callGemini(
    model: string,
    apiKey: string,
    body: string,
  ): Promise<string> {
    const url = `${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
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
    if (!res.ok) {
      // Don't echo the body verbatim (it can be large); just the status.
      throw new Error(`HTTP ${res.status}`);
    }
    const json = (await res.json()) as GeminiResponse;
    const text = json.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? '')
      .join('')
      .trim();
    if (!text) {
      throw new Error('empty response text');
    }
    return text;
  }

  // ----- stub path ----------------------------------------------------------

  /**
   * Deterministic, plausible result so the demo works with NO key (or after a
   * Gemini failure). The verdict is derived from a hash of the fixture label +
   * the photo bytes so the same photo always scores the same, and PASS is the
   * common case (a FAIL only on the rare bucket).
   */
  private stub(input: ComplianceScoreInput): ComplianceScoreResult {
    const seed = createHash('sha256')
      .update(input.fixtureLabel)
      .update(input.photoBytes)
      .digest();
    // First byte → 0..255. Bucketed so PASS dominates, NEEDS_REVIEW sometimes,
    // FAIL rarely — what a healthy floor looks like in the demo.
    const bucket = seed[0] ?? 0;
    let verdict: CaptureVerdict;
    let notes: string;
    if (bucket < 160) {
      verdict = 'PASS';
      notes =
        'Facings look aligned to the guide. Keep the hero product front and centre.';
    } else if (bucket < 224) {
      verdict = 'NEEDS_REVIEW';
      notes =
        'Mostly on-plan, but check the shelf-talker placement and tidy the front facings.';
    } else {
      verdict = 'FAIL';
      notes =
        'Setup differs from the guide — re-merchandise to match the reference and re-shoot.';
    }
    // Confidence ~0.70–0.90, stable per photo (second byte → fraction).
    const confidence = 0.7 + ((seed[1] ?? 0) / 255) * 0.2;
    return {
      verdict,
      confidence: round2(confidence),
      notes,
      modelId: 'stub',
    };
  }
}

// ----- module-level helpers (pure) ------------------------------------------

/** The compliance-check instruction. The VM notes are content, not commands. */
function buildInstruction(input: ComplianceScoreInput): string {
  const notes = input.notes?.trim() || '(no specific notes provided)';
  return (
    `You are a visual-merchandising compliance checker. Compare the STORE photo to the ` +
    `GUIDE reference for fixture '${input.fixtureLabel}'. VM notes: ${notes}. ` +
    `Decide if the store setup matches the guide. ` +
    `Reply ONLY compact JSON: ` +
    `{"verdict":"PASS|NEEDS_REVIEW|FAIL","confidence":0..1,` +
    `"notes":"one or two short actionable sentences for the store"}`
  );
}

/**
 * Parse the model's reply into a verdict. Tolerates ```json fences / stray
 * prose by extracting the first balanced JSON object. Clamps confidence into
 * [0,1] and normalises the verdict; throws if no usable verdict is present
 * (caller falls back to the stub).
 */
function parseGeminiVerdict(text: string): {
  verdict: CaptureVerdict;
  confidence: number;
  notes: string;
} {
  const json = extractJsonObject(text);
  if (!json) throw new Error('reply contained no JSON object');
  const raw = JSON.parse(json) as {
    verdict?: unknown;
    confidence?: unknown;
    notes?: unknown;
  };
  const verdict = normaliseVerdict(raw.verdict);
  if (!verdict) throw new Error(`unrecognised verdict: ${String(raw.verdict)}`);
  const confidence = clamp01(Number(raw.confidence));
  const notes =
    typeof raw.notes === 'string' && raw.notes.trim()
      ? raw.notes.trim().slice(0, 500)
      : 'Compared to the guide reference.';
  return { verdict, confidence: round2(confidence), notes };
}

function normaliseVerdict(value: unknown): CaptureVerdict | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return (VERDICTS as readonly string[]).includes(upper)
    ? (upper as CaptureVerdict)
    : null;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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

// ----- Gemini REST payload shapes -------------------------------------------

interface GeminiInlineData {
  mime_type: string;
  data: string;
}
type GeminiPart = { text: string } | { inline_data: GeminiInlineData };

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}
