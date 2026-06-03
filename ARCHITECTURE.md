# Wally — Architecture

Wally grades store visual-merchandising (VM) photos against versioned rubrics, rolls the
results up to a store verdict, and routes the borderline calls to a human reviewer. This
doc covers the system shape, the data model, the durable-queue scoring pipeline, what was
**trimmed** vs the Nockta Flow reference stack and why, the failure modes, and the
eval / pre-MVP accuracy gate.

---

## 1. System map

```
                              ┌─────────────────────────────────────────────┐
   Store manager              │                  apps/web                    │
   (phone, future)            │           React + Vite reviewer console      │
        │ photo               │   Queue ▶ Store ▶ Fixture review             │
        ▼                     │   (confirm / override / escalate)            │
  ┌───────────┐               └───────────────────┬──────────────────────────┘
  │ Submission│                                   │ @wally/sdk (typed client)
  │  + Photos │                                   │  session cookie
  └─────┬─────┘                                   ▼
        │                     ┌─────────────────────────────────────────────┐
        │  enqueue            │                  apps/api  (NestJS)          │
        │                     │                                             │
        ▼                     │  Auth ─ magic link (Mailhog) · Google OAuth │
  ┌───────────┐  claim        │  Org · Store · Campaign · Rubric            │
  │ ScoreJob  │◀──SKIP LOCKED─┤  Submission · Review · Report (PDF)         │
  │  (queue)  │               │                                             │
  └─────┬─────┘               │  JobsModule ── tick ──▶ ScoringModule       │
        │ photo bytes         │                              │              │
        │ (signed token)      │                              ▼              │
        ▼                     │                     VisionProvider (seam)   │
  ┌───────────┐               │                              │              │
  │  Storage  │───bytes──────▶│                     AnthropicVisionProvider │──▶ Anthropic
  │  (disk)   │               │                              │                   vision API
  └───────────┘               │                     rollup → Verdict        │
                              └───────────────────┬──────────────────────────┘
                                                  │
                                                  ▼
                              ┌─────────────────────────────────────────────┐
                              │            PostgreSQL 16 (Prisma 7)          │
                              │   Org/User/Session · Store/Campaign/Rubric   │
                              │   Submission/Photo · ScoreJob · Verdict      │
                              └─────────────────────────────────────────────┘

   tools/eval/  ── offline calibration harness (Wally vs VM gold labels) ──┐
                   imports the SAME rollup the API uses ────────────────────┘
```

There is **no Redis, no message broker, no vector DB**. The `ScoreJob` table *is* the
queue; Postgres is the only stateful dependency (plus a disk for photos and Mailhog for
dev email).

---

## 2. Data-flow: one photo, end to end

```
1. UPLOAD     store manager (or seed) creates a Submission + Photo.
              bytes → StorageService.put() → storageKey; Photo.status = UPLOADED.
              a ScoreJob row is inserted (status PENDING, runAfter = now).

2. CLAIM      JobsModule ticks on a schedule. It claims due jobs with
              SELECT … FOR UPDATE SKIP LOCKED  ── so N API instances never
              double-score the same photo without any external lock service.
              Photo.status → SCORING, ScoreJob.status → RUNNING, attempts++.

3. SCORE      ScoringService loads the pinned Rubric (campaign+fixture+version),
              reads the photo bytes from Storage, and calls the VisionProvider:
                  provider.score(image, criteria, reference?)  →  CriterionResult[]
              one verdict per criterion: pass | fail | unsure + confidence + evidence.

4. FLOOR      applyConfidenceFloor(results, WALLY_CONFIDENCE_FLOOR):
              any pass/fail below the floor is rewritten to "unsure"  → escalate.
              (No silent pass: a low-confidence call goes to a human.)

5. ROLLUP     fixtureRollup(results, criteria, stamp)  →  ScoreResult:
                - any unsure / missing criterion ............. needs_review
                - else any CRITICAL fail ..................... not_good
                - else any non-critical fail ................. good
                - else ....................................... perfect
              The loop is driven off the RUBRIC, so a criterion the model never
              returned escalates instead of silently passing.

6. PERSIST    a Verdict row is written, STAMPED with
                  modelId + rubricVersion(=rubricId/version) + promptVersion
              so any score is reproducible. Photo.status → SCORED,
              ScoreJob.status → DONE. On a thrown provider error: attempts++,
              backoff via runAfter; after the cap, ScoreJob.status → FAILED
              (surfaced, never silently dropped).

7. STORE      storeRollup(fixtureOutcomes) folds a store's fixtures into one
              StoreScore, applicability-aware:
                - "we don't have VM Table 3"  → not_applicable (not penalised)
                - applicable but no photo     → not_submitted  → store incomplete
                - any fixture needs_review / any missing → store needs_review

8. REVIEW     the console shows the queue attention-first. A reviewer confirms,
              overrides, or escalates — recorded as a Review row (audit trail),
              never mutating the original Verdict.
```

Escalation-first is the core invariant: **a wrong "pass" is far worse than an honest
"unsure".** Confidence floor + rubric-driven rollup both enforce it.

---

## 3. Data model

(Defined in [`apps/api/prisma/schema.prisma`](./apps/api/prisma/schema.prisma).)

```
Org ─┬─< User ──< Session                 identity / tenancy
     │      └──< Review                    org_id on every tenant table
     ├─< Store ─< StoreFixture             per-store fixture applicability
     ├─< Campaign ─< Rubric                append-only versioned rubrics
     └─< Submission ─< Photo ─┬─ ScoreJob  the durable queue (1:1 with Photo)
                              └─ Verdict   ─< Review

MagicLinkToken  (sha256-hashed, single-use, short TTL)  — passwordless store-manager auth
```

Decisions baked into the schema:

- **`orgId` on every tenant-scoped table** — multi-retailer from day one (TCC audits more
  than one retailer).
- **Rubrics are append-only versioned rows** — editing a rubric publishes a new
  `(campaignId, fixtureKey, version)` row; a Verdict FKs the exact `Rubric` it was graded
  against. You can always re-derive what "good" meant at score time.
- **`StoreFixture` carries applicability** — `applicable: false` is a first-class state, so
  "this store doesn't have that table" isn't a failure and isn't a missing-photo gap.
- **`ScoreJob` is the queue** — `status / attempts / lockedAt / runAfter` give at-least-once
  delivery, backoff, and a visible dead-letter (`FAILED`) without Redis/BullMQ.
- **Every `Verdict` is stamped** with `modelId`, the rubric version (via `rubricId`), and
  `promptVersion` — reproducibility is a schema-level guarantee, not a convention.
- **`MagicLinkToken.tokenHash` is sha256, single-use** — the raw token only ever lives in
  the emailed link.

---

## 4. Trimmed vs Nockta Flow — and why

Wally mirrors Flow's stack (NestJS + Prisma + React/Vite, modular, guard-based auth,
scheduler-lock worker) but deliberately drops Flow's heavier infra. Wally is a focused
internal reviewer tool over a fleet of ~tens of stores, not a high-throughput SaaS.

| Flow component        | Wally          | Why it's gone                                                                 |
| --------------------- | -------------- | ----------------------------------------------------------------------------- |
| **Redis**             | ✗              | No cache/pub-sub/session-store need; Postgres covers sessions + the queue.    |
| **BullMQ**            | ✗ → `ScoreJob` | Job volume is low and bursty (a sale period); a Postgres table with `SKIP LOCKED` is simpler, durable, and inspectable in SQL. |
| **Qdrant**            | ✗              | No semantic search / embeddings in scope. Rubrics are explicit checklists, not retrieved. |
| **socket.io**         | ✗              | Scoring is async-batch; the console polls / refetches. No live cursor needs.  |
| **Grafana**           | ✗              | Structured pino logs + the `FAILED` job lane + the eval harness are enough at this scale. |
| **S3 / object store** | disk / Volume  | `StorageService` writes to disk; on Railway a Volume mounts at `WALLY_STORAGE_DIR`. A driver swap is one class. |

What's kept from Flow because it pulls real weight: **driver-adapter Prisma** (Prisma 7),
**zod-validated config with a production boot guard**, **guard-based auth** (session +
roles), the **scheduler-driven worker with a DB-level claim**, and the **provider seam** so
the vision model is swappable.

> Prisma 7 note: the connection URL is **not** in `schema.prisma` anymore (Prisma 7 forbids
> `url = env()` in the datasource block). The CLI reads it from
> [`apps/api/prisma.config.ts`](./apps/api/prisma.config.ts); the runtime reads it through
> the `PrismaPg` adapter in `PrismaService`. One env var (`DATABASE_URL`), two readers.

---

## 5. Failure modes (and how Wally handles each)

| Failure                                   | Handling                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Model **refuses** / returns non-JSON      | `VisionRefusalError` / `VisionResponseError` thrown (never a silent empty array). Job retries with backoff; after the cap → `FAILED`. |
| Model **omits a criterion**               | Rollup is rubric-driven: a missing criterion is treated as `unsure` → `needs_review`. Never a silent pass. |
| Model is **low-confidence**               | `applyConfidenceFloor` rewrites it to `unsure` → escalated to a human.                             |
| **Prompt injection** (text in the photo)  | System prompt: text inside the image is store *content to assess*, never an instruction. Model is told never to obey it. |
| **Crash mid-score** (worker dies)         | The job was only `RUNNING` with a `lockedAt`; a stale lock is reclaimable, so the photo is re-scored. Idempotent: a new Verdict replaces the old. |
| **Two workers, one photo**                | `SELECT … FOR UPDATE SKIP LOCKED` — only one claims it; the other skips. No external lock service. |
| Store marks **every fixture n/a**         | `storeRollup` throws `ApplicabilityError` — nothing to grade is a loud error, not a silent "pass". |
| Photo **bytes leaked in logs**            | Structurally prevented: Storage only logs keys + sizes; pino redacts auth/cookie headers; bytes are served only via short-lived HMAC-signed tokens. |
| `ANTHROPIC_API_KEY` missing in prod       | Boot guard refuses to start (scoring is the product) — fails loud at boot, not per-job.            |

---

## 6. Eval & the pre-MVP gate

The whole bet is: **does Wally agree with the VM team well enough to trust it?** That's not
raw accuracy — it's *catching the displays the VM team would flag* without crying wolf.

[`tools/eval/run.ts`](./tools/eval/run.ts) is the offline harness. It:

1. loads the **real rubric** (same YAML the seed loads),
2. scores the annotated gold images with the real `AnthropicVisionProvider`,
3. applies the **same** confidence floor + `fixtureRollup` the running app uses (imported
   directly from `apps/api/src/modules/scoring/rollup`), and
4. if a gold file exists, reports **recall + precision per check kind**, where the positive
   class is a **display failure**:

```
recall    = of the displays the VM team marked WRONG, how many Wally caught
precision = of the displays Wally FLAGGED,           how many were actually wrong
escalated = Wally answered "unsure" → handed to a human (not an auto decision)
```

Presence checks (objective: "is the A3 call-out present?") and aesthetic checks
(subjective: "does colour have rhythm?") are scored **separately** — they have different
trust bars.

**Pre-MVP gate.** Before Wally auto-decides anything fleet-wide:

- First establish a **human–human baseline**: have two VM reviewers grade the same set; the
  gap between them is the ceiling Wally is allowed to chase.
- Wally's **presence recall must clear that baseline** (catch the real problems at least as
  reliably as a second human would), at an acceptable precision.
- Until it does, Wally runs in **assist mode** — it flags and ranks, a human decides. The
  escalation lane (`needs_review`) and the `Review` audit trail are what make assist-mode
  safe: nothing is auto-actioned that a human didn't confirm.

Run it:

```bash
pnpm eval -- --dry                          # print the harness; no model, no key (CI-safe)
pnpm eval -- --fixture storefront           # real scoring (needs ANTHROPIC_API_KEY)
pnpm eval -- --gold tools/eval/gold.jsonl   # score + grade against VM gold labels
```

Gold labels are VM-graded photos and may contain people — they live outside the repo
(gitignored). `tools/eval/gold.example.jsonl` shows the format.
