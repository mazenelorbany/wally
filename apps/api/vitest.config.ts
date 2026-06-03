import { defineConfig } from 'vitest/config';

// =============================================================================
// Vitest config for the API.
//
// The scoring core (rollup.ts / store-rollup.ts) is pure logic and ships with
// `*.spec.ts` suites that instantiate functions directly — no NestJS DI, no
// real DB. Keep them millisecond-fast and CI-friendly.
//
// `@wally/types` is aliased to its SOURCE so tests don't depend on the package
// having been built first. `setupFiles` seeds process.env BEFORE any module is
// imported so src/common/config/env.ts (which parses + validates at module
// load) doesn't throw when a suite imports something that transitively pulls
// it in.
// =============================================================================
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
    setupFiles: ['src/test-utils/env-setup.ts'],
    pool: 'forks',
    poolOptions: {
      // Isolate each file so module-scoped state from env.ts doesn't leak.
      forks: { singleFork: false },
    },
  },
  resolve: {
    alias: {
      '@wally/types': new URL('../../packages/types/src', import.meta.url).pathname,
    },
  },
  esbuild: {
    // NestJS relies on decorator metadata; vitest's transformer needs es2022.
    target: 'es2022',
  },
});
