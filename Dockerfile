# =============================================================================
# Wally — single-image deploy for Railway.
#
# One service serves BOTH the NestJS API and the built React SPA from the same
# origin (the session cookie is sameSite=lax, so a split web/api domain would
# be cross-site and silently drop the cookie). The web build is copied into
# <api dist>/public, which apps/api/src/main.ts serves with an SPA fallback.
#
# DB schema + base seed run as the Railway pre-deploy command (see railway.json),
# which executes inside the container with internal-network access to Postgres.
# =============================================================================
FROM node:20-slim

# Native deps: argon2 (node-gyp fallback) needs python3/make/g++; prisma + many
# TLS paths need openssl. sharp ships its own prebuilt libvips, no apt needed.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# pnpm pinned to the repo's packageManager. Installed via npm to sidestep the
# corepack signature-key issue seen on some hosts.
RUN npm install -g pnpm@9.15.0

WORKDIR /app

# Copy the whole monorepo (node_modules/dist/.env excluded via .dockerignore)
# and install with the committed lockfile for a reproducible tree.
COPY . .
RUN pnpm install --frozen-lockfile

# Generate the Prisma client. `prisma generate` doesn't connect, but the v7
# config reads env("DATABASE_URL"), so give it a throwaway value at build time.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
RUN pnpm db:generate

# Build packages -> api + web (turbo handles topological order), then fold the
# SPA into the API's served public dir. VITE_DEMO surfaces the one-click
# dev-login shortcuts in the SPA (paired with DEMO_LOGIN=1 on the API).
ENV VITE_DEMO=1
RUN pnpm build \
  && cp -r apps/web/dist apps/api/dist/public

ENV NODE_ENV=production
# Railway injects PORT; Env defaults to 3001 if unset.
EXPOSE 3001

CMD ["node", "apps/api/dist/main.js"]
