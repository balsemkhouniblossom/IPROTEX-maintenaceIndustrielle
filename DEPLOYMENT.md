# Deployment Environment

This is the canonical deployment document for the GMAO project. The project
runs entirely natively — there is no Docker, Docker Compose, container, or
self-hosted Nginx anywhere in local development or production.

- **Frontend**: Next.js, deployed on **Vercel**
- **Backend**: NestJS, deployed on **Render**
- **Database**: **MongoDB Atlas**, via a direct `mongodb+srv://` connection
- **File storage**: **Supabase Storage**
- **TLS and routing**: handled by Render and Vercel directly

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
```

Render terminates TLS and routes traffic to the backend directly — no
self-hosted Nginx or reverse proxy is used.

## Production Frontend: Vercel

Configure only public frontend variables in Vercel:

```env
NEXT_PUBLIC_API_BASE_URL=https://your-backend.onrender.com
```

Do not configure `SUPABASE_SECRET_KEY`, `SUPABASE_URL`,
`SUPABASE_STORAGE_BUCKET`, or `FILE_STORAGE_DRIVER` in Vercel. Supabase
Storage is accessed only by the NestJS backend. Vercel terminates TLS and
serves the frontend directly — no self-hosted Nginx is used.

## Historical documents

`DEPLOYMENT_GUIDE.md`, `PRODUCTION_READINESS_AUDIT.md`, and
`SECURITY_HARDENING_REPORT.md` describe an earlier Docker Compose + Nginx
deployment that is **no longer used**. They are marked superseded by this
document and kept only as historical record.
