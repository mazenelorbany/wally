// Auth-module configuration. Parsed once at import, Zod-validated, fail-fast.
//
// Self-contained on purpose: the auth module is the only consumer of these
// values, so the schema lives next to the code that reads it instead of in a
// shared config barrel. @nestjs/config (registered in AppModule) loads the
// `.env` file into process.env before this runs; here we just validate and
// freeze the slice we care about.
//
// Wally is the TRIMMED stack — no Redis, no BullMQ. Sessions are plain
// Postgres rows whose primary key (hex(randomBytes(32))) is the cookie value.

import { z } from 'zod';

/** "true" / "1" / "yes" → true; "false" / "0" / "no" → false; else default. */
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

/** Treat "" the same as unset for optional secrets. */
const optionalNonEmpty = z
  .string()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const AuthEnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  // Where the SPA lives. Magic-link consume + OAuth callback redirect the
  // browser back here once the session cookie is set; it's also the cookie's
  // effective site.
  APP_URL: z.string().url().default('http://localhost:5173'),

  // The API's own public origin. The magic-link email points HERE (not at the
  // SPA): the link is a GET that the API handles directly — it sets the
  // httpOnly session cookie and then 302s into the SPA. Defaults to the local
  // dev API. Path prefix `/api` (see main.ts setGlobalPrefix) is added by the
  // link builder, not stored here.
  API_BASE_URL: z.string().url().default('http://localhost:3001'),

  // ── Session cookie ──────────────────────────────────────────────────────
  SESSION_COOKIE_NAME: z.string().min(1).default('wally_session'),
  // Secure flag is env-driven: false over plain http in dev, true in prod.
  SESSION_COOKIE_SECURE: bool(false),
  // Session lifetime. Cookie maxAge + Session.expiresAt are kept in lockstep.
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // ── Magic links ─────────────────────────────────────────────────────────
  MAGIC_LINK_TTL_MIN: z.coerce.number().int().positive().default(20),

  // ── SMTP (magic-link delivery) — Mailhog in dev ────────────────────────
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: optionalNonEmpty,
  SMTP_PASSWORD: optionalNonEmpty,
  // Mailhog has no TLS; prod SMTP does. Defaults off for the dev path.
  SMTP_SECURE: bool(false),
  MAIL_FROM: z.string().default('wally@thecookwarecompany.com'),

  // ── Google OAuth (reviewers) — optional; blank disables SSO ─────────────
  GOOGLE_CLIENT_ID: optionalNonEmpty,
  GOOGLE_CLIENT_SECRET: optionalNonEmpty,
  // Defaults to APP_URL is wrong for the callback (it points at the API), so
  // we let it be set explicitly; falls back to the conventional API path.
  GOOGLE_CALLBACK_URL: optionalNonEmpty,
  // Optional Workspace hosted-domain restriction (e.g. "thecookwarecompany.com").
  GOOGLE_ALLOWED_DOMAIN: optionalNonEmpty,
});

export type AuthEnv = z.infer<typeof AuthEnvSchema>;

function load(): AuthEnv {
  const parsed = AuthEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Fail fast and loud — a misconfigured auth surface is never something we
    // want to limp past at boot.
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid auth environment configuration:\n${issues}`);
  }
  return Object.freeze(parsed.data);
}

/** Frozen, validated auth env. Imported wherever auth needs a config value. */
export const AuthEnv: AuthEnv = load();

/** True only when every Google OAuth credential needed to boot the strategy
 *  is present. The strategy + routes are registered conditionally on this so
 *  the API boots fine with SSO unconfigured (magic-link still works). */
export const googleOAuthConfigured = (): boolean =>
  Boolean(AuthEnv.GOOGLE_CLIENT_ID && AuthEnv.GOOGLE_CLIENT_SECRET);

/** The OAuth callback URL passport must redirect Google back to. Defaults to
 *  the conventional API route under the `/api` global prefix on API_BASE_URL
 *  when not set explicitly. Must exactly match an Authorised redirect URI in
 *  the Google Cloud console. */
export const googleCallbackUrl = (): string =>
  AuthEnv.GOOGLE_CALLBACK_URL ??
  new URL('/api/auth/google/callback', AuthEnv.API_BASE_URL).toString();

/** The magic-link URL emailed to a user. Points at the API's own consume
 *  route (under the `/api` global prefix) — a GET the API handles directly,
 *  setting the session cookie before redirecting into the SPA. */
export const magicLinkConsumeUrl = (rawToken: string): string => {
  const url = new URL('/api/auth/magic-link/consume', AuthEnv.API_BASE_URL);
  url.searchParams.set('token', rawToken);
  return url.toString();
};
