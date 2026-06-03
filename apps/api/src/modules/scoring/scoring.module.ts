import { Module, type Provider } from '@nestjs/common';

import { AnthropicVisionProvider } from './anthropic.provider';
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
// `anthropic` is the only wired provider today (env.ts enforces the enum). The
// switch is exhaustive so adding a provider without wiring it fails the build.
// StorageModule is @Global, so StorageService injects without importing it.
// =============================================================================

const visionProvider: Provider = {
  provide: VISION_PROVIDER,
  useFactory: (): VisionProvider => {
    const choice = (process.env.WALLY_VISION_PROVIDER ?? 'anthropic').toLowerCase();
    switch (choice) {
      case 'anthropic':
        return new AnthropicVisionProvider();
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
