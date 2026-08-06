# Staging Smoke-Test Checklist

Run this against a real staging deployment (see `DEPLOYMENT.md`'s "Staging
environment" section for how to stand one up) before promoting a release,
or any time staging itself needs a health check after infrastructure
changes. Each item names the exact endpoint/behavior and what a pass looks
like — not "check that it works," but a specific, verifiable outcome.

This is a **manual, human-run checklist**, broader than
`backend/scripts/smoke-test.ts` (which `cd-deploy.yml` already runs
automatically and only checks `/health`/`/health/api`). Run the automated
script first; if it fails, stop — nothing below will work either.

```bash
cd backend
npm run smoke-test -- --url=https://<staging-backend>.onrender.com
```

## 0. Prerequisites

- [ ] Staging backend URL and staging frontend URL both resolve and serve
      HTTPS.
- [ ] One seeded test account per role exists in the **staging** database
      (never reuse production credentials against staging): one `admin`,
      one `technician`, one `operator`, each `is_active`, `is_verified`,
      `approval_status: approved`.
- [ ] `NEXT_PUBLIC_API_BASE_URL` on the staging frontend points at the
      staging backend (not production) — check the frontend's Vercel
      project env vars before starting.

## 1. Health, liveness, readiness, metrics (no login required for the first three)

| Check | Endpoint | Expect |
|---|---|---|
| Liveness | `GET /health/live` | `200`, `{"status":"ok","service":"api",...}` |
| API liveness (alias) | `GET /health/api` | `200`, same shape |
| Readiness (DB-aware) | `GET /health` | `200`, `{"status":"ok",...}`; if MongoDB Atlas is briefly unreachable this should report `degraded`/non-200, not silently report healthy |
| DB health (admin-gated) | `GET /health/db` with no auth | `401` |
| DB health (admin-gated) | `GET /health/db` with admin token | `200` |
| Email health (admin-gated) | `GET /health/email` with admin token | `200` (or a clear `degraded` status if SMTP isn't configured for staging — not a crash) |
| Metrics (admin-gated) | `GET /health/metrics` with no auth | `401` |
| Metrics (admin-gated) | `GET /health/metrics` with admin token | `200`, `Content-Type: text/plain; version=0.0.4...`, body contains `# TYPE http_requests_total counter` and at least one `http_requests_total{method="GET",route="/health",...}` line (proves `RequestLoggingMiddleware` is actually recording, not just that the endpoint responds) |

## 2. Structured logging

- [ ] If `LOG_FORMAT=json` is set for staging: open Render's log stream
      for the staging backend service, make one request (e.g. `GET
      /health`), confirm the corresponding log line is a single-line JSON
      object with `requestId`, `method`, `path`, `status`, `timestamp`
      fields — not the pipe-style text format.
- [ ] If `LOG_FORMAT` is unset: confirm the log line is the pipe-style
      text format (`requestId=... method=... path=... status=...`) —
      either is correct, but confirm it matches what's actually
      configured, not silently something else.
- [ ] Trigger one deliberately-invalid request (e.g. `GET
      /nonexistent-route`) and confirm the resulting log line includes the
      same `requestId` that comes back in the response's `x-request-id`
      header — proves request/response/log correlation actually works
      end-to-end, not just in isolation.

## 3. Sentry (backend + frontend)

Only meaningful once a real `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` is
configured for staging — until then, confirm the *safe-no-op* behavior
instead:

- [ ] With no DSN configured: confirm the backend boots normally
      (`npm run smoke-test` passes) and a deliberately-triggered 500 error
      doesn't crash the process or hang the response — `Sentry.
      captureException` silently no-ops as documented in
      `backend/src/instrument.ts`.
- [ ] Once a real DSN is configured for staging: trigger one real backend
      500 (any request that hits an unhandled exception path) and one real
      frontend render error (temporarily throw inside a component wrapped
      by `ErrorBoundary`), then confirm both appear as new issues in the
      Sentry project within a few minutes, each tagged with the
      environment (`staging`) so they're never confused with production
      events.

## 4. CORS

- [ ] From a browser devtools console on the **staging frontend's actual
      origin**, `fetch()` the staging backend's `/health` — succeeds, no
      CORS error.
- [ ] From a browser devtools console on any **other** origin (e.g.
      `https://example.com` via a local static file, or the production
      frontend origin if staging must stay isolated from it), the same
      `fetch()` is blocked by CORS — confirms `CORS_ORIGINS` for staging
      is scoped to the staging frontend only, not wildcard-permissive.

## 5. Cookies (login flow)

- [ ] `POST /auth/login` with the seeded Admin credentials from a real
      browser (not curl, so cookie attributes are inspectable) → inspect
      the response's `Set-Cookie` header(s) in devtools → confirm
      `HttpOnly`, `Secure`, and `SameSite=None` (or `Lax`/`Strict` if
      staging intentionally differs from production — confirm it's a
      deliberate choice, not an accident) are all present on the refresh
      cookie.
- [ ] Confirm the access token is **not** in a cookie at all (this app
      keeps it in memory/short-lived storage, not a cookie) — check
      devtools' Application/Storage tab for cookies, the access token
      should not appear there.
- [ ] `POST /auth/refresh` using the browser's session (cookie sent
      automatically) → `200`, new access token returned, refresh token
      rotated (old refresh token cookie value differs after this call).

## 6. Uploads

- [ ] **Document upload** (`POST /documents/upload`, Technician or Admin):
      upload a real PDF under 10MB → `201`, document appears in the
      documents list, downloadable.
- [ ] **Document upload — size limit enforced before buffering**: attempt
      to upload a file over 10MB → `413 Payload Too Large`, returned
      promptly (within a few seconds even on a slow connection) — proves
      Multer's `limits.fileSize` is rejecting the stream early, not
      buffering the whole oversized file into memory first before
      checking (the actual Phase C security fix this checks for).
- [ ] **Avatar upload** (`POST /users/upload-photo`, Admin): upload a
      photo for a user → `200`, avatar updates; confirm the stored/served
      avatar does **not** include `api_key_hash`-style leakage — not
      applicable to users, but re-confirm no unrelated sensitive field
      appears in the response body.
- [ ] **Device photo/telemetry** if staging has a registered test device:
      confirm a heartbeat/telemetry submission from device credentials
      succeeds and is rejected with the correct device-only error code
      when attempted with a user JWT instead (`SOCKET_ACCESS_DENIED` over
      the `/live` WebSocket namespace, or the equivalent REST rejection).

## 7. Work-order transactions (Phase B — completion side effects)

As Admin or Technician:

- [ ] Create a work order directly in `completed` status (or transition
      an existing one to `completed`/`validated`) for a machine that has
      an active preventive maintenance plan.
- [ ] Confirm, in the same pass: an intervention report was
      auto-generated for it, the machine's KPI record was recomputed
      (check `GET /kpis` or the dashboard for updated MTTR/MTBF), and — if
      the plan's next occurrence was due — a new preventive work order was
      created.
- [ ] **Failure-injection spot check** (optional, more thorough): if you
      can temporarily point staging at a MongoDB user with reduced
      permissions or otherwise force one of the three follow-on writes to
      fail, confirm the work order itself is **not** left in `completed`
      status with no matching report — the whole write should roll back
      together (see `test/work-order-command-transaction.e2e-spec.ts` for
      the automated version of this exact check).

## 8. Stock integrity (Phase B — OtPieces / StockMovements)

As Admin or Technician:

- [ ] Create a stock record for a test part with a known quantity (e.g.
      10).
- [ ] Record parts usage against a work order (`POST /ot-pieces`) for
      that part → confirm the stock's `quantite_en_stock` decreases by
      exactly the used amount, and a `consumption` stock movement was
      recorded (`GET` the part's movement history).
- [ ] Update the usage record to a different part that has **no** stock
      record at all → expect a `404`, and confirm the **original** part's
      stock was not left partially reversed (it should show the same
      quantity as before the failed reassignment attempt) — this is the
      atomic-rollback guarantee from Phase B, not just "the second write
      failed."

## 9. Role-scoped access — one pass per role

Repeat the relevant subset of the checks above signed in as each role, and
additionally confirm:

### Admin

- [ ] Full access to `/health/db`, `/health/email`, `/health/metrics`.
- [ ] Full access to the Users page (list, approve/reject pending
      accounts, force password reset).
- [ ] Full access to every machine/work order, not scoped to an
      assignment.

### Technician

- [ ] `/health/db`, `/health/email`, `/health/metrics` all return `403`
      (authenticated, wrong role) — not `401`.
- [ ] Can view and act on work orders assigned to them or their
      claimable machines; cannot access another technician's
      unrelated/unassigned work orders (expect `403` or a filtered `404`,
      confirm which one this app returns and that it's consistent).
- [ ] Can submit a corrective report and record parts usage.

### Operator

- [ ] Same `403` expectation as Technician for admin-only health routes.
- [ ] Can only see machines/work orders they're assigned to — attempt to
      access a machine explicitly *not* assigned to this operator (by ID,
      guessed or from another account) → `403`, not data leakage.
- [ ] Can complete a preventive maintenance execution form and see it
      reflected in their own history, not another operator's.

## Sign-off

| Section | Pass/Fail | Notes | Checked by | Date |
|---|---|---|---|---|
| 1. Health/liveness/readiness/metrics | | | | |
| 2. Structured logging | | | | |
| 3. Sentry | | | | |
| 4. CORS | | | | |
| 5. Cookies | | | | |
| 6. Uploads | | | | |
| 7. Work-order transactions | | | | |
| 8. Stock integrity | | | | |
| 9. Role-scoped access (Admin) | | | | |
| 9. Role-scoped access (Technician) | | | | |
| 9. Role-scoped access (Operator) | | | | |
