import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

// =============================================================================
// Vite config — @wally/web.
//
// Aliases resolve the workspace packages to SOURCE during dev so we get HMR
// across @wally/ui and @wally/sdk edits without a rebuild step. The built CJS
// `dist` is still what ships from the packages, but pointing Vite at src keeps
// the inner loop fast and type-accurate.
//
// Vitest 2 bundles its own (older-major) Vite typings, which conflict with the
// app's Vite when fed through `vitest/config`'s `defineConfig`. We instead use
// Vite's own `defineConfig` (matching the React plugin) and attach the runner's
// `test` block through a typed shim — so the config stays one file without a
// cross-version type clash. Vitest reads the `test` field at runtime regardless.
// =============================================================================

/** The subset of Vitest's inline config we use, kept local to avoid importing
 *  vitest's mismatched Vite typings here. */
interface VitestTestConfig {
  globals?: boolean;
  environment?: 'node' | 'jsdom' | 'happy-dom' | 'edge-runtime';
  setupFiles?: string[];
}

const test: VitestTestConfig = {
  globals: true,
  environment: 'jsdom',
  setupFiles: ['./vitest.setup.ts'],
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/react-router-dom/')) return 'router';
          if (id.includes('node_modules/@tanstack/react-query/')) return 'query';
          return null;
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@wally/types': path.resolve(__dirname, '../../packages/types/src'),
      '@wally/sdk': path.resolve(__dirname, '../../packages/sdk/src'),
      '@wally/ui': path.resolve(__dirname, '../../packages/ui/src'),
    },
  },
  // Attached outside the typed object literal so it isn't checked against Vite's
  // `UserConfig` overload (which doesn't know about `test`).
  ...({ test } as Record<string, unknown>),
});
