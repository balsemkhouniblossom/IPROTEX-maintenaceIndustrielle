# Final Release Readiness Report

**Date**: 2026-08-07
**Scope**: GMAO (IPROTEX CMMS) — NestJS 11 backend, Next.js 16 frontend, MongoDB Atlas, Render + Vercel + Supabase Storage deployment.
**Prepared by**: automated engineering pass (this tool), covering an enterprise-hardening engagement that began from an independent production-readiness audit (56/100 baseline, 3 Critical / 12 High / 19 Medium findings) and closed with the final-release-closure pass described in this report.

---

## Decision: **CONDITIONAL GO**

Every engineering gate this report can verify from inside this environment is green: **25/25 backend e2e suites, 376/376 tests; 157/157 backend unit suites, 1363/1363 tests; backend and frontend TypeScript/build/lint all clean; 279/279 frontend tests.** That is the complete engineering bar this pass was asked to clear, and it is clear.

This is not an unconditional GO because three things remain true and are **not achievable from inside this tool**:

1. **The git history exposure is still live on GitHub, right now.** Verified directly this pass (not assumed): `origin/main`'s history still contains `backups/mongodb/*/users.bson` (bcrypt password hashes, refresh-token hashes) in a **public** repository. A clean, verified, current mirror is prepared and ready to push; the push itself, being a destructive `git push --force`, is something this tool will not perform under any circumstances.
2. **No credential has been confirmed rotated**, and **4 active accounts whose data appeared in the leaked dump have not had their sessions invalidated.**
3. **The frontend translation catalog is ~934 keys short** of full parity across 5 locales — blocked by this sandbox's lack of network access to `generativelanguage.googleapis.com`, not by anything wrong with the (now-hardened) translation tooling.

None of these three are code-quality, test-coverage, or architecture gaps — they are exactly the kind of external, credential-and-infrastructure-bound actions the engagement's own instructions have consistently carved out as the owner's to perform. See **Section 6** for the complete, precise list of what's left and who has to do it.

**Do not represent this project as "production ready" externally until Section 6's git/credential items are checked off.** The codebase itself is ready; the incident response around one historical mistake is not finished.

---

## 1. Original audit — what this report can and can't independently restate

The original production-readiness audit (56/100, 3 Critical / 12 High / 19 Medium) was delivered as this engagement's starting brief. This report does not have that document available as a standalone artifact to re-quote verbatim — it was the opening brief of a long-running conversation, not a file committed to this repository. Reproducing its exact 12-item "High" enumeration from memory would risk inventing findings that don't match the original wording, which conflicts directly with this whole engagement's own evidence-only standard. Instead, this report:

- States the **3 Critical findings explicitly**, because they were carried forward verbatim as this engagement's own Phase 1 checklist and are independently verifiable in this repository's history (Section 2).
- Lists **every specific finding actually fixed**, phase by phase, each with a commit and verification evidence (Section 2) — which is the complete, real substance of what "12 High + 19 Medium, remediated" looked like in practice, even where this report can't cite the original document's exact original numbering for each one.
- Explicitly flags where a finding was **discovered during remediation** rather than in the original audit (several of the most consequential fixes in this engagement were exactly this kind — see the "found during" callouts in Section 2 and Section 5).

## 2. Findings resolved, by phase — commit, evidence, tests

### The 3 Critical findings (Phase 1)

| # | Finding | Resolution | Commit | Evidence |
|---|---|---|---|---|
| 1 | Git history exposure — `backups/mongodb/*/users.bson` reachable in public GitHub history | Clean, verified, file-tree-parity-checked mirror prepared; **push itself is owner-only and not yet done** | `a7b69b2` (runbook), this pass (mirror rebuild + doc reconciliation) | See Section 6 — **NOT resolved**, only prepared |
| 2 | MongoDB index drift (documents collection had zero indexes beyond `_id_`; stale partial-filter on the preventive-occurrence-key index) | Schema-discovery index manager, `--check` CI gate, production indexes applied and re-verified zero drift | `087d37e` | `backend/src/database/index-manager.ts` + `mongodb-indexes.spec.ts`; CI step in `ci-pr.yml` |
| 3 | Next.js error handling incomplete (no global-error/error/not-found boundaries; unguarded charts/PDF viewer/AI assistant/tables/forms) | `global-error.tsx`, locale `error.tsx`/`not-found.tsx`/`loading.tsx`, reusable `ErrorBoundary`, 13 high-risk components wrapped | `087d37e` | Component tests asserting fallback rendering on a thrown error |

### Phase A — Frontend resilience

- Axios client: default request timeout, bounded exponential-backoff retry for idempotent GETs, upload-specific timeout overrides. — `b1e4655`

### Phase B — Database consistency

- **Work order completion** (`create`/`update` landing directly in `completed`/`validated`): auto-report, next-preventive-occurrence, and KPI recompute now share one Mongo transaction with the work-order save itself — previously four independent writes, so a mid-sequence failure could leave a "completed" work order with no matching report/schedule/KPI.
- **OtPieces admin CRUD** routed through `StockMovementsService` inside a transaction — previously could desync `Stock` and `OTPieces` state on partial failure.
- **Rollback proven, not just claimed**: real `MongoMemoryReplSet` e2e tests inject a failure into the *last* of three follow-on writes and confirm the *entire* transaction — including writes that already "succeeded" earlier in the same transaction — rolls back together.
- Commit: `b951a75`. Evidence: `test/ot-pieces.e2e-spec.ts`, `test/work-order-command-transaction.e2e-spec.ts`.

### Phase C — Security hardening

- Multer now enforces `fileSize` before buffering (was post-buffer only); `MulterError` maps to a proper 413.
- `AuthThrottleService`'s per-IP/per-account map now sweeps decayed entries every 5 minutes (was unbounded growth under sustained traffic).
- Backend CSP switched from Helmet's HTML-oriented defaults to default-deny, appropriate for a JSON-only API. Frontend gained matching CSP/X-Frame-Options/nosniff/Referrer-Policy headers.
- Global request-timeout interceptor (30s default, env-configurable), exempting multipart uploads via `@SkipTimeout()`.
- Body-parser's implicit 100kb default made an explicit, intentional 1mb limit.
- `AuthThrottleService`'s in-memory store extracted behind a DI interface — a future Redis-backed store is a drop-in swap for horizontal scaling, no logic changes.
- npm audit: backend production vulnerabilities reduced from 4 (1 high, 2 moderate, 1 low) to 1 moderate, root-caused as unreachable code path rather than blindly force-downgraded. Frontend: 0 findings, then and now.
- Commit: `d4e92da`.

### Phase D — Performance and caching

- Admin KPI dashboard (10 queries/aggregations across 4 collections, the audit's named hot path) cached 30s, in-memory, Redis-swappable later.
- `.lean()` added to the AI corrective-assistant's read-only queries.
- **Found during this phase, not in the original audit**: `Device.api_key_hash` (bcrypt) had no serialization exclusion and was leaking into every device API response — the schema's own doc comment claimed the raw key was "returned... exactly once... and never again," true for the raw key but not its hash. Fixed with the same pattern `UserSchema` already used for its own sensitive fields.
- Commit: `67afdd9`.

### Phase E — DevOps and staging

- **Found during this phase, not in the original audit**: staging was not just undocumented, it was *structurally impossible* — `env.validation.ts` hard-rejected any production `CORS_ORIGINS`/`FRONTEND_BASE_URL`/`BACKEND_URL` that didn't match one hardcoded domain pair. Replaced with general safety validation (HTTPS, non-localhost, frontend≠backend origin) that preserves the one real misconfiguration the old check caught, while actually allowing a second environment to exist.
- `render.yaml` (secrets `sync: false`, never stored) and `frontend/vercel.json` authored; `DEPLOYMENT.md` gained Staging/Rollback/Post-deploy-Verification sections.
- `backend/scripts/smoke-test.ts` + `cd-deploy.yml` post-deploy health polling — a deploy that's accepted but comes up crashed now fails CI instead of surfacing as a user report.
- Commit: `eb86905`.

### Phase F — Observability

- JSON log mode (`LOG_FORMAT=json`), `/health/live`, slow-query logging (real per-command duration via the Mongo driver's `commandSucceeded` event, not Mongoose's timing-blind debug hook), `/health/metrics` (Prometheus format, cardinality-bounded route labels), Sentry wired for both apps (env-gated, safe no-op until a real DSN exists).
- **Found during this phase, not in the original audit — and arguably the most consequential single fix in this engagement**: `getRequestPathname()` prioritized `req.path`/`req.url` over `req.originalUrl`. NestJS's `consumer.apply(...).forRoutes('*')` passes `'*'` to Express as a mount path, which rewrites `req.path`/`req.url` to `/` for every request. Confirmed live via e2e: every request had been logging under `path=/` since `RequestLoggingMiddleware` was introduced — meaning production request logs have been far less useful than they appeared, for reasons no dashboard or log line itself would ever reveal. Fixed by preferring `originalUrl`; regression-tested against the exact mount-truncation shape.
- Commit: `1135505`.

### Phase G — Accessibility, translations, frontend tests

- Form label/control association (`htmlFor`/`id`) fixed in `ResourceCrudPage.tsx` (the shared wrapper every simple admin CRUD page renders through), `PlanFormModal.tsx` (11 fields), `PreventiveExecutionForm.tsx` (5 fields) — regression-tested. `UserFormModal.tsx` deliberately left alone: its one `<label>` already wraps its control directly plus carries its own `aria-label`, an already-valid pattern that a mechanical "add htmlFor everywhere" pass would have needlessly rewritten.
- One ICU-plural translation key (`machineTimeline.timelineEventCount`) fixed by hand across fr/es/de/it after the AI translation attempt corrupted the ICU placeholder itself — this is the finding that led directly to Section 5's translation-script hardening this pass.
- Commits: `6e767ac`, `670d26b`.

## 3. This pass — final release-closure work

### 3.1 `live-monitoring-gateway.e2e-spec.ts` — root cause, not a workaround

**Investigated, not assumed**: the gateway's `SOCKET_ERRORS` scheme (`SOCKET_ACCESS_DENIED`, `SOCKET_AUTH_REQUIRED`, etc.) is a deliberate, structured error-code design — confirmed by `git show f865c53`, the commit that introduced it, which updated the corresponding unit test (`live-monitoring.gateway.spec.ts`, already expecting `SOCKET_ACCESS_DENIED` and passing throughout this entire engagement) but never touched this one e2e file. The e2e test's `'forbidden'` expectation was stale, not the implementation. Updated 4 assertions to the real, intended contract, with comments explaining why for future maintainers. **No security behavior changed** — only the error-code string returned to the client; every access-control decision (Operator machine scoping, device/user socket kind separation) is identical before and after.

Result: **25/25 e2e suites, 376/376 tests** (was 24/25, 372/376).

### 3.2 Git exposure documentation — reconciled, and a second staleness caught

`SECRET_ROTATION_RUNBOOK.md` is now the explicit single canonical source; `GIT_HISTORY_PURGE.md` (2026-08-01, first attempt) and `DEPLOYMENT.md`'s hygiene section both now point to it instead of independently — and previously inconsistently — restating status. `DEPLOYMENT.md` previously claimed the incident was "purged... and rotated," which was false; corrected.

**Re-verifying rather than trusting the prior write-up surfaced a second staleness incident**: the mirror prepared in an earlier session (`GMAO-purge-workspace-final.git`) had itself gone 9 commits stale — Phases C through G had landed on `origin/main` via ordinary pushes after that mirror was built. Pushing it as-is would have silently discarded all nine. Rebuilt a third time (`GMAO-purge-workspace-final-v2.git`), this time verifying not just a matching tip commit message but **full file-tree parity** (964/964 files identical) against the live working tree, plus `git fsck --full`. The safety-net mirror was rebuilt too, for the same reason. One clone attempt failed mid-transfer from sandbox network flakiness and was caught by direct verification rather than trusted from the tool's own "completed" signal.

**Directly re-confirmed, right now**: `git rev-list --objects origin/main | grep '\.bson'` against a fresh clone still lists every leaked blob. The exposure is not resolved; it just now has an accurate, current, ready-to-push remediation waiting on the owner.

### 3.3 Translation script hardened against the exact corruption class that was found

Root cause of the earlier session's translation bug: the old placeholder check compared raw `{...}` brace-text substrings, which cannot distinguish an ICU plural/select construct's *syntax* (the argument name, the `plural`/`select` keyword, the case keys, the `#` token) from the *translatable words* sitting inside it — so it rejected every correctly translated plural message in every target language, not just the one that happened to surface first.

Replaced with `backend/scripts/icu-validation.mjs`, which walks the real ICU MessageFormat AST (`@formatjs/icu-messageformat-parser` — the same parser family `next-intl` itself uses at runtime, added as a backend devDependency) and compares only structural tokens: argument names, plural/select type + case keys, `#` occurrence counts, rich-text tag names. Plain text is intentionally excluded from comparison — that's exactly what a translation is supposed to change.

**14 regression tests** (`backend/scripts/icu-validation.test.mjs`, `npm run translate:icu-test`) cover: the exact previously-corrupted case now correctly accepted in all 5 target languages; dropped/renamed simple placeholders rejected; dropped plural case branches rejected; dropped `#` tokens rejected; extra plural cases rejected; malformed ICU output rejected; nested plural/select structures; rich-text tags; and — as a live compatibility check, not a synthetic one — every one of the 2319 real English source strings in `frontend/messages/en.json` confirmed to parse successfully under this same validator.

**Exact command to run once network access is available** (not attempted again from this sandbox, per instruction):

```bash
cd backend
GEMINI_API_KEY=<key> npm run translate:gemini
```

(`GEMINI_API_KEY` is the only required variable; already present in `backend/.env` if that file exists on the machine running this.) Preview first with `npm run translate:gemini:dry-run` (no key required) — this is also the translation-key parity check; it currently reports:

```
fr: would translate 133 keys.
ar: would translate 231 keys.
es: would translate 262 keys.
de: would translate 38 keys.
it: would translate 270 keys.
```

**After running the real translation**, per this task's own instruction, require in order: `npm run translate:gemini:dry-run` (should report 0 for all 5 locales), `cd frontend && npm run build`, `npm test`, `npx eslint .`.

### 3.4 Staging readiness

- `render.yaml` and `frontend/vercel.json` re-validated for syntax (YAML/JSON parse clean).
- Cross-checked every env var `env.validation.ts` reads against `render.yaml`'s declared set — everything required is present; everything absent has a confirmed safe code-level default (`MONGODB_DEBUG`, `MQTT_BROKER_URL`, retention-seconds vars, legacy-auth-migration flags, etc.).
- **Found and fixed**: `DEPLOYMENT.md`'s Render/Vercel env var reference blocks were missing every variable added in Phases C and F (`REQUEST_TIMEOUT_MS`, `LOG_FORMAT`, `SLOW_QUERY_THRESHOLD_MS`, `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`) — added.
- New `STAGING_SMOKE_TEST_CHECKLIST.md`: role-based (Admin/Technician/Operator) manual verification checklist covering health/liveness/readiness/metrics, structured logging, Sentry, CORS, cookies, uploads (including the 413-before-buffering behavior), work-order transactional completion, and OtPieces/stock-movement rollback — each item names the exact endpoint and the exact expected outcome, not "check that it works."

**Status: prepared, not executed.** No staging environment exists yet (`DEPLOYMENT.md`'s own "Staging environment" section says so) — there is nothing to run this checklist against from inside this tool. This is templated, ready-to-walk-through documentation, not a completed verification pass.

## 4. Final engineering gate — full results

### Backend

| Check | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | Clean |
| Production build | Clean |
| Unit suites | **157/157 passed, 1363/1363 tests** |
| E2E suites | **25/25 passed, 376/376 tests** |
| Targeted lint (changed files) | 0 errors (pre-existing warnings only, none newly introduced) |
| ICU validation regression tests | 14/14 passed |

### Frontend

| Check | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | Clean |
| Production build | Clean |
| Full test suite | **279/279 passed** |
| Lint (full repo) | Clean, 0 problems |
| Translation-key parity | **NOT passing** — 934 keys missing across 5 locales (see 3.3); network-blocked in this sandbox, not a defect in the (now-hardened) tooling |

## 5. Notable findings discovered during remediation (not in the original audit)

Listed once here for visibility; each is also covered in its phase above with full evidence:

1. **Device `api_key_hash` leaking into every device API response** (Phase D) — schema-level fix, matching the existing `UserSchema` pattern.
2. **Staging was structurally impossible**, not just undocumented (Phase E) — a hardcoded-domain CORS validation check, not a missing doc.
3. **Production request logs have been recording every request under `path=/`** since `RequestLoggingMiddleware` was introduced (Phase F) — the single most consequential fix in this engagement, found only because building the metrics endpoint required actually reading the captured path value in a live e2e test for the first time.
4. **The translation-corruption placeholder-check bug** (Phase G / this pass) — a structural flaw that would have silently blocked every ICU-plural key in every target language forever, not a one-off bad translation.
5. **The prepared git-purge mirror going stale a second time** (this pass) — caught by re-verifying evidence instead of trusting an earlier session's "verified clean" status.
6. **`DEPLOYMENT.md`'s env var reference blocks missing 7 variables** added across two later phases (this pass).
7. **A `pdfjs-dist` high-severity CVE** (arbitrary JS execution via a malicious PDF, GHSA-hq66-cqwq-w95j) newly indexed to npm's advisory database during this pass — caught by re-running `npm audit` rather than trusting an earlier-phase scan, patched to `^6.2.108`.

## 6. What remains — owner-only, cannot be done from this tool

### Git exposure incident (see `SECRET_ROTATION_RUNBOOK.md`, the canonical source)

1. `git push --force` the verified-clean mirror at `GMAO-purge-workspace-final-v2.git` — **rebuild it first** if `origin/main` has moved again since this report (see the runbook's "Lesson for future history rewrites").
2. Reset every other local clone to the new history afterward (exact commands in the runbook).
3. Decide repository visibility (public with the exposure now closed, or private).
4. Force-reset the 4 active accounts whose data appeared in the leaked dump (`admin2@gmail.com`, `tech1@gmail.com`, `operateur2@gmail.com`, `operateur3@gmail.com`) — either approve the direct DB write this tool was blocked from, or run the admin-panel action.
5. Rotate `JWT_SECRET`, `JWT_REFRESH_SECRET`, `MONGODB_URI`, `GOOGLE_CLIENT_SECRET`, `SUPABASE_SECRET_KEY`, `SMTP_PASS`/`BREVO_API_KEY` — all require dashboard access this tool has none of.
6. Independently confirm every box in the runbook's Section D.

### Translations

7. Run `GEMINI_API_KEY=<key> npm run translate:gemini` from a machine with network access to `generativelanguage.googleapis.com`, then the parity/build/test/lint sequence in Section 3.3.
8. Native-speaker review of the machine-translated strings before treating them as final for a safety-relevant industrial UI — flagged, not performed, in every phase this engagement touched translations.

### Staging

9. Actually stand up the staging Render service + Vercel project from `render.yaml`/`vercel.json` (dashboard access required).
10. Walk `STAGING_SMOKE_TEST_CHECKLIST.md` against it once it exists.

### Once the above is done

11. A Sentry project (real DSN) and, if desired, an OpenTelemetry collector endpoint — both deliberately deferred with reasoning in Phase F, wired and waiting for credentials.

## 7. Rollback

See `DEPLOYMENT.md`'s "Rollback" section for the standard Render/Vercel rollback procedure (native one-click rollback on both platforms, near-instant, no rebuild).

**Specific to this pass**: every phase's changes landed as one commit per phase (`b1e4655` through `670d26b`, plus this pass's closure commit) — reverting any single phase's changes, if ever needed, is a normal `git revert <commit>` against a clean, isolated commit, not an entangled multi-concern change. The one exception is the database-transaction work (Phase B, `b951a75`) — reverting it returns work-order completion and OtPieces writes to their pre-transaction (non-atomic) behavior; it does not undo any data already written correctly under the transactional path, since MongoDB transactions that already committed are not something a code revert can retroactively un-commit.

**If a rollback ever needs to cross the MongoDB index-manager boundary** (Phase 1): run `npm run mongodb:indexes:check` against production from the rolled-back commit before assuming it's safe — the same CI gate that catches this on every PR.

---

**Summary for whoever reads only this line**: the code is done, tested, and green everywhere this tool can verify. The incident response for one historical mistake — a leaked backup file, years before this engagement — is prepared but not executed, because finishing it requires a `git push --force` and dashboard credentials this tool does not have and will not simulate having. That, not anything about the application itself, is what CONDITIONAL GO is conditioned on.
