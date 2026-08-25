# Deployment Environment

This is the canonical deployment document for the GMAO project. The project
runs entirely natively — there is no Docker, Docker Compose, container, or
self-hosted Nginx anywhere in local development or production.

- **Frontend**: Next.js, deployed on **Vercel**
- **Backend**: NestJS, deployed on **Render**
- **Monitoring**: Prometheus and Grafana, deployed on **Render** from
  [`monitoring/`](monitoring/)
- **Database**: **MongoDB Atlas**, via a direct `mongodb+srv://` connection
- **File storage**: **Supabase Storage**
- **TLS and routing**: handled by Render and Vercel directly

## Environment variable placement — quick reference

Every credential is a **Render (backend) environment variable, never a
Vercel one**. Vercel gets only public `NEXT_PUBLIC_*` variables. If a
variable name does not start with `NEXT_PUBLIC_`, it must never be added to
the Vercel project — anything Next.js exposes to the client bundle has to be
explicitly prefixed `NEXT_PUBLIC_`, and no code in `frontend/src` reads any
project-configured variable without that prefix (verified by an automated test — see
[`frontend/tests/env-secret-exposure.test.ts`](frontend/tests/env-secret-exposure.test.ts)).

| Variable | Where it lives | Why |
| --- | --- | --- |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`, `EMAIL_VERIFICATION_SECRET`, `GOOGLE_LOGIN_EXCHANGE_ENCRYPTION_KEY` | Render only | Sign/verify tokens; a leak forges sessions |
| `MONGODB_URI` | Render only | Embeds database credentials |
| `SMTP_USER`, `SMTP_PASS`, `BREVO_API_KEY` | Render only | Mailbox/API credentials |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Render only | OAuth client secret |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET*` | Render only | Service-role storage access |
| `GEMINI_API_KEY` | Render only | Billable AI provider credential |
| `CORS_ORIGINS`, `FRONTEND_BASE_URL`, `BACKEND_URL`, `APP_URL`, `API_URL`, `GOOGLE_CALLBACK_URL` | Render only | Server-side config, not secret, but has no reason to exist client-side |
| `METRICS_BEARER_TOKEN` | Render backend and Render Prometheus only | Dedicated bearer token for Prometheus scraping `GET /health/metrics`; not a user JWT |
| `GF_SECURITY_ADMIN_PASSWORD` | Render Grafana only | Grafana administrator password |
| `NEXT_PUBLIC_API_BASE_URL` | Vercel only | Public Render backend URL used by the frontend API client |
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel only, optional | Public Supabase project origin if the frontend needs to resolve public/signed asset URLs |
| `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | Vercel only, optional | Public frontend error-tracking config; unset keeps Sentry disabled |

The repo-root `.env.production` file is a **placeholder reference
template only** — every credential in it is a literal `<placeholder>`
string. It is never loaded by the running application (see "Local
Development" below) and exists purely so the exact variable names Render
needs are documented in one place; the real values are set directly in the
Render dashboard (or via `render.yaml`/Render's secret store), never
committed anywhere.

## Local Development

Backend:

```bash
cd backend
npm install
npm run start:dev
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Local endpoints:

```text
Frontend: http://localhost:3000
Backend:  http://localhost:3001
```

The backend loads its configuration only from files in the `backend/`
directory (see `backend/src/load-env.ts`): `backend/.env`, then
`backend/.env.local`, then `backend/.env.<NODE_ENV>` (e.g.
`backend/.env.production`). A repository-root `.env` file is never read.
Use `backend/.env.example` as the template for `backend/.env`.

The frontend loads its configuration from `frontend/.env.local` (see
`frontend/.env.example` for the template).

## Database

The backend connects directly to **MongoDB Atlas** through:

```text
MONGODB_URI
```

No local MongoDB installation and no MongoDB container are required for
normal development. (The single exception is the backend's automated test
suite, which defaults to `mongodb://localhost:27017/GMAO_IPROTEX_TEST` only
when `NODE_ENV=test` and no `MONGODB_URI` is supplied — the e2e suite uses an
in-process `mongodb-memory-server` for this, not a container.)

## File Storage

Uploaded files are stored in **Supabase Storage**, configured through:

```text
FILE_STORAGE_DRIVER=supabase
SUPABASE_URL
SUPABASE_SECRET_KEY
SUPABASE_STORAGE_BUCKET
SUPABASE_STORAGE_BUCKET_PUBLIC
SUPABASE_SIGNED_URL_EXPIRES_IN_SECONDS
```

`SUPABASE_SECRET_KEY` is a service-role secret. It belongs **only** in
`backend/.env` (local) or Render's backend environment/secrets (production).
**Never** expose it to the frontend or configure it in Vercel.

Production startup requires `FILE_STORAGE_DRIVER=supabase` plus
`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SUPABASE_STORAGE_BUCKET`. If any
are missing or the driver is not `supabase`, the backend exits during startup
validation.

## Production Backend: Render

Configure these as Render backend environment variables or secrets:

```env
NODE_ENV=production
PORT=3001
MONGODB_URI=<mongodb-atlas-uri>
MONGODB_REQUIRE_ATLAS=true
JWT_SECRET=<strong-secret>
JWT_REFRESH_SECRET=<strong-refresh-secret>
JWT_EXPIRES_IN=1d
JWT_REFRESH_EXPIRES_IN=7d
JWT_REFRESH_COOKIE_MAX_AGE_MS=86400000
EMAIL_VERIFICATION_SECRET=<strong-email-verification-secret>
GOOGLE_LOGIN_EXCHANGE_ENCRYPTION_KEY=<32-byte-base64-or-32-character-key>
GOOGLE_CLIENT_ID=<google-client-id>
GOOGLE_CLIENT_SECRET=<google-client-secret>
GOOGLE_CALLBACK_URL=https://your-backend.onrender.com/auth/google/callback
BACKEND_URL=https://your-backend.onrender.com
API_URL=https://your-backend.onrender.com
FRONTEND_BASE_URL=https://your-frontend.vercel.app
APP_URL=https://your-frontend.vercel.app
CORS_ORIGINS=https://your-frontend.vercel.app
TRUST_PROXY=true
FILE_STORAGE_DRIVER=supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=<supabase-service-role-secret>
SUPABASE_STORAGE_BUCKET=uploads
SUPABASE_STORAGE_BUCKET_PUBLIC=false
SUPABASE_SIGNED_URL_EXPIRES_IN_SECONDS=604800

# Outbound email (verification / password reset). SMTP_USER, SMTP_PASS, and
# BREVO_API_KEY are credentials — Render only, never Vercel.
SMTP_HOST=<smtp-host>
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<production-smtp-user>
SMTP_PASS=<production-smtp-password>
SMTP_REJECT_UNAUTHORIZED=true
EMAIL_FROM=<from-address>
EMAIL_DELIVERY_MODE=auto
SMTP_VERIFY_ON_STARTUP=false
SMTP_CONNECTION_TIMEOUT_MS=10000
SMTP_GREETING_TIMEOUT_MS=10000
SMTP_SOCKET_TIMEOUT_MS=15000
SMTP_FALLBACK_COOLDOWN_MS=300000
BREVO_API_KEY=<brevo-api-key>
BREVO_API_URL=https://api.brevo.com/v3/smtp/email
BREVO_API_TIMEOUT_MS=10000
FORGOT_PASSWORD_ASYNC_EMAIL=true
DEFAULT_LOCALE=en

# Auth compatibility flags. Keep disabled unless a temporary migration is
# explicitly active, and then set LEGACY_AUTH_MIGRATION_DEADLINE to a future
# ISO timestamp.
ENABLE_LEGACY_EMAIL_TOKENS=false
ENABLE_LEGACY_RESET_TOKENS=false
LEGACY_AUTH_MIGRATION_DEADLINE=
ENABLE_EVENT_BASED_EMAILS=false
ENABLE_EMAIL_DIAGNOSTIC_TEST=false
EMAIL_DIAGNOSTIC_RECIPIENT=

# Optional backend-only AI assistant. Leave disabled unless Gemini is approved.
AI_ASSISTANT_ENABLED=false
AI_ASSISTANT_PROVIDER=gemini
GEMINI_API_KEY=<gemini-api-key>
GEMINI_MODEL=gemini-flash-lite-latest
AI_ASSISTANT_TIMEOUT_MS=12000
AI_ASSISTANT_RATE_LIMIT_PER_HOUR=20

# Optional operations/device/predictive settings — all have safe code-level
# defaults if unset (see backend/.env.example for the exact default of each).
REQUEST_TIMEOUT_MS=30000
LOG_FORMAT=json
SLOW_QUERY_THRESHOLD_MS=200
BUSINESS_TIMEZONE=Africa/Tunis
MQTT_BROKER_URL=
TELEMETRY_RETENTION_SECONDS=604800
FAULT_EVENT_RETENTION_SECONDS=7776000
PREDICTIVE_MAINTENANCE_ENABLED=true
PREDICTION_HISTORY_RETENTION_SECONDS=15552000
THROTTLE_ENABLED=true
THROTTLE_DEFAULT_TTL_MS=60000
THROTTLE_DEFAULT_LIMIT=120
THROTTLE_DEVICE_TTL_MS=60000
THROTTLE_DEVICE_LIMIT=120
AUTOMATION_SCHEDULER_ENABLED=true
AUTOMATION_BATCH_SIZE=100
AUTOMATION_CONCURRENCY=3
AUTOMATION_EXTERNAL_CONCURRENCY=2
AUTOMATION_LOCK_TTL_MS=300000
AUTOMATION_LOCK_HEARTBEAT_MS=30000
AUTOMATION_JOB_TIMEOUT_MS=600000
AUTOMATION_MAX_ITEMS_PER_RUN=1000

# Backend error tracking — unset means Sentry stays fully uninitialized
# (safe no-op). A Sentry DSN is not a secret (write-only, publishable by
# design), so no special handling is needed if it's ever set here.
SENTRY_DSN=
SENTRY_TRACES_SAMPLE_RATE=0.1

# Prometheus scraping. Generate one strong value and set the same value on
# the Render Prometheus service.
METRICS_BEARER_TOKEN=<strong-random-metrics-token>
```

Render terminates TLS and routes traffic to the backend directly — no
self-hosted Nginx or reverse proxy is used.

### Render Blueprint (`render.yaml`)

`render.yaml` now includes the backend plus `gmao-prometheus` and
`gmao-grafana`. Secret-bearing entries use `sync: false`, so Render prompts
for values instead of reading them from the repository.

The repo-root [`render.yaml`](render.yaml) declares this service (build/start
commands, health check path, safe defaults, and every required secret env var
*name* above). Secret-bearing entries use Render's `sync: false`, which makes
the Render dashboard prompt for the real value instead of reading one from
the file. Applying it (Render dashboard → New → Blueprint, pointing at this
repo) creates the service; it does not deploy code or set secrets on its own.

### Render AI Assistant

When `AI_ASSISTANT_ENABLED=true` in production, startup validation requires
`AI_ASSISTANT_PROVIDER=gemini`, `GEMINI_API_KEY`, and `GEMINI_MODEL`. The
Gemini key belongs only in Render backend secrets. Do not configure it in
Vercel or any `NEXT_PUBLIC_*` frontend variable.

Admins can check backend-only assistant diagnostics at
`GET /ai-assistant/health`; the response reports enabled/configured/provider
status and model, never the API key.

## Production Monitoring: Prometheus and Grafana

The backend exports Prometheus text-format request metrics at
`GET /health/metrics`. That endpoint accepts either an admin JWT or the
dedicated `METRICS_BEARER_TOKEN`; Prometheus uses the dedicated token so
scraping is not tied to a user session.

The deployable monitoring stack lives in [`monitoring/`](monitoring/):

- [`monitoring/prometheus/prometheus.yml`](monitoring/prometheus/prometheus.yml)
  scrapes the production backend every 30 seconds.
- [`monitoring/prometheus/alerts.yml`](monitoring/prometheus/alerts.yml)
  defines backend-down, elevated-5xx, and high-latency alerts.
- [`monitoring/grafana/dashboards/gmao-backend-overview.json`](monitoring/grafana/dashboards/gmao-backend-overview.json)
  is provisioned automatically by the Grafana Render service.

Before deploying `gmao-prometheus` and `gmao-grafana`, set:

```text
Backend Render service:
METRICS_BEARER_TOKEN=<strong-random-token>

Prometheus Render service:
METRICS_BEARER_TOKEN=<same-token>
PROMETHEUS_EXTERNAL_URL=https://gmao-prometheus.onrender.com

Grafana Render service:
GF_SECURITY_ADMIN_PASSWORD=<strong-random-password>
PROMETHEUS_URL=https://gmao-prometheus.onrender.com
```

## Production Frontend: Vercel

Configure only public frontend variables in Vercel:

```env
NEXT_PUBLIC_API_BASE_URL=https://your-backend.onrender.com

# Optional public Supabase project origin. This is not the service-role key.
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co

# Optional frontend error tracking — unset means Sentry stays fully
# uninitialized (safe no-op). See frontend/src/instrumentation*.ts and
# frontend/src/sentry.*.config.ts.
NEXT_PUBLIC_SENTRY_DSN=
NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0.1
```

Do not configure any of the following in Vercel — none of them are read by
any frontend code, and Vercel has no legitimate use for them:
`JWT_SECRET`, `JWT_REFRESH_SECRET`, `EMAIL_VERIFICATION_SECRET`,
`GOOGLE_LOGIN_EXCHANGE_ENCRYPTION_KEY`, `MONGODB_URI`, `SMTP_USER`,
`SMTP_PASS`, `BREVO_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`SUPABASE_SECRET_KEY`, `SUPABASE_URL`, `SUPABASE_STORAGE_BUCKET`,
`FILE_STORAGE_DRIVER`, `GEMINI_API_KEY`, `AI_ASSISTANT_PROVIDER`, or
`GEMINI_MODEL`. Supabase Storage, email, and the AI assistant are accessed
only by the NestJS backend. Vercel terminates TLS and serves the frontend
directly — no self-hosted Nginx is used.

An automated test (`frontend/tests/env-secret-exposure.test.ts`) enforces
this by scanning `frontend/src` for `process.env` references and failing if
anything other than `NODE_ENV`, Next.js runtime variables, or explicitly
public `NEXT_PUBLIC_*` variables is ever read — run as part of
`npm run test` in `frontend/`.

### Vercel project config (`frontend/vercel.json`)

[`frontend/vercel.json`](frontend/vercel.json) declares the framework
preset and build/install commands. Two things it deliberately does **not**
do, because the format has no way to:

- **Root Directory.** This is a Vercel Project Settings value, not file
  config — set it to `frontend` in the dashboard (or run `vercel link` from
  inside `frontend/`) so Vercel finds this file and runs its commands from
  the right place.
- **Public env vars.** Set `NEXT_PUBLIC_API_BASE_URL`,
  optional `NEXT_PUBLIC_SUPABASE_URL`, and any optional frontend Sentry
  variables directly in the Vercel dashboard for this project — see the
  table above for what must *not* be set here.

Security headers (CSP, `X-Frame-Options`, etc.) live in
`frontend/next.config.mjs`'s `headers()` function, not `vercel.json` — one
source of truth instead of two files that can silently drift apart.

## Staging environment

There is currently no staging environment — every deploy from `main` goes
straight to production. Standing one up:

1. **Render**: create a second Web Service from [`render.yaml`](render.yaml)
   (or manually) pointing at the same repo/branch strategy you want to
   stage from (e.g. a `staging` branch). Give it its own `MONGODB_URI`
   (a **separate Atlas project/database** — never point staging at the
   production database) and its own `BACKEND_URL`
   (e.g. `https://gmao-staging-api.onrender.com`).
2. **Vercel**: create a second Vercel project (or use Vercel's Preview
   Deployments against a `staging` branch) with its own
   `NEXT_PUBLIC_API_BASE_URL` pointing at the staging backend from step 1
   and optional `NEXT_PUBLIC_SUPABASE_URL` pointing at the staging Supabase
   project if staging uses frontend-resolved Supabase asset URLs.
3. Set the staging backend's `FRONTEND_BASE_URL` and `CORS_ORIGINS` to the
   staging frontend's origin, and `AI_ASSISTANT_ENABLED=false` unless
   staging genuinely needs to exercise the (billable) Gemini integration.

Until 2026-08, step 1 was impossible: `env.validation.ts` rejected any
`CORS_ORIGINS`/`FRONTEND_BASE_URL`/`BACKEND_URL` in production that didn't
match the exact hardcoded production domains, so a second Render+Vercel
pair could never pass startup validation. That check now validates general
safety properties instead (HTTPS, non-localhost, frontend and backend
never the same origin — the latter specifically catches
`FRONTEND_BASE_URL` silently falling back to Render's own
`RENDER_EXTERNAL_URL`) rather than one hardcoded pair, so a staging
environment with its own domains passes the same validation production
does.

## Rollback

**Render (backend)**: Render keeps a history of previous successful
deploys for the service — from the service's dashboard, open the "Events"
or "Deploys" tab and use "Rollback to this deploy" on the last known-good
build. This restarts the service on the previous build's compiled output;
it does **not** touch environment variables (a rollback that depends on an
env var change being reverted too needs that done manually first) and does
**not** touch the database.

**Vercel (frontend)**: Vercel keeps every deployment immutably — from the
project's "Deployments" tab, find the last known-good deployment and use
"Promote to Production". This is near-instant (it repoints production
traffic at an already-built deployment, no rebuild).

**If the rollback crosses a database migration boundary**: this codebase
has no separate migration-runner (schema changes ship as part of the
backend deploy itself — see `backend/src/database/`). Rolling the backend
back to a version that predates a schema/index change some already-written
documents now rely on can reintroduce the exact drift
`mongodb:indexes:check` (wired into CI, see `ci-pr.yml`) exists to catch.
Before rolling back across such a boundary: run
`npm run mongodb:indexes:check` against production from the rolled-back
commit locally first, and treat any reported drift as a signal to fix
forward (deploy a patch) instead of rolling back, not something to ignore.

## Post-deploy verification

`.github/workflows/cd-deploy.yml` triggers the Render/Vercel deploy hooks,
then polls each service (up to 20 attempts, 15s apart) until it reports
healthy, failing the workflow with a `$GITHUB_STEP_SUMMARY` entry if it
never does — so a deploy that was *accepted* but came up crashed or
misconfigured is caught by CI, not by a user report. The backend check
runs [`backend/scripts/smoke-test.ts`](backend/scripts/smoke-test.ts)
against `secrets.BACKEND_HEALTH_URL` (`/health` and `/health/api`); the
frontend check polls `secrets.FRONTEND_URL` for a 200. Both secrets are
optional — unset, they default to the production URLs already documented
above.

Run the same smoke test manually against any environment, including a
staging one:

```bash
cd backend
npm run smoke-test -- --url=https://gmao-staging-api.onrender.com
```

## Environment file & secret hygiene

- Every real `.env*` file is Git-ignored except the `*.env.example`
  templates (`.env.example`, `backend/.env.example`, `frontend/.env.example`)
  — those three are placeholder-only and safe to commit.
- `backend/.env` is read by the running backend locally; it is never
  committed and never leaves the machine it's created on.
- Local backup archives (code/filesystem/MongoDB dumps) must never be
  committed — a MongoDB dump can contain the `users` collection, including
  bcrypt password hashes and refresh-token hashes. The `backups/` directory
  is Git-ignored for exactly this reason; if you script a new backup
  location, ignore it too before running the backup.
- If a real secret is ever accidentally staged, rotate it — do not rely on
  `git rm`/history rewriting alone, since any clone made before the rewrite
  still has it.
- **This already happened once, and as of 2026-08-06 it is still
  unresolved on GitHub**: `backups/mongodb/*/users.bson` (bcrypt password
  hashes, refresh-token hashes) was committed and is still reachable in
  `origin/main`'s history on GitHub right now. A clean, verified mirror
  with the exposure removed has been prepared locally but not yet pushed,
  no leaked account's session has been invalidated yet, and no credential
  has been confirmed rotated. See
  [`SECRET_ROTATION_RUNBOOK.md`](SECRET_ROTATION_RUNBOOK.md) — the
  canonical, current status and the exact remaining steps — not
  [`GIT_HISTORY_PURGE.md`](GIT_HISTORY_PURGE.md), which describes an
  earlier, now-superseded attempt and is kept only as historical record.

## Historical documents

`DEPLOYMENT_GUIDE.md`, `PRODUCTION_READINESS_AUDIT.md`, and
`SECURITY_HARDENING_REPORT.md` describe an earlier Docker Compose + Nginx
deployment that is **no longer used**. They are marked superseded by this
document and kept only as historical record.

`GIT_HISTORY_PURGE.md` describes the first (2026-08-01) attempt at the git
history purge covered above; its prepared mirror is stale and superseded.
[`SECRET_ROTATION_RUNBOOK.md`](SECRET_ROTATION_RUNBOOK.md) is the current,
canonical status for that incident.
