# Wally UX Findings Memo

## 1. Top-line read

Wally's three role-shells (studio / console / store) are **architecturally sound and feature-rich** — the core compliance loop (author guide → photograph → AI-score → review → report) works end-to-end, the design system is disciplined (colour-blind-safe verdicts, clean React Query patterns), and most views are genuinely complete. The problems are concentrated in three themes that punch above their count: **(a) the admin/CRUD layer is hollow** — campaigns, rubrics, stores, users, org settings, and task lifecycle all have working backends but zero UI, so the product can't actually be operated without raw API calls or DB writes; **(b) a security-relevant permission gap** — `RolesGuard` is never applied to any controller, so every `@Roles('ADMIN')` decorator across 12+ controllers is unenforced, and the frontend simultaneously shows REVIEWERs admin-only buttons; **(c) pervasive feedback/state gaps** — there is no toast system anywhere, ~10 query surfaces silently swallow errors, and the highest-profile button in the app ("Publish & notify stores") is a `window.alert()` stub. The single most valuable work is **building the missing admin surfaces (campaigns, rubrics, users, stores) and fixing the auth guard**; the cheapest high-value work is **wiring error states + a toast primitive and removing the misleading "Coming soon" labels**.

A note on scope honesty: studio is desktop-first by design (fixed sidebar, no mobile drawer), so several "mobile" findings on studio analytics are low priority. The mobile findings that matter are on the store-manager phone app and the capture flow, which *are* mobile-first.

---

## 2. Prioritised punch-list by theme

### Theme A — Permissions & security (highest impact; correctness + trust)

The backend's role enforcement is decorative, and the frontend shows controls that the (intended) backend would reject. These are the only findings touching security correctness.

| Gap | Sev | Effort | Recommendation (file) |
|---|---|---|---|
| **`RolesGuard` is never applied to any controller** — every `@Roles('ADMIN')` on 12+ controllers is unenforced; any authenticated user (incl. REVIEWER) can hit fixture create/delete, campaign snapshot, etc. | High | M | Apply `RolesGuard` globally (or via `@UseGuards` on each controller carrying `@Roles`). Verify against `submission.controller.ts:108`, `fixture.controller.ts:42/56/63/77/89`. This is the root cause behind the "permission leak" UI findings below — fix it first. |
| REVIEWER sees ADMIN-only fixture controls (Add fixture, Package/manage-defaults, Trash) that 403 on submit | High | S | Gate buttons with `user?.role === 'ADMIN'` in `FixturesView.tsx:74–137`; pattern already used in `Sidebar.tsx`, `InsightsView.tsx`. |
| REVIEWER sees "New project" button that fails silently (no `onError`) | Med | S | Hide button for non-ADMIN in `ProjectsView.tsx:54`; also surface mutation errors. |
| REVIEWER admitted to all of `/studio` (incl. fixture authoring) when their job is `/console` | Med | M | Decide the model: either restrict `/studio` to ADMIN (`studio/routes.tsx:32`) and keep REVIEWER in `/console`, or add a read-only mode that hides all mutation controls for REVIEWER. |
| **VIEWER role is half-wired**: in types + backend `NoViewerGuard`, but no route, no home (sent to `/studio` which then rejects it → redirect loop risk), no dev-login entry, no settings label | Med | M | Either remove VIEWER end-to-end, or add a read-only route tree + `homeForRole` entry (`auth.tsx:92`) + dev quick-link (`LoginPage.tsx`). |

*Reference patterns confirmed correct:* `InsightsView.tsx:264` ("Capture snapshot" is properly `isAdmin`-gated on the client) — but note its backend endpoint is still unenforced per the guard bug above.

### Theme B — Missing admin/CRUD surfaces (highest impact; the product can't be run)

Backends exist and are role-decorated; SDK and UI don't expose them. This is the largest cluster and the biggest "is this actually shippable" risk. De-duplicated from ~15 overlapping findings.

| Gap | Sev | Effort | Recommendation (file) |
|---|---|---|---|
| **No campaign create / activate / lifecycle UI** — `POST /campaigns`, `POST /campaigns/:id/activate` exist; SDK exposes only reads; campaigns are seed-only | High | L | Add `campaigns.create()` + `campaigns.setActive()` to SDK (`packages/sdk/src/index.ts:229`); build `/studio/campaigns` view (list w/ DRAFT/ACTIVE/CLOSED, create form, "Set active"). Backend ready (`campaign.controller.ts:22–41`). |
| **No rubric authoring / versioning UI** — `GET/POST /campaigns/:id/rubrics` with full versioning exist; no SDK methods, no route. Admins can't set the grading criteria the whole loop scores against. | High | L | Add rubric SDK client + `/studio/:campaignId/rubrics` editor (criteria, critical flag, roll-up rule, reference images, publish-as-new-version). Backend ready (`rubric.controller.ts`, `rubric.dto.ts`). |
| **No user invite / role management UI** — provisioning is magic-link/DB-only; no list, invite, reassign, or revoke | High | L | Add `admin/users` endpoints (list/invite/patch/deactivate) + `/studio/users` directory. Today only `adminTasks.create()` exists in SDK. |
| **No store create / metadata edit UI** — `POST /stores` exists; `region`/`areaManager`/`storeType` (used for segmentation) are DB-only, no `PATCH`. StoresView is read-only. | High | M | Add `stores.list/create/update` to SDK; add create + edit (region/manager/type) to `StoresView.tsx`. Note `CreateStoreSchema` currently accepts only name/brand/externalRef. |
| No org profile/branding settings — `GET/PATCH /org` exist; SDK has no `org` client; `orgId` never displayed | Med | S–M | Add `org.get/update` to SDK; add an Org section to `SettingsPage.tsx`. |
| No task lifecycle mgmt — only `POST /admin/stores/:storeId/tasks`; no cancel/modify/extend (`PATCH`/`DELETE /tasks/:id` missing). Admins can't fix a mis-issued task. | Med | M | Add task PATCH/DELETE endpoints + SDK + an admin tasks list w/ edit/retract. |
| **Admin task-create capability exists in SDK + backend but has NO UI surface at all** — admins literally cannot send a task to a store from the app | Med | M | Add a "Create task" dialog (kind/title/body/fixtureKey/dueAt) to ConsolePage or StoreDetailPage, wired to `api.adminTasks.create()`. |
| No per-store fixture applicability toggle — `Placement.applicable` exists and renders read-only ("n/a here"), but `UpdatePlacementSchema` excludes it; no UI to mark "we don't have VM table 3" | Med | S–M | Add `applicable` (+ optional per-store `label`) to the placement PATCH schema and a context-menu toggle on `FixtureBox`/`FixtureDetailPanel`. |
| No project delete/archive — create-only; fixtures already model soft-delete, projects don't | Med | S | Add `DELETE /projects/:id` (soft-archive) + SDK + delete action on ProjectCard, mirroring the fixture archive pattern. |
| No product catalog CRUD; empty-state copy ("products will appear here once added") falsely implies you can add them | Med | M | Either add product create/import UI, or fix the misleading copy and document import-only. |
| Fixture default-product sets exist but aren't discoverable — Package icon is hover-only, icon-only, no tooltip; no prompt to set defaults at creation | Low | S | Add tooltip + an inline hint when a fixture has no defaults (`FixturesView.tsx:122`). |

### Theme C — Incomplete / stub flows (high visibility)

| Gap | Sev | Effort | Recommendation (file) |
|---|---|---|---|
| **"Publish & notify stores" is a `window.alert()` no-op** — the most prominent primary button in studio; no publish endpoint, no notify pipeline, no `publishedAt`, no manager-facing "guide updated" notice | High | L | Build `POST /campaigns/:id/publish` (mark published + enqueue manager notifications via the existing task pattern) + SDK + replace alert with a real mutation/dialog + success toast (`FloorPlanView.tsx:94`, `TopBar.tsx:82`). If it must stay stubbed short-term, at minimum replace `alert()` with an app-native Dialog. |
| Notification preference toggles (admin + manager) are UI-only `useState`, no persistence, revert on reload | High* | M | Add `notificationsEnabled`/prefs to User, `PATCH /auth/preferences`, wire both `SettingsPage.tsx:19` and `ManagerSettingsView.tsx:16` to a mutation — or hide behind "coming soon" until backend exists. *Rated high by adversarial pass as a false affordance; could be deferred by hiding the toggle.* |
| Per-criterion verdict override — backend `review.dto.ts` supports `criterionId`+`toVerdict`; SDK `ReviewBody` and `ReviewActions.tsx:8` expose fixture-band override only | Med | M | Add per-criterion override mode to ReviewActions + extend `ReviewBody`. |
| Escalation has no destination/routing — `ESCALATE` is audit-only; no recipient picker, no escalation queue, no state tracking | Med–High | M | Add `escalatedTo`/escalation state to schema + a destination selector in ReviewActions + a pending-escalations view. (Adversarial pass flagged this as effectively breaking the intended escalation workflow → treat closer to High.) |
| Dead code: `ComingSoonView.tsx:54–97` exports stub `MoneyMapView/DashboardView/InsightsView` never imported (real impls routed instead) | Med | S | Delete the three stub exports; keep only the `ComingSoon` component. |
| Dashboard labelled "Coming soon" in `HomeView.tsx:62` despite being fully built and routed; sidebar shows it as live → contradictory | Med | S | Remove `comingSoon: true` (the view ships estate KPIs, distribution, attention list). |

### Theme D — Feedback & states (broad, mostly cheap)

There is **no toast/snackbar primitive anywhere in the app**; this is the upstream cause of most of these. Recommend building one small `useToast` provider, then the per-site fixes collapse to one-liners.

**D1 — Missing error states (silent failures).** Pattern is established (`ErrorState` in `components/states.tsx`, used in ConsolePage/ProductsView/FixturesView); these views just skip the `isError` branch and fall through to a misleading empty state or blank screen.

| Gap | Sev | Effort | File |
|---|---|---|---|
| **ManagerHome** — no error branch; renders misleading "No store assigned" on fetch failure (critical landing path) | High | S | `ManagerHome.tsx:33` |
| **ManagerFloorView** — three queries, no `isError` on any; floor map is primary capture surface | High | M | `ManagerFloorView.tsx:49` |
| SalesLogView, TasksView, ManagerProductsView, GalleryView, DashboardView — each missing `isError` → blank/empty on failure | Med | S each | `SalesLogView.tsx:86`, `TasksView.tsx:55`, `ManagerProductsView.tsx:50`, `GalleryView.tsx:95`, `DashboardView.tsx:42` |
| FixtureProductsDialog inner queries spin forever on error | Low | M | `FixturesView.tsx:410/466` |
| CaptureSlot shows raw API error text verbatim (e.g. "Failed to fetch") | Med | S | `CaptureSlot.tsx:119` |

**D2 — Missing success/confirmation feedback.** All blocked on the toast primitive.

| Gap | Sev | Effort | File |
|---|---|---|---|
| No feedback on reviewer Confirm/Override (local "Decision recorded" only; no advance to next fixture) | Med | M | `ReviewActions.tsx:31` |
| No feedback when manager marks task done | Med | S | `TasksView.tsx` |
| No feedback after photo upload completes in capture | Med | S | `CaptureSlot.tsx:73` |
| No persistent per-line "Saved" in Sales Log (global state masks per-line saves on rapid entry) | Med | S | `SalesLogView.tsx:140` |
| No feedback on add/remove fixture, drag-move, add/remove/prepopulate merchandise | Med | S each | `FloorPlanView.tsx:44`, `FixtureBox.tsx`, `FixtureDetailPanel.tsx:320/367/426` |
| Report PDF / store-switch / queue auto-poll have no completion or "live" indicator | Low | S each | `StoreDetailPage.tsx:182`, `TopBar.tsx:42`, `ConsolePage.tsx:71` |

**D3 — Destructive actions without confirmation / consistency.**

| Gap | Sev | Effort | File |
|---|---|---|---|
| Planogram shelf delete uses native `window.confirm()` (only one in the app; Dialog pattern exists in `FixturesView` DeleteFixtureDialog) | Med | S | `PlanogramEditor.tsx:150` |
| Discard offline capture — direct `onRemove()`, no confirm (easy mis-tap on phone) | Med | S | `CaptureSlot.tsx:137` |
| Remove merchandise from planogram — direct `remove.mutate()`, no confirm/undo | Med | S | `FixtureDetailPanel.tsx:426` |
| ESCALATE submits with no confirm | Low | S | `ReviewActions.tsx:98` |
| ReviewActions form not fully disabled during `pending` (textarea/mode buttons editable → double-submit risk) | Med | S | `ReviewActions.tsx:105` |

**D4 — Empty states (plain `<p>` instead of the existing `EmptyState` component).** All Small. `ProjectsView.tsx:61` (renders blank grid — slightly worse than the rest), `StoresView.tsx:56`, `LeaderboardView.tsx:147`, `InsightsView.tsx:222`, `StoreDetailPage.tsx:116`, `HomeView.tsx:113`, `ChaseList`/`ConsolePage` loading sidebar.

### Theme E — Accessibility (mostly Small, several High for keyboard/colour)

The design system *claims* colour-blind safety (icon+label) and has a focus-ring standard (`focus-visible:ring-2 ring-ink/30`), but several surfaces violate both. Global CSS only applies focus rings to form inputs, not buttons — so any custom `<button>` without an explicit ring is invisible on focus.

| Gap | Sev | Effort | File |
|---|---|---|---|
| **Floor plan canvas (`role="application"`) has zero keyboard handlers** — fixtures can only be moved by pointer drag; keyboard/AT users locked out (WCAG 2.1.1) | High | M | Add arrow-key nudge + Enter/Space select, or drop `role=application` and make boxes tab-focusable. `FloorPlanCanvas.tsx:18`, `FixtureBox.tsx:42` |
| **ConsolePage section dot uses colour only** ("Needs attention" vs "Cleared") — violates app's own policy; StoreRow's width-based bar is the correct pattern | High | S | Add icon/label or use structural marker. `ConsolePage.tsx:142` |
| **Leaderboard podium ranks 2 vs 3 differ by colour only** (both `text-graphite`); rank number is `aria-hidden` | High | S | Distinct icons/labels per rank. `LeaderboardView.tsx:197` |
| Missing focus rings on key buttons: Gallery star, FixtureBox, ManagerFloorView fixture tap targets, CaptureSlot photo stage, ReviewActions override buttons, PlanogramEditor inputs/remove | High–Med | S each | Add the standard `focus-visible:ring`. Files: `GalleryView.tsx:152`, `FixtureBox.tsx:87`, `ManagerFloorView.tsx:150`, `CaptureSlot.tsx:91`, `ReviewActions.tsx:79`, `PlanogramEditor.tsx:254/397` |
| Manager floor photo overlay: empty `alt=""` + white label text over photo with no bg protection (fails on dark photos) | Med | S | Add descriptive alt + label bg/shadow. `ManagerFloorView.tsx:164/173` |
| Heading hierarchy: pillar cards are `<h2>` nested under "More" `<h2>` (should be `<h3>`) | Med | S | `HomeView.tsx:181` |
| Insights region select has `aria-label` but no visible label; best-in-class carousel has no ARIA region/keyboard nav | Med | S–M | `InsightsView.tsx:191`, `LeaderboardView.tsx:160` |
| Floor plan grid background at 16% opacity (~1.09:1) — invisible to low-vision | Med | S | Bump to 0.25–0.35. `FloorPlanCanvas.tsx:61` |
| EmptyState/ErrorState icons `aria-hidden` with no semantic fallback | Low | S | `states.tsx:21/44` |

### Theme F — Navigation & deep-linking

| Gap | Sev | Effort | File |
|---|---|---|---|
| **Broken fixture deep-link** — StoreDetail links to `/console/fixture/:photoId` WITHOUT `?submission=`, so the review page errors ("Open this fixture from a store"). Breaks the core reviewer drill-in. | High | S | Pass submission context in the link. Root cause: `FixtureOutcome` type lacks `submissionId`. `StoreDetailPage.tsx:152`, `FixtureReviewPage.tsx:24` |
| Campaign selection lost on back-nav and on Dashboard→store links (defaults to first campaign — user lands in wrong campaign) | Med | M | Append `?campaign=` to BackLink + dashboard store links. `StoreDetailPage.tsx:71`, `DashboardView.tsx:141` (note: InsightsView store rows are NOT links — that part of the finding was inaccurate). |
| No back-link/breadcrumb across studio detail/analytics views (FloorPlan, Leaderboard, Gallery, Stores) while console/store views have them | Med | M | Add a reusable `<StudioBackLink>`; standardise. |
| Cross-shell jump studio→console swaps entire chrome (sidebar vanishes) with no context cue | Med | S | Visual marker on the Review nav item + a context label in AppShell header. |
| Capture flow has no obvious exit — Wordmark is a link but non-obvious; mobile hides nav, no hamburger (ManagerShell has one) | Med | M | Add explicit Home/Exit affordance to AppShell. |
| No 404 page — all unknown routes silently `Navigate to "/"` | Low | S | Add a `NotFoundPage` before the catch-alls. |
| Leaderboard/Insights rows aren't clickable to store detail (pattern exists in StoreDetailPage ledger) | Med | S | Make rows `Link`s with ChevronRight. |
| Studio TopBar not explicitly `sticky` (works by flex layout but fragile/inconsistent) | Low | S | Add `sticky top-0 z-20`. `TopBar.tsx:36` |
| Manager top bar shows store name but drops campaign name once off Home (it's in the API response) | Low | S | Add campaign to ManagerTopBar. `ManagerShell.tsx:102` |

### Theme G — Mobile / responsive (store + capture = real; studio = mostly desktop-only)

| Gap | Sev | Effort | File |
|---|---|---|---|
| **ManagerFloorView fixtures scale to ~27–35px on small phones** — below 44px touch min; this is the manager's primary capture surface | Med | M | Add min-canvas-size / pinch-zoom / "tap to enlarge". `ManagerFloorView.tsx:138` |
| Insights store table hides completion progress entirely on mobile (`hidden ... sm:flex`) | Med* | M | Show a compact % badge on mobile + stack row. `InsightsView.tsx:363`. *High only if studio must be mobile; it's desktop-first, so treat as Med.* |
| CaptureSlot error buttons (Retry/Re-take/Discard) wrap awkwardly <360px | Low | S | `grid grid-cols-2` on mobile. `CaptureSlot.tsx:126` |
| FixtureReviewPage: criteria list pushes decision buttons far below fold on mobile; no sticky actions | Med | M | `sticky bottom-0` on ReviewActions. `FixtureReviewPage.tsx:107/149` |
| MoneyMap detail panel `hidden ... lg:block` with NO mobile fallback (FloorPlanView already has the slide-over pattern) | Med | M | Reuse FloorPlanView's mobile slide-over. `MoneyMapView.tsx:116` |
| Studio sidebar fixed 224px, never hidden on phones (ManagerShell has the correct drawer pattern) | Med | L | Add mobile drawer or accept desktop-only and document. `Sidebar.tsx:101` |
| Leaderboard podium cards / header don't adapt padding/stacking on narrow screens | Low–Med | S–M | `LeaderboardView.tsx:100/154/203` |
| Floor plan grid invisible at mobile scale; Insights grid jumps 1→3 cols (no `sm:` intermediate) | Low | S | `FloorPlanCanvas.tsx:61`, `InsightsView.tsx:292` |
| StoreDetailPage fixture rows don't stack on mobile (console is desktop-focused → low) | Low | S | `StoreDetailPage.tsx:133` |

### Theme H — Feature coherence & analytics gaps

| Gap | Sev | Effort | File |
|---|---|---|---|
| **No reviewer attribution / override history shown to anyone** — `Review` table stores reviewerId/action/reason but no GET endpoint, no UI. Managers never learn *why* their fixture changed; reviewers can't see prior decisions. | High | M | Add `verdicts.history()` endpoint; show a timeline on FixtureReviewPage AND GuideFixtureDetailView (manager). Note: `getOne()` deliberately omits the `reviews` relation. |
| No comment/threading on verdicts — single one-shot note, manager can't reply | Med | L | Add a Comment entity + read-only history first, reply UI later. |
| Region/areaManager segmentation incomplete — Insights/Leaderboard filter region client-side only; DashboardView has none; areaManager/storeType never surfaced; queue endpoint takes no filter params | Med | M–L | Add region filter to Dashboard; add areaManager/storeType filters; move filtering server-side for large estates. |
| Console queue has no search/filter — flat list sorted by attention only; painful at 100+ stores (ProductsView shows the search+dropdown pattern to copy) | Med | M | Add search + region/manager/band filters, persisted to URL. `ConsolePage.tsx:52` |
| No bulk actions in console (confirm-all, escalate-region); every fixture reviewed one-by-one | Med | M | Add multi-select + `POST /verdicts/batch-review`. |
| CSV export only in Insights, not Dashboard or console | Med | M | Add export to Dashboard table + console queue. |
| Best-in-class is curate-only — no manager notification, no recognition card, no tie to ranking; intent (teaching vs competition) unstated | Med | M | Notify managers when picked; add recognition to ManagerHome; clarify carousel caption. |
| Offline support only for photo capture; tasks/sales/products fail silently offline | Low | M | Document as intentional + add an offline error message; optionally extend queue to sales. |
| Offline ribbon is sparse — no last-sync time, no "Sync now", no per-item retry/clear, no header sync indicator | Med | S | Enhance OfflineRibbon + add a header queue-status icon. `AppShell.tsx:22`, `captureQueue.ts` |
| ESCALATE conflates "I'm unsure" with "I strongly disagree (high-confidence)" | Med | S | Clarify labels or add a distinct action. `ReviewActions.tsx` |
| Compliance snapshots are cron + manual-button only; no schedule visibility | Med | S | Show next-snapshot time / schedule in a campaign settings section. |

---

## 3. Quick wins (do first — high value, ≤Small effort)

1. **Build one `useToast` primitive** (Small) — unlocks ~15 D2/D3 feedback fixes that then become one-liners. Single highest-leverage small task.
2. **Fix the broken fixture deep-link** — add `?submission=` (and `submissionId` to `FixtureOutcome`) so reviewer drill-in stops erroring. `StoreDetailPage.tsx:152`.
3. **Add the 5 missing `isError` branches** on critical/manager paths (ManagerHome, SalesLog, Tasks, ManagerProducts, Dashboard, Gallery) — copy the existing `ErrorState` pattern.
4. **Remove the Dashboard "Coming soon" label** (`HomeView.tsx:62`) and **delete the dead `ComingSoonView` stub exports** (`ComingSoonView.tsx:54–97`).
5. **Gate REVIEWER-visible admin buttons** in FixturesView/ProjectsView (`user?.role === 'ADMIN'`).
6. **Add focus rings + fix the two colour-only indicators** (console section dot, leaderboard medals) — restores the design system's own a11y promises.
7. **Replace the two native `window.confirm()` / no-confirm destructive actions** (shelf delete, discard capture) with the existing Dialog/confirm pattern.
8. **Swap plain `<p>` empty states for `EmptyState`** across the 6 studio/console views (ProjectsView first — it renders blank).

## 4. Bigger bets (need real design, not a one-line fix)

1. **Build the admin/operations console.** Campaigns (create/activate/lifecycle), rubric authoring + versioning, user invite/role management, store create/metadata, org settings, task lifecycle. Backends largely exist — this is SDK + UX work, and without it the product can't be operated without DB access. Treat as a coherent "Admin" surface, not scattered buttons. **This is the difference between a demo and a deployable product.**
2. **Fix and design the auth model.** Apply `RolesGuard` server-side, then deliberately decide REVIEWER vs ADMIN boundaries (read-only studio mode?) and finish-or-cut VIEWER. Security + role-clarity in one pass.
3. **The publish & notification pipeline.** The "Publish & notify stores" button implies a whole capability — publish state, manager notifications, "guide updated" awareness, read/ack tracking. Design the loop end-to-end (it ties into the missing task/notification infra).
4. **The review feedback loop.** Reviewer attribution + override history visible to managers, escalation routing/destination + an escalations queue, per-criterion override, and verdict comments/threading. Today escalation is a dead-end audit record and managers get no "why". This is what makes the human-in-the-loop actually a loop.
5. **Keyboard accessibility for the floor-plan canvas.** `role="application"` with no key handlers is a genuine WCAG-AA failure on the keystone authoring surface; needs a designed interaction model (focus traversal + arrow-nudge), not a patch.
6. **Estate-scale console + segmentation.** Search/filter/bulk-actions on the queue and region/area-manager segmentation across Dashboard/Insights/console. Fine at demo scale; a hard workflow blocker at 100+ stores.

*Files cited are absolute under `/Users/mazen/work/TCC/wally-app/`. Two findings contained minor inaccuracies worth noting: InsightsView store rows are not links (so only DashboardView needs the campaign-preservation fix), and the OfflineRibbon shows a draining pulse, not the ribbon, during normal online sync.*