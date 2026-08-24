# Deployment Audit Report

## Scope

Audit of frontend API configuration and deployment/runtime settings for the
current native production target:

- Frontend: <https://pfe-maintenace-industrielle.vercel.app>
- Backend: <https://pfe-maintenaceindustrielle.onrender.com>

Canonical deployment reference:

- [`DEPLOYMENT.md`](./DEPLOYMENT.md)

Historical Docker/Nginx deployment notes remain superseded:

- [`DEPLOYMENT_GUIDE.md`](./DEPLOYMENT_GUIDE.md)

## 1. API Base URL Resolution

Frontend API base URL resolution is centralized in:

- `frontend/src/config/api-base-url.ts`
- consumed by `frontend/src/services/api.ts`
- consumed by `frontend/src/services/authRefreshCoordinator.ts`
- consumed by file URL helpers in `frontend/src/services/managedFileUrls.ts`

Effective behavior:

- Production requires `NEXT_PUBLIC_API_BASE_URL`.
- Production rejects non-HTTPS, localhost, and non-Render API origins.
- Production currently pins the API origin to
  `https://pfe-maintenaceindustrielle.onrender.com`.
- Development falls back to `http://localhost:3001` only when
  `NEXT_PUBLIC_API_BASE_URL` is not set.

Important correction from the older audit: production no longer silently falls
back to the Render URL when `NEXT_PUBLIC_API_BASE_URL` is missing. It fails
fast so a bad Vercel environment cannot ship with ambiguous routing.

## 2. Frontend Environment Variables

Set in Vercel Production and Preview as needed:

- `NEXT_PUBLIC_API_BASE_URL=https://pfe-maintenaceindustrielle.onrender.com`
- `NEXT_PUBLIC_SUPABASE_URL=https://<supabase-project-ref>.supabase.co` only if
  frontend-resolved Supabase asset URLs are used
- `NEXT_PUBLIC_SENTRY_DSN=` optional
- `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0.1` optional

Template:

- `frontend/.env.example`

Frontend secret exposure guard:

- `frontend/tests/env-secret-exposure.test.ts`

The test enforces that frontend source reads only `NODE_ENV`, Next.js runtime
variables, or explicitly public `NEXT_PUBLIC_*` variables. Backend secrets
must not appear in Vercel.

## 3. Backend Environment Variables

Minimum production runtime validation requires:

- `NODE_ENV=production`
- `PORT`
- `MONGODB_URI`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `JWT_EXPIRES_IN` or `JWT_ACCESS_EXPIRES_IN`
- `JWT_REFRESH_EXPIRES_IN`
- `EMAIL_VERIFICATION_SECRET` or `JWT_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CALLBACK_URL` or `BACKEND_URL`
- `GOOGLE_LOGIN_EXCHANGE_ENCRYPTION_KEY`
- `BACKEND_URL`
- `FRONTEND_BASE_URL` or `FRONTEND_URL` or `APP_URL`
- `CORS_ORIGINS`
- `FILE_STORAGE_DRIVER=supabase`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_STORAGE_BUCKET`

Deployment-critical production values:

- `MONGODB_REQUIRE_ATLAS=true`
- `BACKEND_URL=https://pfe-maintenaceindustrielle.onrender.com`
- `API_URL=https://pfe-maintenaceindustrielle.onrender.com`
- `FRONTEND_BASE_URL=https://pfe-maintenace-industrielle.vercel.app`
- `APP_URL=https://pfe-maintenace-industrielle.vercel.app`
- `CORS_ORIGINS=https://pfe-maintenace-industrielle.vercel.app`
- `TRUST_PROXY=true` on Render

Templates/config:

- `backend/.env.example`
- `render.yaml`
- `backend/src/config/env.validation.ts`

## 4. CORS and WebSocket Origins

Backend CORS is configured from `CORS_ORIGINS` and enables credentials.

Production behavior:

- `CORS_ORIGINS` is required.
- `CORS_ORIGINS=*` is rejected.
- localhost origins are rejected.
- exactly one production frontend origin is required.
- the origin must match `FRONTEND_BASE_URL`.
- frontend and backend origins must not be the same.

The same validated origin list is also passed to the secure Socket.IO adapter
for live monitoring.

Files:

- `backend/src/config/env.validation.ts`
- `backend/src/config/cors-origin-policy.ts`
- `backend/src/main.ts`
- `backend/src/config/secure-socket-io.adapter.ts`

## 5. Frontend Requests and Endpoint Coverage

All frontend API calls go through the shared Axios instance in:

- `frontend/src/services/api.ts`

The Axios instance uses:

- `baseURL: getApiBaseUrl()`
- `withCredentials: true`
- default timeout of `15000ms`
- longer timeout for upload/download requests
- CSRF headers for `/auth/refresh` and `/auth/logout`
- bounded retries for idempotent `GET` requests only

Main endpoint groups currently used by the frontend include:

- `/auth`
- `/users`
- `/machines`
- `/machine-types`
- `/modules`
- `/module-types`
- `/devices`
- `/live-monitoring`
- `/maintenance-plans`
- `/preventive-tasks`
- `/work-orders`
- `/technician`
- `/operator`
- `/catalogues`
- `/stocks`
- `/ot-pieces`
- `/lubrifiants`
- `/lubrification-logs`
- `/kpis`
- `/capteurs`
- `/mesures`
- `/intervention-reports`
- `/pannes`
- `/panne-solutions`
- `/documents`
- `/knowledge-base`
- `/ai-assistant`
- `/predictive-maintenance`
- `/notifications`
- `/reports`
- `/saved-views`
- `/dashboard`

## 6. File and Asset URL Handling

Production-safe URL construction is centralized rather than repeated in pages:

- `frontend/src/services/managedFileUrls.ts`
- `frontend/src/services/userMedia.ts`
- `frontend/src/components/DocumentAttachmentViewer.tsx`

Behavior:

- absolute URLs are preserved.
- relative managed upload paths are normalized.
- relative managed upload paths are resolved against `getApiBaseUrl()`.
- protected documents are served through authenticated backend document
  endpoints.
- approved active user avatars may be exposed through the managed avatar route.

Backend avatar/file helpers:

- `backend/src/common/managed-file-url.ts`
- `backend/src/users/user-photo-url.ts`

## 7. Password Reset and Frontend Links

Backend-generated frontend links resolve through `AppConfigService`.

Resolution order:

- `FRONTEND_BASE_URL`
- `FRONTEND_URL`
- `APP_URL`
- `RENDER_EXTERNAL_URL`
- local fallback `http://localhost:3000`

Production validation prevents the dangerous case where frontend and backend
origins collapse to the same Render URL.

Files:

- `backend/src/config/app.config.ts`
- `backend/src/auth/auth.service.ts`
- `backend/src/notifications/url-builder.service.ts`

## 8. Startup Observability and Runtime Protection

Backend startup/configuration currently covers:

- runtime mode and port logging
- sanitized MongoDB URI logging
- Atlas detection warning
- Mongoose debug toggle
- validated CORS origins logging
- health endpoint logging
- Helmet security headers
- HPP protection
- compression
- global validation pipe
- global exception filter
- global request timeout interceptor
- trusted proxy configuration

Files:

- `backend/src/main.ts`
- `backend/src/config/env.validation.ts`
- `backend/src/config/security-headers.config.ts`
- `backend/src/common/interceptors/timeout.interceptor.ts`
- `backend/src/common/filters/all-exceptions.filter.ts`

## 9. Health and Diagnostics Endpoints

Public health endpoints:

- `GET /health`
- `GET /health/live`
- `GET /health/api`

Admin-only diagnostics:

- `GET /health/db`
- `GET /health/email`
- `GET /health/metrics`
- `GET /ai-assistant/health`

Files:

- `backend/src/health/health.controller.ts`
- `backend/src/health/health.service.ts`
- `backend/src/common/metrics/metrics-registry.ts`
- `backend/src/ai-assistant/ai-assistant.controller.ts`

## 10. Storage, AI, Telemetry, and Schedulers

Production file storage:

- `FILE_STORAGE_DRIVER=supabase`
- `SUPABASE_SECRET_KEY` stays Render-only.
- missing Supabase production settings fail startup validation.

Optional AI assistant:

- disabled by default in `render.yaml`.
- when enabled in production, requires `AI_ASSISTANT_PROVIDER=gemini`,
  `GEMINI_API_KEY`, and `GEMINI_MODEL`.
- advisory-only interaction history is stored in backend data models.

Optional device/telemetry settings:

- `MQTT_BROKER_URL` is optional.
- telemetry and resolved fault retention are controlled by TTL env vars.
- live monitoring uses REST plus WebSocket origins validated from CORS config.

Predictive maintenance:

- local computation, enabled by `PREDICTIVE_MAINTENANCE_ENABLED=true` by
  default.
- prediction history retention is controlled by
  `PREDICTION_HISTORY_RETENTION_SECONDS`.

Automation:

- scheduler settings are documented in `DEPLOYMENT.md`.
- Render blueprint now includes the scheduler env names and safe defaults.

## 11. Remaining Localhost References

Remaining `localhost` references are expected in non-production contexts:

- local development defaults
- test configuration
- test database fallback
- generated build artifacts
- local smoke-test examples

They do not affect production routing because production validation rejects
localhost frontend/backend/CORS origins and production frontend API config
requires the pinned Render backend URL.

## 12. Verification

Relevant verification already present in the repo:

- `frontend/tests/env-secret-exposure.test.ts`
- `frontend/tests/refresh-logic.test.ts`
- `backend/src/config/env.validation.spec.ts`
- `backend/src/config/cors-origin-policy.spec.ts`
- `backend/scripts/smoke-test.ts`

Manual smoke test:

```bash
cd backend
npm run smoke-test -- --url=https://pfe-maintenaceindustrielle.onrender.com
```
