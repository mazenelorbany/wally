import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

// Load apps/api/.env before validating. In production (Railway) the vars are
// real env vars and no .env exists, so this is a no-op. Mirrors prisma.config.ts.
const __envPath = join(process.cwd(), '.env');
if (!process.env.DATABASE_URL && existsSync(__envPath) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(__envPath);
}

// =============================================================================
// Single source of truth for runtime environment variables.
// Parsed once at module load — fail fast on missing/invalid values.
//
// Shape mirrors the project root .env.example (copied to apps/api/.env for
// local dev). Wally is the TRIMMED stack: no Redis, no Qdrant, no Sentry.
// =============================================================================

const optionalNonEmpty = z
  .string()
  .optional()
  .or(z.literal(''))
  .transform((v) => (v && v.length > 0 ? v : undefined));

// Plain z.coerce.boolean() treats every non-empty string as true, so "false"
// would become true. This helper parses booleans the way humans expect.
const bool = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return defaultValue;
      const lower = v.toLowerCase();
      if (lower === 'true' || lower === '1' || lower === 'yes') return true;
      if (lower === 'false' || lower === '0' || lower === 'no') return false;
      return defaultValue;
    });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Database — Postgres on high port 5434 (see infra/docker-compose.yml).
  DATABASE_URL: z.string().url(),

  // Auth.
  JWT_SECRET: z.string().min(32),
  SESSION_COOKIE_NAME: z.string().default('wally_session'),
  SESSION_COOKIE_SECURE: bool(false),
  MAGIC_LINK_TTL_MIN: z.coerce.number().int().positive().default(20),

  // SPA origin. Used for CORS allow-list and magic-link redirect base.
  APP_URL: z.string().url().default('http://localhost:5173'),

  // Google OAuth (reviewers). Leave blank in dev to fall back to dev-login.
  GOOGLE_CLIENT_ID: optionalNonEmpty,
  GOOGLE_CLIENT_SECRET: optionalNonEmpty,

  // Vision model (scoring core). `anthropic` (hosted Claude), `gemini` (hosted
  // Google, GEMINI_API_KEY), or `ollama` (a local, offline, vision-capable
  // model — no cloud key, bytes stay on-box).
  WALLY_VISION_PROVIDER: z.enum(['anthropic', 'gemini', 'ollama']).default('anthropic'),
  ANTHROPIC_API_KEY: optionalNonEmpty,
  // Default model depends on the provider; the provider applies its own default
  // when this is unset (claude-sonnet-4-6 for anthropic, gemini-3.5-flash for
  // gemini, qwen2.5vl:7b for ollama).
  WALLY_VISION_MODEL: optionalNonEmpty,
  // Ollama daemon endpoint (used only when WALLY_VISION_PROVIDER=ollama).
  OLLAMA_HOST: z.string().url().default('http://localhost:11434'),
  // Verdicts below this confidence are forced to needs_review (no silent pass).
  WALLY_CONFIDENCE_FLOOR: z.coerce.number().min(0).max(1).default(0.7),
  // Floor-map compliance compare (manager loop) uses Gemini when set and the
  // vision provider isn't ollama; otherwise a deterministic stub.
  GEMINI_API_KEY: optionalNonEmpty,

  // Mail (magic links) — Mailhog in dev (SMTP :1025, web UI :8025).
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: optionalNonEmpty,
  SMTP_PASSWORD: optionalNonEmpty,
  MAIL_FROM: z.string().default('wally@thecookwarecompany.com'),

  // Photo storage. local = disk (apps/api/storage); railway = Volume mount.
  WALLY_STORAGE_DRIVER: z.enum(['local', 'railway']).default('local'),
  WALLY_STORAGE_DIR: z.string().default('./storage'),

  // Production only: directory holding the built SPA (apps/web/dist), served
  // from this same service. Unset in dev (the SPA runs on its own Vite server);
  // the Docker build copies the SPA to <api dist>/public, the default lookup.
  WALLY_WEB_DIR: optionalNonEmpty,
});

export type EnvType = z.infer<typeof EnvSchema>;

// =============================================================================
// Placeholder values that must NEVER ship to a real environment.
//
// These are the literal strings from .env.example. If a deployer copies the
// example into a real .env and forgets to fill JWT_SECRET, the API would sign
// session tokens with a predictable secret — an attacker forging tokens is one
// search away. The boot guard refuses to start in `production` when any match,
// naming the offending var so a sleepy ops engineer knows the line to fix.
// =============================================================================
const PLACEHOLDER_VALUES: Record<string, string[]> = {
  JWT_SECRET: ['dev_change_me_please'],
};

function bootGuard(env: EnvType): void {
  if (env.NODE_ENV !== 'production') return;

  const violations: { name: string; hint: string }[] = [];
  for (const [name, placeholders] of Object.entries(PLACEHOLDER_VALUES)) {
    const value = (env as Record<string, unknown>)[name];
    if (typeof value === 'string' && placeholders.includes(value)) {
      violations.push({
        name,
        hint: 'Generate a strong random secret (>=32 chars) and set it in your production .env.',
      });
    }
  }

  // Vision scoring is the product, but the providers are built to serve the
  // console without a key (AnthropicVisionProvider warns at construction and
  // only throws when a score actually runs; the floor-map compliance loop falls
  // back to GEMINI_API_KEY or a stub). So a missing key is a loud WARNING, not a
  // hard boot failure — this lets the deploy come up and become fully functional
  // the moment a key (ANTHROPIC_API_KEY, or GEMINI_API_KEY for the compliance
  // loop) is added to the environment. JWT placeholders below still hard-fail.
  const hasVisionKey =
    env.WALLY_VISION_PROVIDER === 'ollama' || !!env.ANTHROPIC_API_KEY || !!env.GEMINI_API_KEY;
  if (!hasVisionKey) {
    // intentional — boot log.
    console.warn(
      '[boot] No vision key set (ANTHROPIC_API_KEY / GEMINI_API_KEY). The console ' +
        'will serve, but scoring + floor-map compliance stay unavailable until one is added.',
    );
  }

  if (violations.length === 0) return;

  // intentional — boot log; the process exits, never reached via HTTP.
  console.error('Refusing to start: production .env contains placeholder or missing values.');
  for (const v of violations) console.error(`  - ${v.name}: ${v.hint}`);
  throw new Error('Environment boot guard failed — see logs above');
}

function parseEnv(): EnvType {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    // intentional — boot log; the process exits, never reached via HTTP.
    console.error('Environment validation failed:');
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    throw new Error('Environment validation failed — see logs above');
  }
  bootGuard(result.data);
  return result.data;
}

export const Env: EnvType = parseEnv();
