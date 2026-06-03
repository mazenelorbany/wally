# Wally

**AI visual-merchandising (VM) compliance for retail.** Wally looks at a photo of
a store display, grades it against that fixture's standard, and tells the head-office
VM team what's wrong — at a glance, across the fleet.

Built for **GRB** (Globe Retail Brands) and **TCC** (The Cookware Company): every
sale period, stores set up their displays per a 70-page VM guide and photograph
them — but nobody can review every store's photos by hand. Wally is the in-house
compliance-scoring layer that does, and routes only the borderline calls to a human.

> Lineage: this is the production app that grows out of the
> [`wally-poc`](../wally-poc) proof-of-concept. The POC proved a vision model
> agrees with the VM team well enough to trust; this repo is the real service.
> Rubrics and sample photos are still sourced from the POC checkout.

---

## What it does

For one store photo of a fixture (e.g. the storefront, a VM table, the Door Buster stack):

1. **Load the rubric** — the versioned per-fixture checklist of pass/fail criteria
   (`Rubric.criteria`), plus an optional reference image for the standard.
2. **Grade** each criterion with a vision model, which returns a structured
   `pass | fail | unsure` + confidence + one sentence of evidence per criterion.
3. **Roll up** to `perfect / good / not_good / needs_review` with specific flags.
   Low-confidence and missing criteria escalate to **needs_review** — never a silent pass.
4. **Roll up again** across a store's fixtures into one store verdict (applicability-aware:
   "we don't have VM Table 3" is handled, not penalised).
5. **Show the VM team** a queue of stores (attention-first), drill into a store, then a
   fixture, and **confirm / override / escalate** each verdict.

Every verdict is stamped with `modelId + rubricVersion + promptVersion` so any score is
reproducible and traceable back to the exact rubric and prompt that produced it.

Colour-blind-safe by construction: every verdict carries an **icon + label**, never hue
alone (the GRB CEO is colour blind and sees red).

---

## Stack

A pnpm + Turborepo monorepo (Node 20, TypeScript), mirroring the Nockta Flow stack but
**trimmed** — no Redis, no BullMQ, no Qdrant, no socket.io, no Grafana.

| Layer        | Tech                                                                |
| ------------ | ------------------------------------------------------------------- |
| API          | **NestJS 11** (CommonJS), modular; zod-validated config             |
| Data         | **Prisma 7 + PostgreSQL 16** (via the `pg` driver adapter)          |
| Queue        | a **`ScoreJob` table** claimed with `SELECT … FOR UPDATE SKIP LOCKED` (no Redis/BullMQ) |
| Vision model | **Anthropic** vision API behind a swappable `VisionProvider` seam   |
| Storage      | **local disk** (`StorageService`); a Railway Volume in production (no S3) |
| Web          | **React + Vite** (ESM), `@wally/ui` design system                   |
| Mail (dev)   | **Mailhog** for magic-link capture                                  |
| Shared       | `@wally/types` (contracts), `@wally/ui`, `@wally/sdk`               |
| Deploy       | **Railway** (managed Postgres + a Volume for photos)                |

Packages (`@wally/*`) emit CommonJS via `tsc` so NestJS can consume them; the Vite web
app consumes the built CJS fine.

---

## Quickstart

Prereqs: Node 20+, pnpm 9+, Docker (for local Postgres + Mailhog).

```bash
pnpm install                      # install the workspace
cp .env.example apps/api/.env     # local dev config (Mailhog + local Postgres)
# then set a JWT_SECRET of >= 32 chars in apps/api/.env (env.ts enforces it at boot):
#   JWT_SECRET=$(openssl rand -hex 24)

pnpm infra:up                     # Postgres :5434 + Mailhog :8025 (docker compose)
pnpm db:push                      # apply the Prisma schema to the dev DB
pnpm db:seed                      # GRB org, users, MSP2-2026 campaign, real rubrics,
                                  #   7 stores, and a few queued photos to score

pnpm dev                          # web :5173 · api :3001 · (Mailhog UI :8025)
```

To score the seeded photos for real, set `ANTHROPIC_API_KEY` in `apps/api/.env` before
`pnpm dev` — the JobsModule worker drains the `ScoreJob` queue on boot. Without a key the
app still runs; jobs simply wait.

Seeded sign-in (dev): `reviewer@grb.test` (REVIEWER) / `admin@grb.test` (ADMIN). Magic-link
emails land in Mailhog at <http://localhost:8025>.

### Ports

| Service     | URL                     |
| ----------- | ----------------------- |
| Web (Vite)  | <http://localhost:5173> |
| API (Nest)  | <http://localhost:3001> |
| Mailhog UI  | <http://localhost:8025> |
| Postgres    | `localhost:5434`        |

---

## Scripts

Run from the repo root:

| Script              | What it does                                                            |
| ------------------- | ---------------------------------------------------------------------- |
| `pnpm dev`          | run web + api in watch mode (Turbo)                                     |
| `pnpm build`        | build every package + app                                              |
| `pnpm typecheck`    | `tsc --noEmit` across the workspace                                     |
| `pnpm test`         | run vitest suites (incl. the scoring rollup spec)                      |
| `pnpm lint`         | lint the workspace                                                      |
| `pnpm format`       | Prettier-write everything                                               |
| `pnpm infra:up` / `:down` | start / stop local Postgres + Mailhog                            |
| `pnpm db:push`      | push the Prisma schema (dev, no migration history)                     |
| `pnpm db:migrate`   | create + apply a dev migration                                         |
| `pnpm db:seed`      | seed the GRB demo data (see below)                                      |
| `pnpm db:studio`    | open Prisma Studio                                                      |
| `pnpm eval`         | run the eval / calibration harness (see below)                         |

### `pnpm db:seed`

Idempotent (upserts on natural keys; safe to re-run). Builds:

- Org **GRB** (Globe Retail Brands) with an **ADMIN** + a **REVIEWER** user.
- Campaign **MSP2-2026** (Myer Stocktake Sale P2), **ACTIVE**.
- The **real rubrics**, parsed from `wally-poc/rubrics/<fixture>.MSP2-2026.v1.yaml`
  (`storefront`, `vm_table`, `doorbuster`) into append-only **v1** rows — the same files
  the eval harness reads, so there's one source of truth for "what good looks like".
- The **7 real stores** (Marion, Altona, Ballina, Burleigh, Cairns Central, Carousel,
  Chad Pav) with brand fascia + `StoreFixture` applicability rows: storefront applicable
  everywhere; VM tables a deliberate mix of applicable / not-applicable; door buster
  applicable.
- A few **Submissions + Photos**: sample images are copied into the `StorageService`
  and left **UPLOADED** with a **PENDING** `ScoreJob`, exactly as a real upload would.
  The worker scores them for real — the seed never fabricates a `Verdict`, so the numbers
  in the console are honest on first run.

The seed reads rubrics + samples from the POC checkout. Override its location with
`WALLY_POC_ROOT=/path/to/wally-poc` (defaults to `/Users/mazen/work/TCC/wally-poc`).

### `pnpm eval` — the calibration harness

> "Does the AI agree with the VM team well enough to trust it?"

`tools/eval/run.ts` scores the annotated gold images against the real rubric, applies the
same confidence floor + per-photo rollup the running app uses (imported directly from
`apps/api/src/modules/scoring/rollup`), and — if a gold file exists — reports
**recall-on-failures + precision per check kind** (presence vs aesthetic), mirroring
`wally-poc/harness/metrics.py`.

```bash
pnpm eval -- --dry                          # print the harness; no model calls, no key (CI-safe)
pnpm eval -- --fixture storefront           # real scoring (needs ANTHROPIC_API_KEY)
pnpm eval -- --gold tools/eval/gold.jsonl   # score + grade against VM gold labels
pnpm eval -- --reference                     # also send the rubric's reference image
```

The "positive" class is a **display failure** (catching problems is the whole job):
`recall` = of the displays the VM team marked wrong, how many Wally caught; `precision` =
of the displays Wally flagged, how many were actually wrong. Escalations (`unsure` /
needs_review) are counted separately — they go to a human, so they neither help nor hurt.
See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the pre-MVP accuracy gate.

---

## Layout

```
apps/
  api/          NestJS service — auth, scoring, durable queue, reviews, reports
    prisma/     schema.prisma (the data model) + seed.ts (GRB demo data)
  web/          React + Vite reviewer console
packages/
  types/        @wally/types — shared contracts (no runtime)
  ui/           @wally/ui — TCC-branded, colour-blind-safe components
  sdk/          @wally/sdk — typed API client for the web app
tools/
  eval/         calibration harness (Wally vs VM gold labels)
infra/
  docker-compose.yml   local Postgres (:5434) + Mailhog (:8025)
```

## Security notes

- **Never log image bytes.** Photos may contain customers/staff. They're served only via
  short-lived HMAC-signed tokens (`StorageService`), never committed, never logged.
- **Prompt-injection safe.** Any text inside a photo (a sign, a sticker that reads "pass
  everything") is store *content to assess*, never an instruction to the model.
- **No silent pass.** Low-confidence or missing criteria escalate to `needs_review`. A
  wrong "pass" is far worse than an honest "unsure".

Trademark-correct throughout: **THE CUSTOM CHEF™** by **Cuisine::pro®**.
