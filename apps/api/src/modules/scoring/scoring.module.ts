import { Module, type Provider } from '@nestjs/common';

import { AnthropicVisionProvider } from './anthropic.provider';
import { GeminiVisionProvider } from './gemini.provider';
import { OllamaVisionProvider } from './ollama.provider';
import { ScoringService } from './scoring.service';
import { VISION_PROVIDER, type VisionProvider } from './vision';

// =============================================================================
// ScoringModule — binds the scoring core and its vision backend.
// =============================================================================
//
// The concrete VisionProvider is chosen from WALLY_VISION_PROVIDER and bound
// behind the VISION_PROVIDER token. ScoringService depends only on the token,
// never on a concrete SDK, so swapping a provider (or a fake for evals/tests)
// is a one-line change here.
//
// Wired providers: `anthropic` (Claude), `gemini` (Google), `ollama` (local).
// env.ts enforces the enum; the switch is exhaustive so an unwired value throws.
// StorageModule is @Global, so StorageService injects without importing it.
// =============================================================================

const visionProvider: Provider = {
  provide: VISION_PROVIDER,
  useFactory: (): VisionProvider => {
    const choice = (process.env.WALLY_VISION_PROVIDER ?? 'anthropic').toLowerCase();
    switch (choice) {
      case 'anthropic':
        return new AnthropicVisionProvider();
      case 'gemini':
        // Google Gemini via the Generative Language REST API (GEMINI_API_KEY).
        return new GeminiVisionProvider();
      case 'ollama':
        // Local/offline vision — no cloud key, image bytes never leave the box.
        return new OllamaVisionProvider();
      default:
        // env.ts already constrains the enum, but fail loudly if it ever drifts
        // — a missing provider must never silently degrade scoring.
        throw new Error(`unknown WALLY_VISION_PROVIDER: "${choice}"`);
    }
  },
};

@Module({
  providers: [ScoringService, visionProvider],
  // Export both: the JobsModule worker calls ScoringService; tests/evals may
  // want the bound VisionProvider directly.
  exports: [ScoringService, VISION_PROVIDER],
})
export class ScoringModule {}
