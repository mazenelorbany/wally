/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin the SDK client points at. Defaults to http://localhost:3001. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
