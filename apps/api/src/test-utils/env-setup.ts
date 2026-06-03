// Seeds process.env BEFORE any module is imported so src/common/config/env.ts
// (which parses + validates at module load and throws on missing values) is
// satisfied in the test runner. Suites may override individual vars per-test.
//
// Vitest loads this via `setupFiles` in vitest.config.ts. The scoring specs
// don't touch env at all, but anything that imports a module which transitively
// pulls in env.ts (services, controllers) would otherwise fail to import.

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://wally:wally@localhost:5434/wally_test?schema=public';
process.env.JWT_SECRET ??= 'test_jwt_secret_at_least_32_characters_long_xx';
process.env.APP_URL ??= 'http://localhost:5173';
process.env.WALLY_VISION_PROVIDER ??= 'anthropic';
process.env.WALLY_VISION_MODEL ??= 'claude-sonnet-4-6';
process.env.WALLY_CONFIDENCE_FLOOR ??= '0.7';
process.env.WALLY_STORAGE_DRIVER ??= 'local';
process.env.WALLY_STORAGE_DIR ??= './storage';
process.env.MAIL_FROM ??= 'wally@thecookwarecompany.com';
