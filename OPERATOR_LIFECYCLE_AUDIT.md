# Operator Role & Lifecycle Audit

Read-only audit. No code, schema, config, or data was changed. All findings are against the working tree as of 2026-07-28 (note: `auth.service.ts`, `user.schema.ts`, `users.service.ts`, `users.service.spec.ts` are mid-edit/uncommitted per `git status` — findings reflect what's on disk now).

Scope: operator role only. Admin and Technician logic is described only where it intersects an operator workflow (assignment, validation, rejection, closure) — no change is proposed to Admin/Technician behavior anywhere in this document.

Legend: **Sev** = Critical / High / Medium / Low / Info. **Type** = Security (auth/IDOR/data-exposure), Functional (broken/dead feature), Correctness (wrong data/timing), UX (confusing but not wrong), Design-note (intentional, flagged for awareness).

---

## Contents
1. Account lifecycle & auth (registration → verification → approval → login → refresh → profile)
2. Work orders & operator dashboard
3. Preventive maintenance
4. Corrective maintenance / breakdown reporting
5. Intervention reports, documents/evidence, spare-parts requests
6. Notifications & calendar
7. What was verified correct (non-issues)
8. Prioritized remediation plan

---

## 1. Account lifecycle & auth

### 1.1 — No defect: approved accounts never silently revert to pending
**Current behavior:** `users.service.ts:417-449` strips `APPROVAL_FIELDS_LOCKED_FROM_GENERIC_UPDATE` (`approval_status, approved_by, approved_at, rejected_by, rejected_at, rejection_reason, approval_history`) from every generic `PATCH /users/:id`. `auth.service.ts:792-857` (`completeGoogleProfile`) and `auth.service.ts:886-929` (`markGoogleProfileIncomplete`) both explicitly compute `alreadyApproved` and skip resetting `approval_status`/`is_active` when true. `approveUser`/`rejectUser` (`users.service.ts:600-782`) use an optimistic-concurrency filter (`buildObservedApprovalStatusFilter`, lines 1038-1044) so a stale-read approval decision fails with `INVALID_APPROVAL_TRANSITION` instead of clobbering a concurrent transition.
**Verdict:** Correct. No code path found that resets an approved operator back to pending. Verified directly (`user.schema.ts:44-45,82-83` — no `select:false`, checked separately, not the mechanism here — the guard is at the service layer).

### 1.2 — No defect: no stale-session window for deactivated/rejected operators
**Current behavior:** `JwtStrategy.validate()` (`jwt.strategy.ts:46-71`) re-queries `userModel.findById` on **every request**; `JwtAuthGuard` (`jwt-auth.guard.ts:46-51`) re-runs `validateAccountAccess` each time. JWT payload itself carries no status/role snapshot beyond `role` (`auth.service.ts:1114-1159`).
**Verdict:** Correct. A deactivated/rejected operator is blocked on their very next request, not just after token expiry.

### 1.3 — No defect: profile completion enforced server-side
**Current behavior:** `jwt-auth.guard.ts:35-44,56-62` — for `profile_completed === false`, every endpoint except `POST /auth/complete-profile` and `POST /auth/logout` throws `PROFILE_COMPLETION_REQUIRED` (403).
**Verdict:** Correct. An operator cannot reach `/operator/*` by calling the API directly while profile-incomplete.

### 1.4 — [Medium][Security] Operator's own password/refresh-token hash returned in `GET /operator/reports/my`
**Current behavior:** `operator.service.ts:346-367` (`getMyReports`) runs `.populate('ot_id').populate('technician_id')` with no field restriction (line 361). `technician_id` on `InterventionReport` is reused to store the operator's own id for self-performed work. `user.schema.ts:44-45` (`password`) and `:82-83` (`refresh_token_hash`) have no `select: false` and no schema-level `toJSON` transform (confirmed by direct read). The controller (`operator.controller.ts:71-85`) returns the result unmodified; `pagination.ts` (`toPaginatedResponse`) does no sanitization.
**Expected behavior:** Only non-sensitive fields (e.g. `nom_complet`) of the populated user should reach the response — matching the pattern already used elsewhere in the same file (`work-orders.service.ts:2672-2688`, `extractHydratedEntity<User>(..., ['nom_complet'])`).
**Evidence:** `backend/src/operator/operator.service.ts:361`; `backend/src/schemas/user.schema.ts:44-45,82-83` (confirmed directly).
**Impact:** Not a cross-account leak (operator only ever sees their own hash here), but bcrypt password/refresh-token hashes should never leave the server. If the browser session is compromised (XSS, malicious extension, a logging/APM tool capturing response bodies), the attacker gains offline password-cracking material.
**Repro steps:** Log in as an operator who has at least one submitted report; call `GET /operator/reports/my`; inspect `items[].technician_id.password` / `.refresh_token_hash` in the JSON body.
**Recommended fix:** `.populate('technician_id', 'nom_complet email role')`, or reuse `extractHydratedEntity`.
**Related (outside operator scope, same root cause, broader blast radius):** `intervention-reports.service.ts:39,51,62` — same unrestricted `.populate('technician_id')` on the **admin-only** report list, leaking every operator/technician's hash to any admin who lists reports.
**Tests required:** Integration test asserting `GET /operator/reports/my` response never contains `password` or `refresh_token_hash` keys anywhere in the payload (recursive key check), for both the operator's own report and an admin-listed report.

### 1.5 — Verified correct: guards, hidden-ID sanitization, JWT contents, refresh rotation
- Global guard chain `JwtAuthGuard → RolesGuard → AppThrottlerGuard` registered as `APP_GUARD` (`app.module.ts:224-234`) — every controller guarded by default.
- `sanitizeUser`/`sanitizeRefreshUser` (`auth.service.ts:1067-1112`) strip `password, __v, reset_password_token, reset_password_expires, refresh_token_hash, approved_by, rejected_by` (+ more on refresh) before login/refresh responses.
- Refresh token rotation is atomic and reuse-detecting (`auth.service.ts:250-347`, `findOneAndUpdate` conditioned on the previous hash still matching; reuse throws `REFRESH_TOKEN_REUSE_DETECTED`).
- `AdminAccountGuard` re-validates `validateAccountAccess` for admins too, not just role.
- Frontend `sessionGuard.ts` mirrors the backend's exact state-priority order and is documented as UX-only (correctly, since backend enforcement is what actually gates access).
- **Minor/Info:** `google-login-exchange.service.ts:117-137` derives its AES key from `JWT_REFRESH_SECRET`/`JWT_SECRET` when `GOOGLE_LOGIN_EXCHANGE_ENCRYPTION_KEY` is unset — key reuse across purposes; low practical risk given 2-min TTL + single-use delete-on-read, but should use an independently configured key in production.
- **Minor/Info:** Admin generic `update()` can flip `is_active`/`is_verified` without going through `rejectUser`'s explicit `$unset` of `refresh_token_hash` — not exploitable in practice because `refreshToken()` re-validates `is_active`/`approval_status` fresh from DB before honoring any refresh (see 1.2), but it is a second, less-audited revocation path.

---

## 2. Work orders & operator dashboard

### 2.1 — [Low][UX] Calendar "Start"/"Complete" buttons don't reflect real per-action status rules
**Current behavior:** `getCalendarEventDetails` (`work-orders.service.ts:1835-1841`) computes `actions.canStart`/`canComplete` as simply `!isCompletedStatus(status)` — i.e. "not completed/validated" — for both flags. The real write-path guards are narrower: `OPERATOR_STARTABLE_STATUSES = ['scheduled','overdue','pending']` (line 251) for Start, and `status === 'in_progress'` for Complete (line 1611). Frontend (`smart-maintenance-calendar/page.tsx:869-882`) gates buttons purely on these flags.
**Expected behavior:** A button should only be enabled when the underlying atomic write would actually succeed.
**Evidence:** `backend/src/work-orders/work-orders.service.ts:1835-1841` vs `:251`, `:1611`.
**Impact:** Not exploitable (the atomic `findOneAndUpdate` status-guard still rejects the invalid transition with `ConflictException`/409) — but an operator can see an enabled Start button on a `waiting_validation` or already-`in_progress` item and get a confusing failure.
**Repro steps:** Open the operator smart calendar on a work order in `waiting_validation`; observe the Start/Complete buttons are enabled; click one; observe a 409 toast.
**Recommended fix:** Compute `canStart = OPERATOR_STARTABLE_STATUSES.includes(status)` and `canComplete = status === 'in_progress' && type === 'corrective'` in `getCalendarEventDetails`, reusing the same constants the write paths use.
**Tests required:** Unit test on `getCalendarEventDetails` asserting `actions` matches the write-path status sets for every status value in the enum.

### 2.2 — [Medium][Correctness] Admin approve/reject write is not atomic/status-guarded, unlike every operator transition
**Current behavior:** `applyValidationAction` (`work-orders.service.ts:468-584`) does `findById` then an **unconditional** `findByIdAndUpdate` (lines 519-541) — no status precondition in the filter, unlike `startWorkOrderForOperator`/`completeWorkOrderForOperator`/`submitPreventiveMaintenanceForOperator`, which all embed the expected status in the `findOneAndUpdate` filter.
**Expected behavior:** Consistent with the rest of the file's own design principle — the write should fail safe under a concurrent duplicate call.
**Evidence:** `backend/src/work-orders/work-orders.service.ts:468-584` (no status precondition) vs `:1562-1572`, `:1606-1622`, `:1137-1163` (all status-guarded).
**Impact:** Two near-simultaneous "approve" calls (double-click, two admin tabs) can both succeed, each pushing a `lifecycle_history` entry and each calling `ensureNextPreventiveWorkOrder` — whose own duplicate guard (lines 2453-2464) is itself a non-atomic `findOne`-then-`create`, so a tight race can produce two next-cycle preventive work orders for the same plan. Admin-only surface, so likelihood is low, but the pattern is a real gap.
**Reproduction steps:** Fire two concurrent `POST /work-orders/:id/validation {action:'approve'}` requests for the same work order (e.g. via a script sending both near-simultaneously); observe two `lifecycle_history` entries and, if the work order is a preventive occurrence, check for two newly created next-cycle work orders on the same plan.
**Recommended fix:** Convert to `findOneAndUpdate({_id, status: {$in: EXPECTED_PRE_VALIDATION_STATUSES}}, {...})`, throw `ConflictException` on a null result, mirroring the operator-transition pattern. Also make `ensureNextPreventiveWorkOrder`'s duplicate check atomic (unique index or upsert) rather than find-then-create.
**Tests required:** Concurrency test firing two simultaneous approve calls; assert exactly one `lifecycle_history` approval entry and at most one next-cycle work order.

### 2.3 — Verified correct: ownership/IDOR, timestamps, duplicate-submission guards, race safety, missing-assignment handling
- Triple-layered ownership check on every operator mutation: `OperatorService` (`assertOperatorCanActOnWorkOrder`) → `WorkOrdersService` (`loadOwnedWorkOrderOrThrow`, compares `technician_id` to caller) → atomic filter itself re-asserts `technician_id` at the DB write (`work-orders.service.ts:1565-1567`, `1609-1611`, `1141`).
- `getCalendarEventsForOperator`/`getMyWorkOrders`/`getMyReports` hard-scope the Mongo query to the caller's own id — client filters can only narrow, never widen.
- All operator-facing timestamps (`date_start`, `execution_date`, `date_end`) are `new Date()`, never client input; DTOs exclude status/date/identity fields, enforced by global `whitelist:true, forbidNonWhitelisted:true` `ValidationPipe` (`main.ts:55-58`).
- Start/Complete/Submit transitions are atomic, status-guarded `findOneAndUpdate` — genuine double-submission/race protection, confirmed by direct read.
- Part-request creation/decision is additionally protected by **partial unique indexes** at the DB layer (`part-request.schema.ts:62-69`), not just app logic.
- Missing-assignment (0 machines/work orders) returns empty arrays/zero counts everywhere traced — no 500s, matching empty-state UI.
- No endpoint found where an operator can pass another user's ID to view/mutate their data (explicit `ForbiddenException` on out-of-scope machine/work-order IDs).
- Operator-specific logic is implemented as **separate methods**, not `if (role==='operator')` branches inside shared Admin/Technician code — structurally prevents operator-only weakening of Admin/Technician paths. One shared method (`reschedulePreventiveOccurrence`) is reachable from both Admin (`@AdminOnly()` route) and Operator (ownership-checked route) but is safe in both directions.

---

## 3. Preventive maintenance

> Note: there are two unrelated "preventive task" systems in this codebase. `backend/src/preventive-tasks/*` is an **admin-only** checklist-line tracker (`@AdminOnly()` on every route) — operators cannot reach it at all, and its frontend page (`preventive-task-checklist/page.tsx`) is correctly gated `admin`/`technician` only. The actual operator-facing preventive workflow lives entirely in `WorkOrder` + `operator.controller.ts`/`operator.service.ts` + `work-orders.service.ts`. All findings below are about that real path.

### 3.1 — [High][Functional] Admin-activated first preventive occurrence is unassigned and unclaimable
**Current behavior:** When an admin activates a maintenance plan, `createInitialOccurrenceForPlan` (`work-orders.service.ts:782-822`) creates a `WorkOrder` due immediately but sets **no `technician_id`**. There is no "claim" endpoint anywhere under `backend/src/operator/*` (confirmed by search). `submitPreventiveMaintenanceForOperator` rejects with `ForbiddenException('This preventive occurrence is not assigned to you')` whenever `technician_id` is empty (`work-orders.service.ts:1084-1091`).
**Expected behavior:** Either the initial occurrence should be assignable/claimable by an eligible operator, or the UI should not present an actionable "Perform Today" for it.
**Evidence:** `backend/src/work-orders/work-orders.service.ts:782-822` (no `technician_id` set); `:1084-1091` (ownership check that will always fail for this occurrence).
**Impact:** Any operator who sees this occurrence in "Due Today"/"Overdue" on the calendar and clicks through to submit gets a hard 403 with no recovery path in the UI — only an admin manually editing `technician_id` via `PATCH /work-orders/:id` can unstick it.
**Repro steps:** As admin, activate a new maintenance plan. As an operator with visibility into that machine, open "Due Today," select the newly created occurrence, attempt to submit. Observe 403.
**Recommended fix:** Either auto-assign `technician_id` at activation time (e.g. to a default/primary operator for the machine, if the schema supports `assigned_machine_ids` reverse-lookup) or add a `POST /operator/calendar/events/:id/claim` endpoint gated to operators with machine access when `technician_id` is unset.
**Tests required:** Integration test: activate a plan, assert the created occurrence's `technician_id`, and assert an eligible operator can either claim or is not shown a dead-end "Perform Today" action.

### 3.2 — [Low] Same plan can end up with two concurrent open occurrences
**Current behavior:** `assertNoDuplicatePreventiveOccurrence` (`work-orders.service.ts:3074-3123`) only blocks a same-day duplicate for the same plan+machine, not "this plan already has any open occurrence." Combined with 3.1, an operator explicitly scheduling a first date (`scheduleFirstPreventiveOccurrence`, self-assigning) can create a second open occurrence alongside the admin-created unassigned one.
**Impact:** Duplicate/orphaned work-order records for the same plan; the unassigned one remains permanently stuck per 3.1.
**Recommended fix:** Once 3.1 is fixed (no more automatically-unassigned occurrences), re-evaluate whether this can still occur; if so, widen the duplicate check to "any non-terminal occurrence for this plan."

### 3.3 — [Medium][Correctness] `calculateNextDueDate` ignores its own `timezone` parameter
**Current behavior:** `MaintenanceSchedulingService.calculateNextDueDate` (`maintenance-scheduling.service.ts:106-129`) declares `timezone?: string` (line 31) but its internal `addDays`/`addMonths`/`addYears` helpers (lines 220-252) use plain `Date.setDate()/setMonth()/setFullYear()` — the **server process's local timezone**, not the passed value. The caller (`ensureNextPreventiveWorkOrder`, `work-orders.service.ts:2436-2441`) explicitly passes `timezone: process.env.BUSINESS_TIMEZONE || 'Africa/Tunis'` expecting it to be honored. By contrast, `calculateOperationalStatus` in the same file correctly routes through `business-time.ts`'s IANA-aware `startOfBusinessDay`.
**Expected behavior:** Next-due-date computation and due/overdue status computation should use the same timezone semantics.
**Evidence:** `backend/src/work-orders/maintenance-scheduling.service.ts:31,106-129,220-252` vs `:131-154`; `backend/src/common/business-time.ts:35-97`.
**Impact:** If the server process's runtime TZ differs from `Africa/Tunis` (typical in a UTC-default container), the newly computed `due_date` for the next occurrence can land on the wrong calendar day relative to what the (correct) business-timezone-aware status check expects — an occurrence can appear due a day early/late.
**Repro steps:** Run the backend process with `TZ=UTC`; complete a monthly preventive occurrence at a time close to local midnight in `Africa/Tunis`; inspect the computed `due_date` of the newly created next-cycle work order versus what a `Africa/Tunis`-anchored calculation would produce.
**Recommended fix:** Route `addDays`/`addMonths`/`addYears` through the same `Intl.DateTimeFormat`-based business-timezone arithmetic used by `business-time.ts`, or explicitly convert to/from the business timezone before/after the date-math.
**Tests required:** Unit test for `calculateNextDueDate` with a non-`Africa/Tunis` process TZ, asserting the returned date matches business-timezone expectations, not server-local.
**Confirmed correct (no defect):** the base date used for recurrence is always `execution_date` (actual completion time), never the scheduled/due date — this is deliberate and consistently implemented (`work-orders.service.ts:1051-1057`, `2426-2430`).

### 3.4 — [Medium][Security-adjacent/Correctness] Checklist completeness is UI-only, bypassable via direct API call
**Current behavior:** `SubmitPreventiveMaintenanceDto` (`operator/dto/submit-preventive-maintenance.dto.ts:37-41`) only requires `tasks_completed` be a non-empty string array (`@ArrayNotEmpty()`, `@ArrayMinSize(1)`) — any strings, not cross-checked against the plan's real checklist. `submitPreventiveMaintenanceForOperator` (`work-orders.service.ts:1098-1105`) only checks `length > 0`. Tokenization of the checklist happens only in the browser (`operator/preventive/page.tsx:153-159`).
**Expected behavior:** A submission claiming checklist completion should be validated against the actual checklist derived from the plan.
**Evidence:** `backend/src/operator/dto/submit-preventive-maintenance.dto.ts:37-41`; `backend/src/work-orders/work-orders.service.ts:1098-1105`.
**Impact:** `POST /operator/preventive/submit` with `tasks_completed: ["x"]` succeeds for any plan regardless of the real checklist size, moving the occurrence to `waiting_validation` with a near-empty `description_action`. This is a compliance/audit-integrity gap (a maintenance task can be marked complete without actually completing its checklist), not a privilege escalation.
**Repro steps:** Authenticate as an operator with an assigned preventive occurrence; call `POST /operator/preventive/submit` directly with `tasks_completed: ["x"]`, bypassing the frontend; observe success and status transition to `waiting_validation`.
**Recommended fix:** Server-side, look up `plan.instruction`, tokenize the same way the frontend does, and require the submitted list to cover (or be validated against) the derived checklist items before accepting.
**Tests required:** Integration test submitting a partial/garbage `tasks_completed` array against a plan with a known multi-line checklist; assert rejection (or at minimum that the stored record reflects actual incompleteness for the validator to see).

### 3.5 — [Low] Draft saving is entirely client-side (localStorage), not a backend feature
**Current behavior:** `operator/preventive/page.tsx:332-395` implements save/load/delete draft purely via `localStorage`, keyed per user id. No backend endpoint exists. `PreventiveDraft` doesn't persist `selectedOccurrenceId`/`selectedPlanIds`, so resuming a draft restores checklist/notes but not which scheduled occurrence it targets.
**Impact:** Drafts are lost on cache-clear, invisible across devices, and require re-selecting "Perform Today" after resuming — a UX gap, not a data-integrity bug (no duplicate WorkOrder risk since nothing reaches the server until final submit).
**Recommended fix:** If cross-device/durable drafts are a requirement, add a lightweight `draft` status/endpoint; otherwise, at minimum persist `selectedOccurrenceId` in the local draft object so resuming doesn't lose target-occurrence context.

### 3.6 — [Medium][Functional/Governance] Rescheduling has no time-window, cap, or approval constraint
**Current behavior:** `RescheduleCalendarEventDto` validates only ISO date format + a non-empty reason string. `reschedulePreventiveOccurrence` (`work-orders.service.ts:824-891`) only rejects non-schedulable types and already-completed occurrences — no minimum-future-date check, no reschedule-count cap, no approval workflow. Ownership is correctly enforced (`loadOwnedWorkOrderOrThrow` before delegating). Frontend's separate Reschedule modal date input has no `min` attribute (unlike the "Set first intervention date" modal, which does), so the UI doesn't even attempt to block backdating.
**Expected behavior:** Per typical CMMS practice, rescheduling a preventive task should be bounded going forward and/or require sign-off beyond a certain threshold.
**Evidence:** `backend/src/operator/dto/reschedule-calendar-event.dto.ts`; `backend/src/work-orders/work-orders.service.ts:824-891`; `frontend/src/app/[locale]/operator/preventive/page.tsx:1546-1550` (no `min`) vs `:1517` (has `min`).
**Impact:** An operator can indefinitely defer, or backdate, a preventive task without any admin sign-off. Fully audit-logged after the fact (`original_due_date`, `reschedule_reason`, `rescheduled_by`, `rescheduled_at` all persisted), so this is a governance gap, not a silent-corruption risk.
**Recommended fix:** Add a `new_due_date >= today` (business-timezone-aware) check server-side; consider a per-occurrence reschedule-count cap or an approval requirement beyond N reschedules/N days deferral, if that matches business policy — flagging as a policy decision for the product owner, not prescribing one.
**Tests required:** Test that a backdated `new_due_date` is rejected once the fix lands; audit-trail fields already have adequate coverage to verify post-fix.

### 3.7 — Verified correct: reminders, timestamps, machine-scoping, permission checks
- Reminders (`automation.scheduler.service.ts:160-298`) resolve to the specific assigned operator or fall back to Admin broadcast — never leak to an unrelated individual. Deduplication is race-safe via a DB-level `unique: true` index on `Notification.dedupe_key`, not just an app-level check.
- Every preventive mutation endpoint combines role (`@OperatorOnly()` + `ensureOperator` runtime re-check) with resource ownership (`assertCanAccessMachine` and/or `technician_id` match) at the service layer — no confirmed permission/ownership defect in this area.
- `getMachinePreventiveStates`'s internal comment about operators "currently accessing all machines" is stale relative to the `assigned_machine_ids` gate that now exists one layer up (`assertCanAccessMachine`) — misleading comment, not an active hole; worth a documentation cleanup pass.

---

## 4. Corrective maintenance / breakdown reporting

### 4.1 — [High][Functional] `operator/corrective/page.tsx` targets admin-only endpoints and always fails for operators
**Current behavior:** `submitCorrectiveMaintenance` (`operator/corrective/page.tsx:613-699`) calls `apiService.createWorkOrder` (`POST /work-orders`, `@AdminOnly()`, `work-orders.controller.ts:44`) and `apiService.createInterventionReport` (`POST /intervention-reports`, `@AdminOnly()`, `intervention-reports.controller.ts:28`) directly, rather than the correct, purpose-built `POST /operator/report-problem` used by the sibling `report-problem` page.
**Expected behavior:** Corrective submissions from an operator should go through `POST /operator/report-problem` (already implemented correctly, see 4.2).
**Evidence:** `frontend/src/app/[locale]/operator/corrective/page.tsx:613-699,634-662`; `frontend/src/services/api.ts:368,416`; `backend/src/work-orders/work-orders.controller.ts:44`; `backend/src/intervention-reports/intervention-reports.controller.ts:28`.
**Impact:** Every operator who submits through this page receives HTTP 403 — the page has never worked for an operator account. **Additionally**, the payload it builds client-side sets `ot_id`, `technician_id`, `status`, `report_id`, `validation_responsable` (lines 634-662) — fields that must never be client-controlled per the DTO design used everywhere else. The role guard currently blocks this from being exploitable, but the code pattern is unsafe-by-design and should not exist alongside the correct flow, since any future loosening of the guard (or an alternate route added without the same care) would turn this into a self-validation vector.
**Repro steps:** Log in as operator, navigate to `/operator/corrective`, fill and submit the form; observe network tab shows `POST /work-orders` → 403.
**Recommended fix:** Rewire this page to call `apiService.createOperatorCorrectiveReport` (`POST /operator/report-problem`), matching `report-problem/page.tsx`, or remove the page if `report-problem` is meant to be the sole corrective-reporting entry point (they appear to duplicate the same intent).
**Tests required:** E2E test: operator submits via `/operator/corrective`; assert success (post-fix) and assert the created work order's `technician_id`/`status` match server-derived values regardless of what the client attempted to send.

### 4.2 — Verified correct: `POST /operator/report-problem` (the working corrective flow)
`CreateCorrectiveReportDto` (`operator/dto/create-corrective-report.dto.ts:27-50`) exposes only `machine_id`, `code_panne`, `fault_description`, `actions`, `priority` — no identity/status/date fields. `createCorrectiveReportForOperator` (`work-orders.service.ts:903-1031`) derives `technician_id` from the JWT-authenticated caller, sets `status: 'waiting_validation'` and all timestamps server-side inside a transaction, and requires ≥1 action and a non-empty `code_panne`. Self-approval is blocked at the validation layer (`applyValidationAction`, lines 483-491, compares performer id to validator id). A technician's own `review()` can only ever pass `'return'`/`'intervene'`, never `'approve'` — a technician cannot approve their own claimed work either (this preserves existing Technician logic as required).

### 4.3 — [High][Functional] `returned` (request_correction) work orders become permanently stuck
**Current behavior:** When an admin picks `request_correction` on an operator-submitted report, `applyValidationAction` (`work-orders.service.ts:519-541`) only updates `status` — it never clears `technician_id`, which holds the **operator's own id** (set at creation for self-reported corrective work). Consequences, both confirmed by direct read:
- `technician.service.ts`'s `claimableUnassignedScope` only matches work orders where `technician_id` is null/absent — never matches (it's populated with the operator's id) — so **no technician can claim it**.
- `technician.service.ts`'s `actionableScope`/`visibleScope` only match a technician's *own* id — never an operator's id — so **it doesn't appear on any technician's list either**.
- `OPERATOR_STARTABLE_STATUSES = ['scheduled','overdue','pending']` (`work-orders.service.ts:251`) does not include `'returned'`, so the operator's own "Start" action 409s.
- No "resubmit"/"edit" endpoint exists anywhere in `operator.controller.ts` for the operator's own corrective report.
**Expected behavior:** A `request_correction` decision should route the item back to someone who can act on it — either back to the originating operator with an edit/resubmit path, or into the technician-claimable pool.
**Evidence:** `backend/src/work-orders/work-orders.service.ts:519-541,251`; `backend/src/technician/technician.service.ts` (`claimableUnassignedScope`, `actionableScope` definitions, ~lines 130-160).
**Impact:** A `returned` operator-originated report — corrective *and* preventive, since `scheduleFirstPreventiveOccurrence` has the same `technician_id = operatorId` pattern — silently disappears from every worklist. The only remediation today is an admin manually clearing `technician_id` via the generic `PATCH /work-orders/:id`, which is not a documented/supported recovery action anywhere in the UI. No test in `work-orders.service.spec.ts` exercises whether the resulting work order remains actionable after `request_correction` (the existing test at line ~1280 only checks that no notification fires).
**Repro steps:** As operator, submit a corrective report via `/operator/report-problem`. As admin, `POST /work-orders/:id/validation {action:'request_correction'}`. As the same operator, attempt to view/start/resubmit the item — observe it is absent from actionable lists and any start attempt 409s. As any technician, search claimable/assigned work — confirm the item never appears.
**Recommended fix:** On `request_correction`, either (a) clear `technician_id` and route into the technician-claimable pool, or (b) add an operator-facing "edit and resubmit" endpoint for reports they still own that are in `returned` status, and include `'returned'` in a resubmission-eligible status set. Decision belongs to product (which recovery path matches intended workflow) — the fix should preserve existing Technician claim/close logic unchanged, only add the missing routing.
**Tests required:** Integration test asserting that after `request_correction`, the item is either technician-claimable or operator-resubmittable (whichever fix is chosen), and never lands in a state with zero actionable role.

### 4.4 — [Medium][Data integrity] `code_panne` not validated against the fault-code catalog server-side
**Current behavior:** `WorkOrdersService` injects `panneModel` and uses it elsewhere, but `createCorrectiveReportForOperator` never queries it to confirm `codePanne` matches an existing `Panne.code_panne` — the DTO only bounds length (1-120 chars) and type (`create-corrective-report.dto.ts`).
**Evidence:** `backend/src/work-orders/work-orders.service.ts:919-922`.
**Impact:** A direct API call (bypassing the frontend's dropdown) can submit any arbitrary string as a fault code, corrupting fault-code analytics/KPIs/knowledge-base matching. Not a privilege-escalation issue.
**Recommended fix:** Validate `codePanne` against `panneModel.exists({code_panne: codePanne})` (or the machine-scoped fault list already used by `GET /operator/faults`) before accepting the report.
**Tests required:** Reject-on-invalid-code integration test; accept-on-valid-code regression test.

### 4.5 — [Medium][Security — IDOR, not reachable via shipped UI] Document evidence can be linked to another user's work order/report
**Current behavior:** `documents-upload.controller.ts`'s `uploadFile` accepts `work_order_id`/`intervention_report_id` in the body. `documents.service.ts`'s `assertLinkedRecordsExist` (lines 509-536, confirmed by direct read) checks only `.exists({_id: ...})` — **no check that the referenced record belongs to the uploading user or matches the machine the caller was authorized against.**
**Expected behavior:** Linking a document to a work order/report should require the uploader own or otherwise have a legitimate relationship to that record, not merely that the record exists somewhere in the DB.
**Evidence:** `backend/src/documents/documents.service.ts:509-536` (confirmed directly — no ownership predicate, existence-only).
**Impact:** An authenticated operator who passes the machine-access check for *any* machine they're assigned to can supply a different, valid `work_order_id`/`intervention_report_id` (Mongo ObjectIds are enumerable/observable, not secret) belonging to another operator's report, and the upload succeeds and is permanently linked to that record — planting fabricated "evidence" on someone else's report, or polluting an unrelated record's document trail. **Not reachable through the shipped UI** — `report-problem/page.tsx`'s `uploadPhotoIfPresent` only ever sends `machine_id`, never `work_order_id` — but the API endpoint itself is reachable by any authenticated operator/technician with a crafted request.
**Repro steps:** As operator A, note a `work_order_id` belonging to operator B's corrective report (or guess a plausible ObjectId near one's own). Call `POST /documents/upload` (or equivalent) with `machine_id` set to a machine operator A has access to, and `work_order_id` set to operator B's work order id. Observe the upload succeeds and is linked to operator B's record.
**Recommended fix:** In `assertLinkedRecordsExist`, when `work_order_id`/`intervention_report_id` is supplied by a non-admin caller, additionally verify `technician_id === callerId` (or admin/technician role) on the referenced record before accepting the link.
**Tests required:** Integration test: operator A uploads with operator B's `work_order_id` — assert rejection (403/400) post-fix; regression test that operator A can still upload against their own work order.

### 4.6 — Verified correct: idempotency, upload validation, race safety
- Corrective-report creation has a documented 2-minute soft dedupe window (`work-orders.service.ts:937-965`) — adequate for double-click/retry, though not a hard idempotency key (residual risk beyond 2 minutes, low severity, noted for completeness).
- Preventive submission and part-request creation/decision use atomic, status-guarded `findOneAndUpdate`/DB-unique-index protection — genuinely race-proof, confirmed by direct read and by existing tests in `work-orders.service.spec.ts`.
- Photo/document uploads: magic-byte content sniffing (not extension/declared-MIME trust) for both photos and general documents, server-generated UUID storage filenames (no path traversal via `originalname`), quarantine + audit trail on rejected uploads, `sharp` re-encoding of photos strips EXIF/embedded payloads.
- Every status-transition write examined (`start`, `complete`, `submit`, part-request decision) uses atomic Mongo filters with the expected prior status embedded — no naive read-modify-write pattern found on the operator/technician panne workflow (the one exception is 2.2, which is Admin-only).

---

## 5. Intervention reports, documents, spare-parts requests

### 5.1 — [High][Functional] Operator "My Reports" save/submit-draft/delete always fails (403)
**Current behavior:** `my-reports/page.tsx` (`handleSaveReport:271`, `handleSubmitDraft:350`, `handleDeleteReport:299`) calls `apiService.updateInterventionReport`/`createInterventionReport`/`deleteInterventionReport`, which map to `PATCH/POST/DELETE /intervention-reports*` — confirmed **all `@AdminOnly()`** (`intervention-reports.controller.ts:27-66`, verified directly by reading the controller: every method carries `@AdminOnly()`, overriding the class-level `@AuthenticatedRoles()` since `RolesGuard` uses `getAllAndOverride`).
**Expected behavior:** An operator should be able to save, submit, and delete their own draft/report through a role-appropriate endpoint (analogous to the working `operator/report-problem` and `operator/preventive/submit` flows).
**Evidence:** `frontend/src/app/[locale]/operator/my-reports/page.tsx:271,299,350`; `frontend/src/services/api.ts:416-418`; `backend/src/intervention-reports/intervention-reports.controller.ts:27-66` (confirmed directly).
**Impact:** Every operator who uses the "Save"/"Generate report"/"Delete"/"Submit draft" buttons on this page gets 403. This is a completely broken (not merely degraded) feature for the operator role. It compounds with 5.2 below (drafts are `localStorage`-only and can never be promoted to a real record).
**Repro steps:** Log in as operator, go to `/operator/my-reports`, attempt to save/submit/delete any report; observe 403 in network tab.
**Recommended fix:** Either (a) add operator-scoped, ownership-checked endpoints for report edit/submit/delete (mirroring the pattern already used for corrective reports and preventive submissions — ownership check via `technician_id === callerId`, server-controlled timestamps/status), or (b) if `my-reports` is meant to be read-only for operators, remove the non-functional edit/delete/submit affordances from the page rather than leaving dead buttons that 403.
**Tests required:** E2E test covering save/submit/delete as an operator against their own report (post-fix), and a negative test confirming an operator still cannot touch another operator's report.

### 5.2 — [Medium][Functional] Draft reports are `localStorage`-only and can never be promoted server-side
**Current behavior:** `my-reports/page.tsx:125-169` implements the entire draft feature via `window.localStorage`, keyed per-user; no backend `isDraft`/`status='draft'` field exists on `InterventionReport` at all. `handleSubmitDraft` (lines 345-374) calls the broken endpoint from 5.1, so even the "submit" step fails today.
**Evidence:** `frontend/src/app/[locale]/operator/my-reports/page.tsx:125-169,309-374`; `backend/src/schemas/intervention-report.schema.ts:6-40` (no draft-related field).
**Impact:** Drafts aren't synced across devices, are lost on cache-clear, and — because of 5.1 — currently cannot be promoted to a real record via the UI at all.
**Recommended fix:** Ties directly to fixing 5.1; once a working operator-facing submit endpoint exists, decide whether drafts should also gain server-side persistence (optional) or remain a local scratch pad feeding that endpoint on submit (minimum viable fix).
**Tests required:** Once 5.1 is fixed, add a test that a saved draft can be submitted successfully and results in exactly one server-side record (no duplication from `report_id` reuse — note `report_id` has a `unique: true` index, and the draft's client-generated id is currently reused as the final `report_id`, which could collide on retry).

### 5.3 — [Low][UX] No rejection/correction reason surfaced to the operator
**Current behavior:** `POST /work-orders/:id/validation` body is `{ action?: 'approve'|'reject'|'request_correction' }` only — no `reason`/comment field anywhere in the work-order/report validation flow (confirmed: `work-orders.controller.ts:176-179`, mirrored in `api.ts:361-364`). Contrast with the Documents module, which does capture a `reason` on publish/archive (`documents/dto/document-transition.dto.ts:9-17`).
**Impact:** An operator whose report is rejected or sent back only sees a status change with no explanation — a UX gap, not a security issue.
**Recommended fix:** Add an optional `reason` string to the validation DTO, store it (e.g. alongside `lifecycle_history`), and surface it in the operator's reports list/detail view.
**Tests required:** N/A beyond standard DTO/UI tests once implemented.

### 5.4 — Verified correct: spare-parts requests (`PartRequest` model, not the legacy `ot-pieces` module)
- **Ownership:** `requestPartsForOperator` requires `workOrder.technician_id.toString() === input.operatorId` (`work-orders.service.ts:1246-1251`) — an operator can only request parts for their own assigned work order.
- **No premature stock decrement:** confirmed by direct code-comment and by tracing — `requestPartsForOperator` never touches `stockModel`; stock is only reserved at technician/admin approval time.
- **Atomic, race-proof reservation:** `StockMovementsService.reserve`/`applyStockChange` (`stock-movements.service.ts:329-361`) uses a MongoDB `$expr`-guarded atomic update (`$gte: [{$subtract:[...]}, requireAvailable]`) — over-commitment is structurally impossible even under concurrent approvals, not just app-level-checked.
- **Role-gated decision:** `PATCH /work-orders/part-requests/:id/decision` is `@Roles(TECHNICIAN, ADMIN)` only — operators cannot approve/reject their own requests.
- **Duplicate protection:** app-level pre-check **plus** DB-level partial unique indexes on `{ot_id, part_id}` scoped by status — a genuine race-safety net, not just a best-effort check.
- **`ot-pieces` module:** entirely `@AdminOnly()` and not called by any frontend flow found — appears to be legacy/dead code parallel to the real `PartRequest` system. Low-severity cleanup item, not a defect for operators (they simply never touch it).

### 5.5 — Verified correct: evidence upload validation (aside from the linkage-ownership gap in 4.5)
- Magic-byte-based content verification for both photos (JPEG/PNG/WebP signatures) and general documents (extension + declared MIME + magic bytes must all agree).
- Server-generated UUID storage filenames — client `originalname` never used to build a filesystem/storage path (path-traversal-safe on both local and Supabase providers, each independently validating stored-key format before any filesystem/storage operation).
- Quarantine + immutable rejection audit trail on validation failure.
- File reads are gated through an authenticated `/documents/:id/file` route (not a bare public URL), itself gated by `DocumentAccessService.assertCanAccessMachine` — confirmed an operator cannot fetch an arbitrary document by guessing its Mongo `_id` unless they can access the linked machine.
- **Design note (not a defect, flagged for awareness):** access is scoped by *machine*, not by *uploader* — two operators both assigned to the same machine can see each other's uploaded photos/documents for that machine. This appears to be an intentional "documents are machine-centric shared knowledge" design choice; flagging only in case strict per-uploader privacy was actually intended.

---

## 6. Notifications & calendar

### 6.1 — [Medium][Correctness] Three divergent day-boundary computations feed the same operator calendar page
**Current behavior:** On `/operator/smart-maintenance-calendar`, the event-grid query (`getCalendarEvents` → `getViewDateRange`, called **without** a `timeZone` argument, `work-orders.service.ts:1663`) uses the server host's local clock. The "today/this week/overdue" widget (`getDashboardCalendarWidget`, lines 1950-2065) and the notification cards on the same page (`getNotificationCards`, lines 2067+) are both explicitly `BUSINESS_TIMEZONE`-aware. A fourth, properly timezone-aware method (`getCalendarEventsForOperator`, lines 1427-1483) exists but is **only referenced from the test suite**, never wired to `operator.controller.ts` — dead code in production.
**Expected behavior:** All date-boundary computations feeding one page should agree.
**Evidence:** `backend/src/work-orders/work-orders.service.ts:1663` vs `:1954,2071`; `:1427-1483` (unused in production, confirmed by grep — only referenced from `work-orders.service.spec.ts`).
**Impact:** An event due right around local midnight can be counted in the widget for one calendar day while the event grid (different boundary) shows it under the adjacent day or omits it from that day's view — the calendar and its own summary widget can visibly disagree.
**Repro steps:** With the server host clock in UTC and an event due near `Africa/Tunis` midnight, compare the "today" widget count against the day-view event grid for the same date.
**Recommended fix:** Pass `timeZone` through to `getViewDateRange` in `getCalendarEvents` (the production path), or replace it with the already-correct-but-unwired `getCalendarEventsForOperator` and delete the dead/divergent code once confirmed unused elsewhere.
**Tests required:** Test asserting the widget count and the event-grid query for the same day/timezone configuration agree on membership for an event scheduled near a midnight boundary.

### 6.2 — [Medium][Correctness] Reminder/overdue cron jobs use server-local day boundaries, not business timezone
**Current behavior:** `AutomationSchedulerService.startOfDay` (`automation.scheduler.service.ts:725-729`) uses `Date.setHours(0,0,0,0)` — the Node process's local clock — while `@Cron` decorators only control *when the job runs* (via `AUTOMATION_TIMEZONE`), not how "day" boundaries are computed once running.
**Evidence:** `backend/src/automation/automation.scheduler.service.ts:725-729` vs the `Africa/Tunis`-aware helpers used in `work-orders.service.ts`/`business-time.ts`.
**Impact:** 1/3/7-day-out reminders and overdue-marking boundaries can be off by the UTC↔Tunis offset from the true business-day boundary the rest of the app uses.
**Recommended fix:** Route `startOfDay` through the same `business-time.ts` helper used elsewhere.
**Tests required:** Same pattern as 6.1 — unit test with a non-Tunis process TZ asserting reminder bucketing matches business-timezone expectations.

### 6.3 — [Low] `jobStockMonitoring` dedupe key includes the fluctuating stock count, causing repeat alerts for one ongoing condition
**Current behavior:** dedupe key is `` `stock_alert:${item.stockId}:${item.available}` `` (`automation.scheduler.service.ts:403`) — every distinct `available` value re-triggers a new notification, unlike the day/bucket-based keys every other job uses.
**Impact:** Bounded but avoidable notification noise as stock fluctuates near a threshold (e.g. concurrent reservations/returns).
**Recommended fix:** Key by a day-bucket or by "crossing the threshold" transition rather than the raw live value, matching the pattern used by the overdue-escalation job's bucket keys.

### 6.4 — [Low] Role-broadcast notifications share one document/read-state across the whole role
**Current behavior:** `Notification` documents targeted by `recipient_role` (no `recipient_user_id`) are single shared rows with one `is_read`/`read_at` field (`notification.schema.ts:51-73`). `markAsRead`/`clearOne` are correctly ownership-scoped (`visibilityScope`), but for a role-broadcast row, "ownership" is the whole role — so one operator marking it read or deleting it changes what every other operator (or technician, for tech-broadcasts) in that role sees.
**Impact:** Not classic IDOR (no cross-role/cross-identity access), but a real behavioral quirk: no per-recipient fan-out for broadcast notifications.
**Recommended fix:** If per-user read-state for broadcasts is desired, either fan out one document per eligible recipient at creation time, or add a separate per-user read-receipt collection referencing the shared broadcast document.

### 6.5 — [Low] Reassigning an existing work order's operator generates no notification
**Current behavior:** The generic admin `update()` (`work-orders.service.ts:406-425`) never calls the notification service, even when `technician_id` changes — only initial `create()` notifies on assignment.
**Impact:** An operator reassigned to an existing work order via an admin edit (not a fresh creation) gets no notification of the new assignment.
**Recommended fix:** Detect a `technician_id` change in `update()` and emit the same "work order assigned" notification `create()` sends.

### 6.6 — Verified correct: notification IDOR, atomicity, cron idempotency, calendar ownership
- Every notification-center mutation (`markAsRead`, `clearOne`, `markAllAsRead`, `clearAll`) is a single atomic Mongo operation combining an ownership filter (`visibilityScope(userId, role)`) with the mutation — confirmed no IDOR path to read/mutate another specific user's individually-targeted notification.
- Cron dedup for overdue-marking/escalation/upcoming-reminders is race-safe via a DB-level `unique` index on `dedupe_key`, not merely an app-level pre-check — confirmed by direct read of `createIfNotExists`.
- Calendar event access/start/complete/reschedule all require an explicit `technician_id === operatorId` match before any read or mutation — confirmed no IDOR via a guessed/incremented work-order id in the URL.
- The one reschedule endpoint reachable by operators shares its actual validation logic with the admin-only endpoint (same underlying method) — no weaker bypass path.
- Frontend renders server-supplied ISO timestamps verbatim; it does not recompute due/overdue dates client-side, so there's no frontend-vs-backend drift risk (only the backend-internal drift documented in 6.1/6.2).
- The only WebSocket gateway in the codebase is for device telemetry (unrelated to notifications, which are REST-polling only) and is itself correctly JWT-authenticated with per-user/machine room scoping.

---

## 7. Summary — verified correct (non-issues, explicitly checked)

To keep confirmed defects distinguishable from non-issues, the following were explicitly checked and found **correct**, with no further action needed:

- Approval status can never silently regress from approved to pending (§1.1).
- No stale-session window — deactivated/rejected accounts are blocked on their very next request (§1.2).
- Profile-completion gating is enforced server-side, not just in the frontend (§1.3).
- Public registration cannot self-assign the `admin` role; role/status defaults on creation are correct (pending/inactive/unverified).
- JWT payload carries no stale status snapshot; refresh-token rotation is atomic with reuse detection.
- Global `JwtAuthGuard`→`RolesGuard` enforcement applies to every controller by default; role is read only from the verified JWT, never from client input.
- Every operator-mutating endpoint combines role checks with resource-ownership checks (not role-only), verified across work orders, preventive tasks, corrective reports, parts requests, documents (aside from 4.5), and calendar actions.
- All timestamps on real operator-facing writes (`date_start`, `execution_date`, `date_end`, `validated_at`, `requested_at`) are server-generated; DTOs structurally exclude client-writable identity/status/date fields, enforced by a global strict `ValidationPipe`.
- Start/Complete/Submit/part-request-decision transitions are atomic and status-guarded (aside from the one Admin-only exception in §2.2) — genuine duplicate-submission and race protection, not just app-level checks.
- Stock is never decremented at parts-request time; reservation is atomic and structurally prevents over-commitment.
- Self-approval is blocked at both the technician-review layer and the final admin-validation layer — operators and technicians cannot validate their own work.
- Missing-assignment (an operator with zero machines/work orders) is handled gracefully everywhere traced — empty states, not crashes.
- Evidence/document uploads are validated via magic bytes (not trusted extension/MIME), quarantined with an audit trail on rejection, and stored under server-generated filenames immune to path traversal.
- Notification read/unread mutations are atomic and ownership-scoped; cron-driven reminders are race-safe deduplicated and correctly recipient-targeted.
- No WebSocket channel handles notifications (REST polling only); the one real-time gateway that exists (device telemetry) is unrelated and independently authenticated/scoped.

---

## 8. Prioritized remediation plan

Ordering balances severity, blast radius, and how many other findings each fix unblocks. All recommendations preserve existing Admin and Technician logic — none require changing Admin/Technician-facing behavior, only adding/correcting operator-facing paths and closing gaps in shared code.

**P0 — broken core functionality / data exposure (fix first)**
1. §5.1 — Wire `operator/my-reports` save/submit/delete to a working, ownership-checked endpoint (or remove the dead affordances). Unblocks §5.2 (drafts).
2. §4.1 — Rewire `operator/corrective` to the correct `POST /operator/report-problem` flow (or remove the page).
3. §4.3 — Fix the `returned`-status dead-end so operator-originated corrective/preventive reports remain actionable by someone after `request_correction`.
4. §3.1 — Fix admin-activated first preventive occurrences so they're claimable/assignable, not permanently unreachable.
5. §1.4 — Stop leaking password/refresh-token hashes via unrestricted `.populate('technician_id')` in `getMyReports` (and the admin-side `intervention-reports.service.ts` equivalent).

**P1 — security-relevant gaps and high-value correctness fixes**
6. §4.5 — Add ownership checks to document `work_order_id`/`intervention_report_id` linkage (closes an authenticated IDOR).
7. §3.4 — Enforce checklist completeness server-side for preventive submissions.
8. §2.2 — Make `applyValidationAction`'s write atomic/status-guarded, matching the rest of the file.
9. §6.1 / §3.3 / §6.2 — Unify all business-day/timezone computations (calendar grid, widget, notification cards, next-due-date math, cron day-boundaries) on the existing `business-time.ts` helper.

**P2 — workflow governance and data-quality**
10. §3.6 — Add a reschedule policy (minimum future date at least; cap/approval as a product decision).
11. §4.4 — Validate `code_panne` against the fault catalog server-side.
12. §5.3 — Add a rejection/correction reason field, surfaced to the operator.
13. §2.1 — Align `getCalendarEventDetails` action flags with the real per-action status guards.

**P3 — low-severity cleanup**
14. §6.4 — Per-recipient read-state for role-broadcast notifications, if desired.
15. §6.3 — Fix stock-alert dedupe key to bucket on threshold-crossing, not raw fluctuating value.
16. §6.5 — Notify on reassignment via admin edit, not just initial creation.
17. §3.2 — Re-evaluate duplicate-occurrence guard once §3.1 is fixed.
18. Documentation cleanup: stale comment in `getMachinePreventiveStates` (§3.7); consider removing/consolidating the legacy `ot-pieces` and unused `getCalendarEventsForOperator` dead code once confirmed safe.
19. Info-level items (§1.5): independently configured Google-exchange encryption key; align the admin generic `update()`'s account-deactivation path with `rejectUser`'s explicit token revocation for consistency.

**Cross-cutting test coverage to add regardless of fix order**
- A recursive "no sensitive key in response body" assertion helper, applied to every operator-facing GET endpoint that populates `User` references.
- Concurrency tests for every status-transition write path that currently lacks one (§2.2).
- A negative IDOR test suite for operator endpoints accepting any foreign-record id in the body (§4.5), and confirmation that all existing ones already reject correctly (many do, verified above).
- Timezone-parameterized tests (non-`Africa/Tunis` process TZ) for every date-boundary computation, to prevent regressions once §6.1/§3.3/§6.2 are fixed.
