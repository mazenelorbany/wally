// =============================================================================
// Prisma 7 CLI config.
// =============================================================================
//
// Prisma 7 removed `url = env("DATABASE_URL")` from the datasource block in
// schema.prisma. The *runtime* connection now comes through a driver adapter in
// PrismaService (PrismaPg); the *CLI* (generate / db push / migrate / studio /
// seed) reads its connection from this file instead.
//
// The Prisma CLI does NOT auto-load .env for the config file (it runs with
// dotenv:false), so we load apps/api/.env ourselves before reading
// DATABASE_URL. `prisma db push` / `migrate` / `studio` then talk to the local
// Postgres on :5434 from infra/docker-compose.yml.
// =============================================================================

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { defineConfig, env } from 'prisma/config';

// Load apps/api/.env into process.env if present (CI may export DATABASE_URL
// directly, in which case there's nothing to load). process.loadEnvFile is
// available on Node 20.12+/22; guard it so an older runtime still works when
// the var is already exported.
const envPath = join(__dirname, '.env');
if (existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envPath);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',

  // Required by migration / introspection commands (db push, migrate, studio).
  datasource: {
    url: env('DATABASE_URL'),
  },

  migrations: {
    // `pnpm db:seed` runs this; also re-seeds after `migrate reset` /
    // `db push --force-reset`.
    seed: 'tsx prisma/seed.ts',
  },
});
