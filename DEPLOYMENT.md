# Deployment Environment

This is the canonical deployment document for the GMAO project. The project
runs entirely natively — there is no Docker, Docker Compose, container, or
self-hosted Nginx anywhere in local development or production.

- **Frontend**: Next.js, deployed on **Vercel**
- **Backend**: NestJS, deployed on **Render**
- **Database**: **MongoDB Atlas**, via a direct `mongodb+srv://` connection
- **File storage**: **Supabase Storage**
- **TLS and routing**: handled by Render and Vercel directly

## Environment variable placement — quick reference

Every credential is a **Render (backend) environment variable, never a
Vercel one**. Vercel gets exactly one variable. If a variable name does not
start with `NEXT_PUBLIC_`, it must never be added to the Vercel project —
anything Next.js exposes to the client bundle has to be explicitly prefixed
`NEXT_PUBLIC_`, and no code in `frontend/src` reads any other `process.env`
key (verified by an automated test — see
[`frontend/tests/env-secret-exposure.test.ts`](frontend/tests/env-secret-exposure.test.ts)).

| Variable | Where it lives | Why |
|---|---|---|
| `JWT_SECRET`, `JWT_REFRESH_SECRET`, `EMAIL_VERIFICATION_SECRET`, `GOOGLE_LOGIN_EXCHANGE_ENCRYPTION_KEY` | Render only | Sign/verify tokens; a leak forges sessions |
| `MONGODB_URI` | Render only | Embeds database credentials |
| `SMTP_USER`, `SMTP_PASS`, `BREVO_API_KEY` | Render only | Mailbox/API credentials |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Render only | OAuth client secret |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET*` | Render only | Service-role storage access |
| `GEMINI_API_KEY` | Render only | Billable AI provider credential |
| `CORS_ORIGINS`, `FRONTEND_BASE_URL`, `BACKEND_URL`, `APP_URL`, `API_URL`, `GOOGLE_CALLBACK_URL` | Render only | Server-side config, not secret, but has no reason to exist client-side |
| `NEXT_PUBLIC_API_BASE_URL` | **Vercel** (and Render, for the backend's own CORS config) | The only variable the frontend build is allowed to read |

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
JWT_SECRET=<strong-secret>
JWT_REFRESH_SECRET=<strong-refresh-secret>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
EMAIL_VERIFICATION_SECRET=<strong-email-verification-secret>
GOOGLE_CLIENT_ID=<google-client-id>
GOOGLE_CLIENT_SECRET=<google-client-secret>
GOOGLE_CALLBACK_URL=https://your-backend.onrender.com/auth/google/callback
BACKEND_URL=https://your-backend.onrender.com
FRONTEND_BASE_URL=https://your-frontend.vercel.app
CORS_ORIGINS=https://your-frontend.vercel.app
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
SMTP_USER=<production-smtp-user>
SMTP_PASS=<production-smtp-password>
EMAIL_FROM=<from-address>
BREVO_API_KEY=<brevo-api-key>

# Optional backend-only AI assistant. Leave disabled unless Gemini is approved.
AI_ASSISTANT_ENABLED=true
AI_ASSISTANT_PROVIDER=gemini
GEMINI_API_KEY=<gemini-api-key>
GEMINI_MODEL=gemini-flash-lite-latest
AI_ASSISTANT_TIMEOUT_MS=12000
AI_ASSISTANT_RATE_LIMIT_PER_HOUR=20
```

Render terminates TLS and routes traffic to the backend directly — no
self-hosted Nginx or reverse proxy is used.

### Render AI Assistant

When `AI_ASSISTANT_ENABLED=true` in production, startup validation requires
`AI_ASSISTANT_PROVIDER=gemini`, `GEMINI_API_KEY`, and `GEMINI_MODEL`. The
Gemini key belongs only in Render backend secrets. Do not configure it in
Vercel or any `NEXT_PUBLIC_*` frontend variable.

Admins can check backend-only assistant diagnostics at
`GET /ai-assistant/health`; the response reports enabled/configured/provider
status and model, never the API key.

## Production Frontend: Vercel

Configure only public frontend variables in Vercel:

```env
NEXT_PUBLIC_API_BASE_URL=https://your-backend.onrender.com
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
anything other than `NEXT_PUBLIC_API_BASE_URL`/`NODE_ENV` is ever read —
run as part of `npm run test` in `frontend/`.

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
- This already happened once: `backups/mongodb/*/users.bson` was committed
  and reached `origin/main` before being purged from history on
  2026-08-01. See [`GIT_HISTORY_PURGE.md`](GIT_HISTORY_PURGE.md) for what
  was done, the re-clone steps every collaborator must follow, and the
  credentials that were rotated as a result.

## Historical documents

`DEPLOYMENT_GUIDE.md`, `PRODUCTION_READINESS_AUDIT.md`, and
`SECURITY_HARDENING_REPORT.md` describe an earlier Docker Compose + Nginx
deployment that is **no longer used**. They are marked superseded by this
document and kept only as historical record.
