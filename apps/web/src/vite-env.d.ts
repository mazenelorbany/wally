/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin the SDK client points at. Defaults to http://localhost:3001. */
  readonly VITE_API_URL?: string;
  /** "1" in a hosted demo build to surface the one-click dev-login shortcuts. */
  readonly VITE_DEMO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
