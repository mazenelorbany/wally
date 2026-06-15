import { Injectable, Logger } from '@nestjs/common';

// =============================================================================
// ReportSummaryService — the AI prose summary for a store's report.
// =============================================================================
//
// A TEXT-ONLY Gemini call (no images) that turns a store's structured report
// outcome into 2–3 sentences a regional manager can skim. Mirrors the
// ComplianceScorer contract: reads ONLY config from process.env (no .env opened),
// never logs report contents beyond the model id, and NEVER throws — on any
// failure (no key, network, parse) it returns null so the report still renders
// and the UI shows "Generate".
// =============================================================================

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash-001'] as const;
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_TIMEOUT_MS = 20_000;

export interface ReportSummaryInput {
  storeName: string;
  campaignName: string;
  totalScore: number | null;
  fixtures: { label: string; verdict: string; issues: string[] }[];
  flags: {
    nonCompliant: boolean;
    lowConfidence: boolean;
    incomplete: boolean;
    notSubmitted: boolean;
  };
  questions: { label: string; answer: string }[];
}

export interface ReportSummaryResult {
  text: string;
  modelId: string;
}

@Injectable()
export class ReportSummaryService {
  private readonly logger = new Logger(ReportSummaryService.name);

  /**
   * Generate a short prose summary of the report. Returns null when no provider
   * is configured or on any error (never throws — the report must still render).
   */
  async summarize(
    input: ReportSummaryInput,
  ): Promise<ReportSummaryResult | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    try {
      return await this.callGemini(input, apiKey);
    } catch (err) {
      this.logger.warn(
        `report summary unavailable — ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async callGemini(
    input: ReportSummaryInput,
    apiKey: string,
  ): Promise<ReportSummaryResult | null> {
    const prompt = buildPrompt(input);
    const body = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
    });

    for (const model of GEMINI_MODELS) {
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
      } catch (err) {
        this.logger.warn(`summary ${model} request failed: ${String(err)}`);
        continue;
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        this.logger.warn(`summary ${model} HTTP ${res.status}`);
        continue;
      }
      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = json.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? '')
        .join('')
        .trim();
      const summary = text ? extractSummary(text) : null;
      if (summary) {
        this.logger.log(`report summary via ${model}`);
        return { text: summary, modelId: model };
      }
    }
    return null;
  }
}

/** Pull `{"summary": "..."}` out of the reply; fall back to the raw text. */
function extractSummary(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const obj = JSON.parse(text.slice(start, end + 1)) as { summary?: unknown };
      if (typeof obj.summary === 'string' && obj.summary.trim()) {
        return obj.summary.trim().slice(0, 800);
      }
    } catch {
      // fall through to raw text
    }
  }
  const trimmed = text.trim();
  return trimmed ? trimmed.slice(0, 800) : null;
}

function buildPrompt(input: ReportSummaryInput): string {
  const fixtures = input.fixtures
    .map(
      (f) =>
        `- ${f.label}: ${f.verdict}` +
        (f.issues.length ? ` (issues: ${f.issues.join(', ')})` : ''),
    )
    .join('\n');
  const questions = input.questions
    .map((q) => `- ${q.label}: ${q.answer}`)
    .join('\n');
  const flagList = [
    input.flags.nonCompliant ? 'non-compliant' : null,
    input.flags.lowConfidence ? 'low-confidence photos' : null,
    input.flags.incomplete ? 'incomplete' : null,
    input.flags.notSubmitted ? 'not submitted' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    `You are a retail visual-merchandising operations analyst. Summarise this store's ` +
    `report for a regional manager in 2-3 plain-prose sentences. Lead with the overall ` +
    `standing, name the most important problem fixtures, note any low-confidence or ` +
    `incomplete gaps, and end with the single most useful next action. No preamble, no ` +
    `lists, no markdown.\n\n` +
    `Store: ${input.storeName}\n` +
    `Campaign: ${input.campaignName}\n` +
    `Total score: ${input.totalScore != null ? `${input.totalScore}%` : 'n/a'}\n` +
    `Flags: ${flagList || 'none'}\n` +
    `Fixtures:\n${fixtures || '- none'}\n` +
    (questions ? `Answers:\n${questions}\n` : '') +
    `\nReply with ONLY this JSON: {"summary":"<your 2-3 sentence summary>"}`
  );
}
