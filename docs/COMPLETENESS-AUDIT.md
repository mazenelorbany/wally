# Wally Completeness Audit — Final Memo

> Generated 2026-06-05 by a 9-area multi-agent sweep (89 agents). Every finding
> below was adversarially verified against the actual code before inclusion.
> 65 confirmed gaps. The motivating bug: the store-manager Sales Log was a flat
> campaign-wide total with no date — now fixed (`soldOn`). This audit hunts the
> same *class* of oversight everywhere.

## Executive summary

The dominant pattern is a recurring **sales-log-class missing-dimension defect**: values keyed too coarsely so a new write silently overwrites instead of versioning, or read state shared across actors who each need their own. The team already recognized and fixed this once (SalesEntry gained `soldOn` + a per-day unique key), but the same shape persists unfixed across the system — FixtureCapture re-shoots overwrite prior photo+verdict in place, Task `seenAt` and BulletinAck are keyed per-store instead of per-user (one manager's open/ack clears the badge for co-managers), and every analytics surface (KPIs, leaderboard, turnaround) reports all-time/latest-state with no date window. A second dominant pattern is **broken or orphaned end-to-end wiring**: two disconnected compliance pipelines (manager FixtureCaptures never reach the report, chase, snapshot, reviewer queue, or leaderboard), the console reviewer's only mutating action permanently 400s on a wire-contract mismatch, the reviewer bench never renders because the payload key is `verdict` but the UI reads `score`, and the keystone reference-image upload simply does not exist so the AI compare runs on notes alone. A third pattern is **structural multi-tenant/lifecycle gaps reachable by ordinary admin actions**: campaign activation enforced org-wide but read per-project (activating one project's campaign silently closes another's), `inviteUser` mutating a user in another org, and no last-admin guard. Underpinning much of this is **pervasive incomplete CRUD** — products, campaigns, projects, fixtures, stores, and example images are create-only or seed-only with no edit/delete UI. Note the seed itself is broken post-migration, so several of these surfaces produce no demo data at all.

---

## High severity

### Missing-dimension (sales-log class) — fix first

**FixtureCapture stores only the latest AI verdict per (store,campaign,fixture) — re-shoots silently overwrite, no history** — Compliance & scoring loop, missing-dimension, `apps/api/src/modules/manager/manager.service.ts:723` (+ `schema.prisma:598-622`)
Evidence: keyed `@@unique([storeId,campaignId,fixtureId])`; `uploadFixturePhoto` upserts, nulling the prior verdict/notes/confidence then re-scoring, so a FAIL→reshoot→PASS sequence is erased in place — the exact `soldOn` fix the sibling SalesEntry already received.
Fix: add a `FixtureCaptureAttempt` table (capturedOn/storageKey/verdict/confidence/capturedBy), create a new attempt per upload, keep FixtureCapture as the "current" pointer — mirror the SalesEntry `soldOn` pattern.

**Activation enforces one-active-per-org but reads resolve one-active-per-project — activating one campaign silently closes another project's live one** — Campaigns & lifecycle, missing-dimension, `apps/api/src/modules/campaign/campaign.service.ts:84`
Evidence: `setActive` closes other ACTIVE campaigns org-wide with no project scope, but `resolveCampaign(orgId, projectId)` reads the project's active campaign; the seed ships two concurrently-ACTIVE campaigns on different projects, so any admin Activate flips the other project's live read path to CLOSED.
Fix: scope the `updateMany` to the target's `projectId` (handle null explicitly) and add a partial unique index on `(orgId, projectId) WHERE status='ACTIVE'`.

**Store create/update has no `projectId` — admin-created stores never join a project, vanish from venue lists, resolve the wrong campaign** — Stores & directory, missing-dimension, `apps/api/src/modules/store/store.service.ts:27,42`
Evidence: store→campaign resolution is project-scoped, but Create/UpdateStoreSchema expose no `projectId` and `store.projectId` is written only by the seed; any directory-created store is permanently project-less, never appears in `projects.venues()`, and falls through to org-level (wrong) campaign resolution in the multi-project seeded org.
Fix: add `projectId` to the Create/Update DTOs + SDK + service, with a project picker in StoreFormDialog and an org-membership check.

**Two disconnected compliance pipelines — manager FixtureCaptures never reach the report, chase, snapshot, reviewer queue, or analytics** — Cross-cutting, missing-dimension, `apps/api/src/modules/report/report.service.ts`
Evidence: the live floor-plan loop writes only FixtureCapture, but report/chase/snapshot/reviewer-console/leaderboard all read the legacy Submission/Photo/Verdict pipeline (`grep FixtureCapture` across jobs/report/review is empty); the two models share no join key. A store doing all real work on the floor plan shows an all-`not_submitted` PDF, is wrongly chased, never snapshotted, and is invisible to the reviewer queue and leaderboard.
Fix: pick the canonical model (FixtureCapture is the live one) and migrate report/chase/snapshot/reviewer-queue/leaderboard to read it (+ Placement applicability), or build a unifying read view.

**BulletinAck is keyed per-store, not per-user — one manager's ack clears "must read" for every co-manager** — Cross-cutting, missing-dimension, `apps/api/prisma/schema.prisma:669`
Evidence: `@@unique([bulletinId, storeId])`; `acknowledge()` upserts on `bulletinId_storeId` (stores `userId` but never keys on it) and `mine()` filters acks by `storeId` only — defeating the model's own stated "every store manager must read + acknowledge" intent. Same coarse-granularity class as the Task `seenAt` finding.
Fix: change the unique to `([bulletinId, userId])`, upsert on `bulletinId_userId`, compute `acknowledged` from `userId = user.id`, and count ack coverage against the manager population.

### Other high-severity

**Seed upserts SalesEntry on a unique key that no longer exists and never sets `soldOn` — seed is broken after the per-day migration** — Sales & money, data-integrity, `apps/api/prisma/seed.ts:1114`
Evidence: upserts on the removed `storeId_campaignId_productId` accessor (now `_soldOn`) and the create omits `soldOn`; the seed throws a `PrismaClientValidationError` on the first SalesEntry upsert, so no demo sales/Money-Map data is created and the day dimension is never exercised.
Fix: upsert on `storeId_campaignId_productId_soldOn`, add `soldOn` to create, and loop over several recent days so the demo shows multiple logged days.

**No admin UI wired to `createTask` — the task-assignment endpoint is dead from the web app** — Tasks & notifications, stub-or-dead, `packages/sdk/src/index.ts:814-818`
Evidence: `adminTasks.create` exists and the API endpoint is real, but `grep adminTasks apps/web/src` returns zero matches; no Studio screen/button/form creates a task, so the fully-built manager Tasks/notification loop is empty in normal use (populated only by seed/raw API).
Fix: add an "Assign task" form in the Studio store-directory/detail view posting to `adminTasks.create`, then invalidate the manager task queries.

**Console reviewer OVERRIDE permanently broken — web sends `{action, overall, note}` but the API `.strict()` DTO requires `{action, criterionId, toVerdict, reason}`** — Compliance & scoring loop, stub-or-dead, `apps/web/src/console/ReviewActions.tsx:40-46` (DTO `review.dto.ts:14-42`)
Evidence: every OVERRIDE 400s twice (unknown `overall`/`note` keys rejected by `.strict()`, plus missing `criterionId`/`toVerdict`); any CONFIRM/ESCALATE carrying a note also 400s. The mismatch is semantic (fixture-level band vs per-criterion flip), not a rename — the reviewer's only mutating action is unreachable.
Fix: align the contract end-to-end (either accept `overall`+`note` and treat OVERRIDE as a band set, or rebuild the UI to collect `criterionId`+per-criterion verdict+reason), reconcile the SDK `ReviewBody`, and add an e2e round-trip test.

**Reviewer page never shows a score — API returns `photo.verdict` but the SDK/UI read `photo.score`, and `rubricVersion`/`flags` are never sent** — Compliance & scoring loop, stub-or-dead, `apps/api/src/modules/submission/submission.service.ts:270-274,722-733`
Evidence: `getOne()` emits `verdict:` while `FixtureReviewPage` reads `photo.score` (always undefined) and gates the entire scored view (criteria, confidence, ReviewActions) behind `if (score)`, so the bench permanently shows "hasn't been scored yet"; `presentVerdict` also omits the `rubricVersion`/`flags` the page requires.
Fix: emit `score:` and include computed `rubricVersion`/`flags` in `presentVerdict` (or change the SDK type + page to read `verdict`); add a contract test asserting `SubmissionPhoto` matches `ScoreResult`.

**No way to upload the fixture reference image ("what good looks like") — the keystone the compliance compare scores against** — Floor plan, fixtures & planogram, stub-or-dead, `apps/api/src/modules/guide-fixture/guide-fixture.controller.ts:65-109`
Evidence: ExampleImage is read everywhere (signed URLs, the "What good looks like" grid, the scoring reference) but has no create/upload/delete/setBestInClass endpoint, SDK method, or UI control anywhere; for any non-seeded fixture `referenceBytes` is undefined, so every manager photo is silently "judged against the notes alone."
Fix: add ExampleImage create/remove/setBestInClass endpoints + SDK methods + an uploader/delete/star control in FixtureDetailPanel, and surface an honest "no reference set" state.

**Guide-fixture example images cannot be added, captioned, deleted, or flagged best-in-class — seed-only** — Products, guide & rubrics, incomplete-crud, `apps/api/src/modules/guide-fixture/guide-fixture.service.ts`
Evidence: the service reads ExampleImage but has no create/update/delete; `ExampleImage.create/deleteMany` exist solely in the seed; FixtureDetailPanel only displays. This blocks the VM author's core "create reference" path, which feeds the manager's compliance compare reference and gates the manager UI on `_count.exampleImages > 0`. (Same root cause as the reference-image upload finding above — one fix covers both.)
Fix: add `/guide-fixtures/:id/example-images` POST/PATCH/DELETE (NoViewer, org-scoped) + SDK + upload/caption/star/delete controls.

**`Placement.applicable` ("we don't have this fixture here") can never be toggled — schema says it lives on Placement but there is no write path** — Floor plan, fixtures & planogram, incomplete-crud, `apps/api/src/modules/floorplan/floorplan.dto.ts:7-20`
Evidence: `applicable` is read by compliance/money-map/setup counts but `UpdatePlacementSchema` allows only geometry and `createPlacement` hardcodes `applicable:true`; a store legitimately lacking a fixture has no non-destructive opt-out, so its compliance sheet shows that fixture as needing a photo forever, dragging pass-rate down. The seed itself models per-store applicable/not-applicable mixes.
Fix: add `applicable` to `UpdatePlacementSchema` + `updatePlacement`, expose via SDK, and add a "Mark not applicable" toggle in the layout editor.

**Product catalog is entirely read-only — no create/edit/archive/delete anywhere** — Products, guide & rubrics, incomplete-crud, `apps/api/src/modules/product/product.controller.ts:11-27`
Evidence: only `GET /products`; no `product.create/update/delete` anywhere in the API, SDK exposes only `products.list`, and ProductsView is a pure read grid whose empty state says "products will appear here once added." The catalog is the source of truth for merchandising placement and sales-log pricing, yet is DB/seed-only.
Fix: add Create/Update DTOs + `POST/PATCH/archive/delete` routes (ADMIN/NoViewer), an `archivedAt` column, SDK methods, and an editor/create flow in ProductsView.

**Editing a rubric to a new version silently drops the reference image (`referenceKey`) the scorer compares against** — Products, guide & rubrics, data-integrity, `apps/web/src/studio/views/RubricsView.tsx:60-89`
Evidence: the Draft type and publish body omit `referenceKey`, `startEdit` doesn't copy it, and `publish` writes `referenceKey ?? null`; so every "Edit → new version" produces `referenceKey=null` and the scorer silently grades without the visual standard — append-only and irreversible, with no UI to re-add it. The seeded fixtures all ship a populated reference, so the first edit observably strips it.
Fix: add `referenceKey` to the Draft, prefill in `startEdit`, include it in the publish body, add an upload/replace/clear control, and default to the previous version's value server-side when omitted.

**`inviteUser` upserts by globally-unique email with no org guard — an admin can silently mutate/reactivate a user in another org** — Users, org, auth & admin, data-integrity, `apps/api/src/modules/admin/admin.service.ts:50-75`
Evidence: `email` is globally `@unique`; the upsert's `update` branch rewrites role/`disabledAt`/`storeId` without checking `orgId`, so an Org-A admin inviting an email owned by Org-B mutates that foreign row and mints an Org-A magic link for it — contrast `updateUser`, which correctly scopes by `orgId`.
Fix: before the upsert, look up by email and 409 if `existing.orgId !== orgId` (and normalize email); longer term move to `@@unique([orgId,email])` + a membership model.

**No last-admin guard — the only other admin can be demoted or disabled, leaving the org with zero recoverable admin access** — Users, org, auth & admin, lifecycle-gap, `apps/api/src/modules/admin/admin.service.ts:78-107`
Evidence: `updateUser` blocks only self-demotion; with two admins, each can demote/disable the other to zero, and there is no provisioning/first-admin API, no role-promoting public auth path, and disabling kills sessions immediately — recovery requires direct DB surgery.
Fix: before a demote/disable that removes admin, count remaining active admins in the org and refuse if it would hit zero.

---

## Medium severity

### Missing-dimension (sales-log class)

**Manager Home "Sales logged" tile sums all days — no per-day/period summary, disagrees with the linked day-scoped log** — Sales & money, missing-dimension, `apps/api/src/modules/manager/manager.service.ts:225`
Evidence: `salesSummary()` aggregates with no date filter (lifetime/campaign-to-date), but the tile deep-links to SalesLogView which defaults to today and labels its total "Today · total"; the two surfaces disagree with no reconciling label. (`loggedProducts` over-counts per-day rows but is never rendered.)
Fix: pick the intended window and make Home and SalesLogView agree; relabel the tile "Campaign to date" (or show today vs campaign-to-date) and add the window label.

**Task "seen"/notification state is keyed per-store, not per-user — one manager opening Tasks clears the badge for every co-manager** — Tasks & notifications, missing-dimension, `schema.prisma:537-558` / `manager.service.ts:283-288`
Evidence: `Task.seenAt` is a single column on the shared task; `markTasksSeen` updates by `storeId` with no user predicate and the unseen badge counts `seenAt:null` store-wide, so manager #1 opening Tasks clears manager #2's badge. Same class as BulletinAck.
Fix: add a per-(task,user) read row (`TaskRead { taskId, userId, seenAt @@unique([taskId,userId]) }`); count unseen as tasks with no TaskRead for `user.id`; drop the shared `Task.seenAt`.

**`dueAt` is stored and serialized but never used — tasks are effectively undated in any UI or chase logic** — Tasks & notifications, missing-dimension, `manager.service.ts:918` / `TasksView.tsx`
Evidence: `dueAt` is persisted and round-tripped but no view renders it or an overdue marker, sorting is by `createdAt`, and the chase sweep covers submissions only — a due/overdue task is never surfaced or chased (and there's no UI to set it either).
Fix: render `dueAt` with an overdue treatment, sort OPEN tasks by it, surface an "overdue" count, and optionally extend the chase sweep to OPEN tasks past `dueAt` — or remove the field.

**No way to copy/clone a floor-plan layout between stores — every venue must be rebuilt fixture-by-fixture** — Floor plan, fixtures & planogram, missing-dimension, `apps/api/src/modules/floorplan/floorplan.service.ts:213-276`
Evidence: placements are per-(store,campaign,fixture) created one at a time, all defaulting to canvas centre; there is no copy-from-store/apply-to-all endpoint or UI. The seed fakes uniform layouts in a loop with a comment that "the real product would import each store's true layout."
Fix: add `copyLayout(orgId, campaignId, fromStoreId, toStoreId)` (idempotent on the unique key) + a "Copy layout from another store" action in the layout editor.

**Compliance snapshot cron captures only ACTIVE campaigns — a campaign's trend freezes at close and never records its final-day result** — Campaigns & lifecycle, missing-dimension, `apps/api/src/modules/jobs/snapshot.service.ts:45`
Evidence: the daily cron iterates `status:ACTIVE` only, and `setActive` silently bulk-closes others with no final snapshot, so the last automated trend point is the morning before close unless an admin manually captures that day.
Fix: capture a final snapshot inside `setActive`'s close path and/or widen the cron to include recently-CLOSED campaigns (`captureSnapshot` is already idempotent per `campaignId,dateKey`).

**All analytics KPIs, leaderboard, and distribution are all-time/latest-state only — no date window or per-period view** — Analytics & leaderboard, missing-dimension, `submission.service.ts:472-519,286-316`
Evidence: every analytics surface derives from `campaigns.queue → campaignQueue → buildStoreScore`, which loads photos with no date predicate and keeps only the newest verdict per fixture; the SDK signatures accept no window and `startsAt/endsAt` bound nothing. (A snapshot/trend subsystem exists but is fleet-aggregate only.)
Fix: thread optional `from/to` into `/queue`, `/turnaround`, `/trend` and `buildStoreScore`'s photo `where`; add a date-range/period selector and a "vs previous period" delta.

**Leaderboard has no period and no rank movement — single all-time standings despite a stored daily series** — Analytics & leaderboard, missing-dimension, `apps/web/src/studio/views/LeaderboardView.tsx:75-96`
Evidence: ranks stores purely by current all-time pass-rate with only a region filter; the daily ComplianceSnapshot series is org/campaign-aggregate (no per-store `passing`), so there's no data to compute rank delta or "most improved."
Fix: add a per-store snapshot child table (or compute period rankings from photo timestamps) + a period selector, rank-delta column, and "most improved" card.

**Rubric has no "active version" concept — publishing silently re-points the live scorer; no activation, rollback, or pin** — Products, guide & rubrics, missing-dimension, `rubric.service.ts:50-63` / `scoring.service.ts:123-125`
Evidence: every resolution site is `orderBy:{version:'desc'}` ("highest version wins"); publishing instantly becomes the live grading standard, with no `active`/`publishedAt` flag, activate endpoint, or rollback. (Past verdicts are correctly version-pinned; only the live pointer is uncontrolled.)
Fix: add an active-version pointer (or `active Boolean` unique-per-fixture), resolve the ACTIVE version in scoring, and add an activate/rollback endpoint + version-history UI.

### Other medium-severity

**Tasks cannot be edited, deleted, reassigned, or listed by admin — create is the only operation (and it has no UI)** — Tasks & notifications, incomplete-crud, `admin.controller.ts:39-46`
Evidence: only `POST .../tasks`; no PATCH/DELETE/admin-GET; `TaskStatus` is OPEN|DONE only, so a mistaken task is stuck OPEN forever or falsely "completed."
Fix: add `GET`/`PATCH`/`DELETE` admin task routes + SDK + a Studio list/edit/cancel view.

**A completed task cannot be reopened, and there is no record of who completed it or who it was assigned to** — Tasks & notifications, lifecycle-gap, `manager.service.ts:264-280`
Evidence: `completeTask` is a one-way DONE write with no inverse and no `completedBy`; assignment is store-only, so a mis-tapped completion is unrecoverable with no actor audit.
Fix: add a `reopenTask` transition (DONE→OPEN, clearing `completedAt`), `completedById`, and an optional `assignedToId`.

**FixtureCapture AI verdict has no human review/override/escalation path at all** — Compliance & scoring loop, lifecycle-gap, `manager.service.ts:781-799`
Evidence: `FixtureCapture.verdict` is written only by the scorer; the entire Review/CONFIRM/OVERRIDE/ESCALATE machinery operates exclusively on the legacy Verdict model, so a NEEDS_REVIEW capture (the loop managers actually use) never reaches a reviewer and has no who/when audit.
Fix: add reviewer fields/audit (or a FixtureCaptureReview table) + a REVIEWER/ADMIN endpoint, surface NEEDS_REVIEW captures in the console, and long-term unify the two loops.

**Reviewers/admins cannot re-request a photo or reopen/override a fixture-capture verdict — the compliance loop is one-way** — Floor plan, fixtures & planogram, lifecycle-gap, `manager.service.ts:614,738,743`
Evidence: `needsPhoto` only transitions true→false and is re-raised by nothing; the review module never touches FixtureCapture, so a reviewer can neither say "redo this" nor override the AI verdict. (Schema comments document reviewer re-flagging as the intended design.)
Fix: add a REVIEWER/ADMIN `request-photo` endpoint (sets `needsPhoto=true`, stamps requestedBy/At) and a FixtureCapture verdict-override endpoint.

**No re-score/re-open path once a verdict exists or a ScoreJob is parked FAILED** — Compliance & scoring loop, lifecycle-gap, `score-worker.service.ts:138-182`
Evidence: exhausting max attempts sets job+photo FAILED (terminal) with no re-enqueue/re-score endpoint; a photo parked after a transient outage or invalid-rubric throw is a permanent dead tile, and there's no "re-grade against newer rubric." (Override exists for already-scored photos but not FAILED ones.)
Fix: add a guarded `POST /photos/:id/rescore` that resets the job to PENDING (and photo to UPLOADED), plus an optional campaign-level "re-score against latest rubric."

**Stuck RUNNING ScoreJobs are never reclaimed — a crash mid-score parks a photo in SCORING forever** — Compliance & scoring loop, lifecycle-gap, `score-worker.service.ts:69-115`
Evidence: `claim()` selects only `status='PENDING'`; `lockedAt` is written but never read and no reaper requeues stale RUNNING jobs, so a crash after a job flips to RUNNING leaves an eternally-spinning tile — contradicting the schema comment promising a lock-lapse re-pickup.
Fix: extend `claim()`/add a sweep to also reclaim `status='RUNNING' AND lockedAt < now()-Xm` back to PENDING.

**Campaign lifecycle is a one-way ratchet — no explicit close, pause, reopen, or archive; CLOSED is only a side effect of activating another campaign** — Campaigns & lifecycle, lifecycle-gap, `campaign.controller.ts:37`
Evidence: the only state route is `:id/activate`; CLOSED is reachable only via the bulk-close side effect, so ending the last sale needs a throwaway campaign and "reopen" = re-activate (closing whatever is live).
Fix: add explicit `close`/`reopen`/`archive` (an `archivedAt` column) transitions with a modeled state machine + CampaignsView buttons.

**Campaigns are create-only — no edit/rename, date change, or delete; a typo'd key/name or wrong dates are permanent** — Campaigns & lifecycle, incomplete-crud, `packages/sdk/src/index.ts:294`
Evidence: SDK/controller expose only list/.../create/activate; the four create fields can never change after creation, and `@@unique([orgId,key])` blocks re-creating a corrected key. Every sibling admin resource ships full mutation.
Fix: add `update(name?,startsAt?,endsAt?)` + guarded `remove` (`PATCH`/`DELETE` ADMIN) + SDK + edit affordance; decide whether `key` is immutable.

**No audit trail for campaign status changes — no `updatedAt`/`activatedAt`/`closedAt`/actor** — Campaigns & lifecycle, lifecycle-gap, `schema.prisma:154`
Evidence: Campaign has only `createdAt`; `setActive` (and the bulk-close) capture no timestamp or actor, so "when did MSP2 go live / who closed it" is unrecoverable — status is the sole record. Contrast Review/SalesEntry which track actor/`updatedAt`.
Fix: add `updatedAt`/`activatedAt`/`closedAt` (set in setActive incl. the bulk-close branch) + an actor column or a small CampaignEvent log.

**Insights has no campaign selector — analytics for any closed/draft campaign are unreachable from the UI though the endpoints accept any `campaignId`** — Campaigns & lifecycle, state-ux-gap, `apps/web/src/studio/views/InsightsView.tsx:50`
Evidence: InsightsView hardcodes the active (or newest) campaign with no dropdown, yet the API serves `/:id/{trend,turnaround,queue}` for any campaign and the client already holds every campaign in `campaignsQ.data`; reviewers can't view a closed quarter's retro.
Fix: add a campaign `<select>` (reuse `console/CampaignPicker.tsx`) driving the query keys, defaulting to active.

**Campaign `startsAt`/`endsAt` are stored and surfaced but never enforced or displayed — dead window config** — Campaigns & lifecycle, stub-or-dead, `campaign.service.ts:58`
Evidence: collected, order-validated, persisted, and echoed — but no logic reads them (no auto-activate/close, no gate on sales/captures outside the window) and they're never rendered in the list; write-only and inert.
Fix: either wire `endsAt`/`startsAt` into the cron (auto-close/activate, optional window-gate on writes) or render them as advisory metadata — at minimum show them.

**Publish & notify stores is a stub — the floor-plan builder's primary action is a "coming soon" toast** — Floor plan, fixtures & planogram, stub-or-dead, `apps/web/src/studio/views/FloorPlanView.tsx:96-100`
Evidence: the top bar's primary `onPublish` is `toast.info('… coming soon.')`; there's no publish endpoint, no draft/published distinction (placements/guide-fixtures written live), and no notify fan-out — the prominent button does nothing. (Independently flagged High in the repo's UX-AUDIT.)
Fix: implement a guide/floor-plan `publishedAt` + publish endpoint that fans out Tasks/notifications to the campaign's stores and gates the manager read on published — or remove the button.

**A library fixture can be created but never edited — no rename, no kind/department change** — Floor plan, fixtures & planogram, incomplete-crud, `apps/api/src/modules/fixture/fixture.controller.ts:41-67`
Evidence: no PATCH/PUT and no edit UI; a typo'd name or wrong kind on an in-use fixture can only be fixed by delete+recreate, which cascades away every Placement/GuideFixture/FixtureProduct/FixtureCapture and is blocked by `@@unique([orgId,name])` until the old is gone.
Fix: add `UpdateFixtureSchema` (name?/kind?/department?) + `PATCH :id` (ADMIN, P2002→409) + SDK + an Edit dialog. (Same root cause as the products-guide fixture-edit/department finding — one fix covers both.)

**Fixture has no edit/rename and its `department` (drives the manager guide grouping) can never be set in-app** — Products, guide & rubrics, incomplete-crud, `fixture.dto.ts:15-22` / `GuideView.tsx:83-92`
Evidence: Create accepts only name+kind, there's no PATCH, and `department` is written only by the seed; every app-created fixture lands `department=null` and is dumped under "Store" in the manager guide.
Fix: add `department` to the create DTO and a `PATCH /fixtures/:id` (name?/kind?/department?), with an edit affordance and the field mapped through the contract.

**Placement label cannot be edited and placements cannot be reordered after creation** — Floor plan, fixtures & planogram, incomplete-crud, `floorplan.dto.ts:7-18`
Evidence: create sets `label` and `order` but `UpdatePlacementSchema`/`updatePlacement` write only geometry, so renaming a placement or reordering the manager checklist requires delete+recreate (losing geometry); checklist order is frozen at creation time.
Fix: add `label` and `order` to `UpdatePlacementSchema` + the data builder, with inline rename + drag-reorder in the layout editor.

**Store Directory cannot delete or deactivate a store — no archive/active state on the model** — Stores & directory, lifecycle-gap, `schema.prisma:123-146`
Evidence: Store has no `disabledAt`/`closedAt`/`active` (unlike User), no `@Delete`/deactivate route, and only an Edit button in the directory; a closed/mis-created store can't be retired and skews roster/snapshot counts.
Fix: add `closedAt` + an ADMIN deactivate route, filter closed stores from rosters/switchers/counts, and add Deactivate/Reactivate mirroring UsersView.

**Store segmentation dimensions (region/storeType/areaManager) are free-text with no controlled vocabulary** — Stores & directory, missing-setting, `store.dto.ts:10-13`
Evidence: arbitrary `z.string()` fields feeding analytics filters built from raw distinct values, so "NSW" vs "N.S.W." vs "nsw" each fragment the segment charts; the same codebase already implements org-scoped controlled vocabulary for Fixtures.
Fix: add per-org option lists (or a distinct-value endpoint) backing the directory fields with a combobox; normalize/trim on write.

**Notifications toggle is dead UI — local state only; chase emails fire to all admins+reviewers regardless** — Users, org, auth & admin, stub-or-dead, `apps/web/src/components/SettingsPage.tsx:25`
Evidence: the switch only flips local `useState`, with no field on User and no persistence; `ChaseService.chase()` emails every admin+reviewer unconditionally, so the one exposed preference has no backing field and no effect. (Independently flagged in UX-AUDIT.)
Fix: add `chaseEmails Boolean` to User + a GET/PATCH preferences route, wire the toggle, and filter chase recipients by it — or remove the control.

**Manual "Capture snapshot" overwrites the day's snapshot and there is no way to delete or correct a snapshot** — Analytics & leaderboard, incomplete-crud, `submission.service.ts:421-428`
Evidence: `captureSnapshot` upserts on `(campaignId,dateKey)`; a mid-day manual capture silently overwrites the canonical value with no source audit, and there's no delete/edit endpoint, so a bad/empty-day point distorting the trend can never be pruned.
Fix: add a `source` enum (CRON|MANUAL), a `DELETE /campaigns/:id/trend/:dateKey` (ADMIN), and don't let a manual capture overwrite a cron row (or store intra-day points and chart the latest).

**Project is create-only — no rename, kind change, or delete/archive** — Cross-cutting, incomplete-crud, `apps/api/src/modules/project/project.service.ts`
Evidence: only list/get/venues/create; the top-level container that owns stores/campaigns/bulletins can't be renamed, re-kinded (RETAIL vs TRADESHOW drives sort/UI), or removed, so a typo pollutes the project list forever.
Fix: add `PATCH /projects/:id` (name, kind) + `DELETE`/`archivedAt` soft-delete + SDK + a studio edit affordance, with delete guarded by an empty-or-confirmed check.

**Bulletin attachment can be set on create but never replaced or removed on update** — Cross-cutting, incomplete-crud, `apps/api/src/modules/bulletin/bulletin.service.ts`
Evidence: `create()` accepts a file and writes `attachmentKey/Name`, but `update()` takes a JSON-only `.strict()` DTO with no file field and the PATCH route has no `FileInterceptor`; a wrong PDF can only be fixed by deleting the whole bulletin (losing acks).
Fix: add `FileInterceptor` + a `removeAttachment` flag to the PATCH route/DTO; replace or null the attachment (orphan-cleaning the old key) in `update()`.

---

## Low severity

**`logSale` has no max-units guard and silently overwrites a day's units instead of accumulating, with no actor audit** — Sales & money, lifecycle-gap, `manager.service.ts:529`
Evidence: latest-wins per (store,campaign,product,day) with no `loggedByUserId`/history; `unitPrice` is re-snapshotted on every edit. (The Money-Map consumer documents these figures as illustrative until a POS feed lands; negative revenue is already impossible via the schema.)
Fix: add `loggedByUserId`, set it in create/update; don't recompute `unitPrice` for an already-logged day.

**No recurring tasks — every periodic ask must be manually re-created per campaign per store** — Tasks & notifications, missing-setting, `schema.prisma:537-558` / `admin.dto.ts:7-15`
Evidence: no recurrence/template field and create is one-shot, one store at a time; campaign activation doesn't auto-instantiate tasks. (UX-AUDIT already lists estate-scale bulk-actions as a documented "fine at demo scale" bet.)
Fix: add a TaskTemplate that spawns rows on campaign activation/cron, or a bulk "assign to all stores" endpoint, with cadence/scope in the assign UI.

**`createTask` role-guards in the service body instead of the `@Roles` decorator, unlike every sibling admin route** — Tasks & notifications, role-gap, `admin.controller.ts:39-46`
Evidence: no `@Roles('ADMIN')` decorator (the global RolesGuard no-ops without metadata); protection lives only in an inline service check — not exploitable today but invisible at the controller layer and easy to drop in a refactor.
Fix: add `@Roles('ADMIN')` to the handler; keep the inline check as defense-in-depth.

**Destructive "Mark done" has no confirmation and no error feedback; DONE is irreversible** — Tasks & notifications, state-ux-gap, `apps/web/src/store/views/TasksView.tsx:48-54,174-177`
Evidence: the complete mutation fires on a single tap with no confirm and no `onError`, so a failed completion fails silently; combined with no reopen path, a mis-tap is permanent. (A loading spinner does exist, so it's error feedback, not progress, that's missing.)
Fix: add `onError` toast handling; make DONE reversible (preferred) or add a confirm.

**Compliance threshold/pass-mark and rollup rule are not org- or campaign-configurable in UI** — Compliance & scoring loop, missing-setting, `scoring.service.ts:48-53`
Evidence: the needs-review confidence floor is a deploy-wide env var with no per-org setting or UI. (The rollup rule IS editable per-rubric in RubricsView, so only the single global floor scalar is non-configurable.)
Fix: promote `WALLY_CONFIDENCE_FLOOR` to an Org/Campaign column (env as fallback), read per-score, and surface it in admin settings.

**best-in-class toggle and reviewer decisions can be reverted with no actor record — partial who/when on state changes** — Compliance & scoring loop, data-integrity, `submission.service.ts:665-681`
Evidence: `setBestInClass` flips with no actor/timestamp (no audit at all), and Verdict has no `@updatedAt`/`lastReviewedBy`. (Overrides ARE fully audited via the immutable Review row, so the verdict half is mitigated; the BIC toggle is the real gap.)
Fix: record `curatedById/curatedAt` on the BIC toggle; add `@updatedAt` + `lastReviewedById` to Verdict.

**Fixture `department` cannot be set in-app — reads null for app-created fixtures** — Floor plan, fixtures & planogram, missing-setting, `schema.prisma:381`
Evidence: no runtime write path for `department`; seed-only. (But seeded fixtures DO carry departments, so money-map/grouping work on demo data — the "dead/breaking" framing is overstated; this is a seed-only-edit gap.) Folds into the fixture-edit fix above.
Fix: add `department` to the create/update DTO + a Department select in the fixture dialog.

**Hard-delete of a fixture cascades to live placements, guide sheets, and captures with only a soft warning** — Floor plan, fixtures & planogram, data-integrity, `fixture.service.ts:121-124`
Evidence: unguarded `deleteMany` with deep cascades destroys uploaded photos + AI verdicts + reference images; the dialog discloses blast radius and offers Archive (its own UX-AUDIT cites this as the reference good-confirmation pattern), but Archive isn't the default and there's no typed confirmation.
Fix: block delete (or require a force flag) when in use or captures-with-photos exist, steering to Archive; gate delete behind a name-match confirmation.

**Manager "New task alerts" toggle is a dead stub — local state only** — Stores & directory, stub-or-dead, `apps/web/src/store/views/ManagerSettingsView.tsx:16,50-65`
Evidence: toggles only local `useState`, no mutation/field/reader; the unseen-task badge is driven by `home().unseenTasks` regardless, and it resets to true on every mount. (Duplicate of the SettingsPage dead toggle.)
Fix: wire to a real `notifyOnNewTask` preference + endpoint, or remove the control.

**StoresView venue row dead-ends when the project has no campaign — links back to its own list** — Stores & directory, state-ux-gap, `apps/web/src/studio/views/StoresView.tsx:112-117,138`
Evidence: with no campaign the row links to `/studio/stores` (itself), so clicking reloads the same list while the CTA "Open floor plan to set up" promises navigation that doesn't happen — reachable after creating a fresh project + adding venues before a guide.
Fix: when `campaignId` is undefined, render the row non-clickable with a hint (or route to campaign creation) + a project-level empty/CTA.

**Incomplete user CRUD — no delete/remove (resend-invite already works via re-invite + public self-serve link)** — Users, org, auth & admin, incomplete-crud, `packages/sdk/src/index.ts:478-481`
Evidence: no DELETE route/method/UI, so a mistyped invited email is a permanent disabled row. (The claim's "no resend / locked-out" half is refuted: re-invite re-issues a link and `/auth/magic-link/request` is public self-serve.)
Fix: add `DELETE /admin/users/:id` (org-scoped, last-admin-guarded) + a Remove row action.

**`/studio/users` route is not ADMIN-gated — a REVIEWER can open the admin Users page by URL and gets an error state** — Users, org, auth & admin, role-gap, `apps/web/src/studio/routes.tsx:54`
Evidence: the subtree gate is `['ADMIN','REVIEWER']` and the users child adds no ADMIN guard, so a reviewer navigating directly mounts UsersView and hits a 403'd `adminUsers.list` → "Couldn't load users." (Backend correctly 403s — no data leak; only `/studio/users` actually breaks on load.)
Fix: wrap the users (and other admin) routes in `RequireRole roles={['ADMIN']}`.

**`disabledAt` is overwritten on re-disable and there's no who/when audit for role/store/disable changes** — Users, org, auth & admin, lifecycle-gap, `apps/api/src/modules/admin/admin.service.ts:97`
Evidence: every `disabled===true` re-stamps `disabledAt`, losing the original time; User has no `disabledBy`/audit/`updatedAt`, and the acting admin is never persisted. (Consumed only as a boolean and never displayed, so nothing user-visible regresses.)
Fix: only set `disabledAt` on transition; add `disabledById` + `updatedAt` or a small UserAuditLog.

**No way to remove or roll back a rubric version, and no delete for an erroneous publish** — Products, guide & rubrics, lifecycle-gap, `rubric.controller.ts:30-55`
Evidence: only GET/POST(publish); with "latest wins," a bad-but-valid publish becomes live and the only remedy is publishing yet another version (DTO already blocks empty-criteria, so that specific example can't occur).
Fix: implement the active-version pointer so rollback = re-activate an earlier version; optionally soft-`withdrawnAt`.

**Product pricing (`salePrice`/`rrp`) drives sales-log revenue but is never editable in the app** — Products, guide & rubrics, missing-setting, `product.service.ts:63-73` / `manager.service.ts:447,514`
Evidence: revenue uses `salePrice ?? rrp ?? 0` snapshotted into SalesEntry, but Product has no write path and the catalog editor omits these fields, so a wrong/marked-down price can't be corrected in-app. (Price IS shown read-only in the sales log; "invisible everywhere" is overstated.) Subset of the product-CRUD fix above.
Fix: expose `rrp`/`salePrice` in the catalog editor (with product-CRUD); consider a per-entry `unitPrice` override at log time so corrections don't rewrite history.

**Compliance trend chart only plots pass-rate; completion and band counts are stored daily but never charted** — Analytics & leaderboard, missing-dimension, `InsightsView.tsx:421-490`
Evidence: ComplianceSnapshot persists submitted/expected/onTrack/needsReview/failing/incomplete and the DTO forwards them all, but TrendChart draws only `passing/expected`; completion-over-time and band-mix are collected yet invisible.
Fix: add a metric toggle (pass-rate | completion | failing) or a stacked-band area chart from the already-present fields.

**Turnaround metrics are all-time with no window and no "unreviewed backlog" dimension** — Analytics & leaderboard, missing-dimension, `submission.service.ts:322-390`
Evidence: pulls every Review for the campaign with no date bound and counts only verdicts that WERE reviewed, so "avg time to review" improves artificially by ignoring slow/never-reviewed ones and the actionable aging-backlog number is absent.
Fix: accept `from/to` filtering `Review.createdAt`; add `awaitingReview` count + `oldestPendingAgeMinutes` from unreviewed needs-review verdicts.

**Insights and Leaderboard have no error/retry state; failed analytics fetches collapse to a misleading "no data"** — Analytics & leaderboard, state-ux-gap, `InsightsView.tsx:218-226,276-289` / `LeaderboardView.tsx:143-151`
Evidence: neither checks `isError`, so a failed fetch renders "No stores in this guide yet." instead of an error+retry; DashboardView does it correctly via `<ErrorState onRetry>`. (Pattern is shared by ~6 views, not a 2-view outlier; the non-admin trend "dead-end" copy is essentially correct given the nightly cron.)
Fix: add an `isError → <ErrorState onRetry>` branch mirroring DashboardView.

**Bulletin acknowledgement is one-way and the admin roster shows no actor** — Cross-cutting, lifecycle-gap, `apps/api/src/modules/bulletin/bulletin.service.ts`
Evidence: `acknowledge()` is upsert-or-noop with no un-ack route; the admin roster reports store-level acknowledged only (the stored `userId` is never read out), so an accidental ack is permanent and unattributable.
Fix: add a DELETE ack (self-undo/admin reset) and surface `userId`/`userName` in the ack roster.

**Bulletin `startsAt`/`endsAt` are stored and serialized but never enforced — expired/not-yet-started bulletins still show as live** — Cross-cutting, stub-or-dead, `apps/api/src/modules/bulletin/bulletin.service.ts`
Evidence: `mine()` filters only `publishedAt: { not: null }` with no window comparison, so a future-dated bulletin appears live and a past-`endsAt` one never retires. (Same dead-window class as the campaign date fields.)
Fix: in `mine()` filter/annotate by `(startsAt==null || <=now) && (endsAt==null || >=now)`; surface a scheduled/expired state.

---

## Recommended next batch

1. **Fix the broken seed** (`seed.ts:1114` SalesEntry key + `soldOn`) — it throws on first sales upsert, so the Money Map / sales-log demo currently has no data; this blocks demoing and validating several findings below. High, tiny.
2. **Reconcile the two compliance pipelines** (FixtureCapture → report/chase/snapshot/reviewer-queue/leaderboard) — a whole compliance pathway is orphaned from all downstream reporting/escalation/review; highest blast radius.
3. **Fix the reviewer bench end-to-end** — the `score`/`verdict` key + missing `rubricVersion`/`flags` (bench never renders) and the OVERRIDE wire-contract mismatch (only mutating action 400s). Two high defects on the same core reviewer surface; fix together with a contract test.
4. **Scope campaign activation to project** (`setActive` + partial unique index) — one routine admin Activate silently closes another project's live campaign in the seeded multi-project org.
5. **Add the reference-image upload + carry-forward** (ExampleImage CRUD on guide-fixtures *and* rubric `referenceKey` in the edit Draft/publish) — the AI compare's keystone can't be authored and is silently dropped on every rubric edit; one workstream covers both high findings.
6. **Add `projectId` to store create/update** + a project picker — admin-created stores are otherwise invisible and resolve the wrong campaign.
7. **Close the tenant/lifecycle holes in admin** — org-guard `inviteUser` (cross-tenant mutation) and add the last-admin guard; both are reachable with ordinary admin rights and one can brick the org.
8. **Version FixtureCapture re-shoots** (FixtureCaptureAttempt, mirroring `soldOn`) — stops silent destruction of the FAIL→reshoot→PASS audit trail and establishes the per-attempt history the per-day analytics fixes will also need.
