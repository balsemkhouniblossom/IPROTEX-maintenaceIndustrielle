# GMAO DevSecOps Overview

This document describes the DevSecOps state of the GMAO/IPROTEX project as of
2026-09-17. It distinguishes controls that are implemented in the repository
from controls that are documented as requirements or remain recommended work.

## 1. System Context

The project is a three-application maintenance platform:

- **Frontend:** Next.js/TypeScript, deployed to Vercel.
- **Backend:** NestJS/TypeScript API, deployed to Render.
- **AI service:** FastAPI/Python IMS anomaly inference API, deployed to Render.
- **Data services:** MongoDB Atlas for application data, Supabase Storage for
  uploaded files, and optional Gemini services for RAG/assistant features.
- **Operations:** Prometheus scrapes protected backend metrics and Grafana
  provides dashboards and alerts.

The production path is natively hosted by Vercel and Render. Dockerfiles and
Docker Compose remain useful for packaging or local experiments, but the
canonical production deployment is the Render/Vercel configuration described in
`DEPLOYMENT.md` and `render.yaml`.

## 2. DevSecOps Flow

```text
Developer -> Pull request / push
          -> Repository hygiene
          -> Frontend quality + browser E2E
          -> Backend quality + backend E2E
          -> npm audit + Trivy filesystem scan
          -> Coverage artifacts + SonarCloud quality gate
          -> Production deployment triggers
          -> Backend/frontend health checks and smoke test
          -> Prometheus/Grafana/Sentry operational feedback
```

The primary workflow files are `.github/workflows/ci-pr.yml` and
`.github/workflows/cd-deploy.yml`.

## 3. Implemented Controls

### Source and repository hygiene

- GitHub Actions permissions are restricted to read-only contents by default.
- Concurrent CI runs for the same ref are cancelled to reduce stale feedback.
- `npm ci` and committed lockfiles provide repeatable JavaScript installs.
- Repository checks reject tracked runtime artifacts and invalid package locks.
- Real environment files and backups are ignored; example files contain
  placeholders rather than credentials.
- A previous backup exposure is documented in `DEPLOYMENT.md` and requires
  credential/session rotation and history remediation. This is an operational
  risk, not a closed control.

### Build, test, and quality gates

- Frontend: lint, TypeScript type-check, unit/logic tests with coverage,
  Playwright browser E2E, and production build.
- Backend: ESLint, Jest tests with coverage, MongoDB-backed checks, index
  creation verification, production build, and separate E2E tests.
- AI service: pytest coverage of request authentication, schema validation,
  deterministic inference, chronological ordering, persistence, concurrency,
  artifact loading, and non-finite input rejection.
- SonarCloud receives backend and frontend LCOV reports and waits for the
  quality gate before the CI workflow succeeds.
- Coverage files and source paths are verified before SonarCloud submission.

### Dependency and filesystem security

- `npm audit --omit=dev --audit-level=moderate` blocks vulnerable production
  dependencies in frontend and backend.
- Trivy scans the repository filesystem for HIGH and CRITICAL findings and
  fails CI on those findings; a SARIF result is also uploaded to GitHub
  Security for first-party reporting.
- CI uses local MongoDB test services rather than production credentials.
- GitHub actions are pinned to immutable commit SHAs for the security and
  SonarCloud actions used in the workflow.

### Identity, authorization, and application security

- Backend authentication uses JWT access/refresh flows, Google OAuth support,
  cookie-based authentication, CSRF bootstrap/token checks, and secure
  environment-backed secrets.
- Role and machine scope are enforced server-side for Admin, Technician, and
  Operator workflows, including operator-specific routes and WebSockets.
- Global validation uses whitelisting and rejects non-whitelisted request
  fields.
- Password reset tokens are hashed, refresh tokens are revoked after reset, and
  login throttling can use Redis-capable storage.
- Helmet, HPP, compression, request timeouts, rate limiting, upload size/type
  checks, filename/magic-byte validation, and sanitized upload handling are
  present in the backend security surface.
- Audit events include retention/redaction, severity/category classification,
  request correlation IDs, and administrative access paths.
- Prometheus metrics require a dedicated bearer token or an Admin JWT; the
  scraper does not reuse a user session.

### Secret and data protection

- Render holds server-only credentials such as MongoDB, JWT, OAuth, SMTP,
  Supabase service-role, Gemini, and AI-service tokens.
- Vercel receives only explicitly public `NEXT_PUBLIC_*` variables.
- A frontend test scans source files and Next configuration to prevent backend
  secret names or unsafe `process.env` references from entering the browser
  bundle.
- Supabase buckets are configured as private with signed URLs.
- AI-service calls use a shared service token, request-size and batch limits,
  and a readiness check that requires the model artifact to load.
- RAG retrieval applies role and authorized-machine filters, bounds extraction,
  chunking, top-K/context, and indexing rate; document text is treated as
  untrusted evidence for prompt-injection resistance.

### Deployment and runtime assurance

- Render Blueprint configuration declares backend, AI, Prometheus, and Grafana
  services with health endpoints and secret values marked `sync: false`.
- Production deployment is triggered only after a successful CI workflow on
  `main`, with a protected `production` environment.
- CD polls the backend and frontend after deployment; backend smoke tests cover
  `/health/api` and `/health` and validate response shape.
- Backend health combines API/database/email checks, with degraded status for
  unhealthy email transport.
- Structured JSON logs, Sentry hooks, Prometheus metrics, Grafana dashboards,
  and alert rules provide runtime feedback.
- Scheduler jobs use MongoDB leases, heartbeats, bounded batches, timeouts, and
  conditional release to avoid duplicate work across instances.
- Render and Vercel provide rollback points. Database/index rollback requires
  an explicit compatibility check before reverting code.

## 4. Security Boundaries

1. **Browser boundary:** the frontend may hold public configuration only and
   calls the backend over the configured API origin.
2. **API boundary:** NestJS authenticates users, applies roles and machine
   scope, validates input, logs security-relevant actions, and owns protected
   storage/document access.
3. **AI boundary:** NestJS calls FastAPI with a service token and timeout;
   FastAPI validates bounded, chronological feature input and loads a pinned
   artifact rather than retraining during requests.
4. **Data boundary:** MongoDB Atlas and Supabase service credentials never
   enter browser code. Prometheus receives only the dedicated metrics token.
5. **CI/CD boundary:** GitHub Actions uses repository secrets for deploy hooks,
   Render API access, SonarCloud, and health URLs; deployment waits for CI.

## 5. Current Gaps and Risks

These are the main items to close for a stronger DevSecOps posture:

| Priority | Gap or risk | Recommended action |
| --- | --- | --- |
| Critical | A historical MongoDB backup containing password and refresh-token hashes is documented as reachable from `origin/main`. | Rotate affected credentials and invalidate sessions; complete verified history purge and confirm the remote repository is clean. |
| High | There is no staging environment; main deploys directly to production. | Create isolated Render/Vercel/Atlas/Supabase staging resources and make promotion explicit. |
| High | CI does not show a dedicated secret scanner such as GitHub secret scanning or Gitleaks. | Enable secret scanning and push protection, then add a CI secret scan for non-GitHub mirrors. |
| High | Trivy scans the filesystem but no container image scan is wired into the production path. | Build the Docker images in CI and scan the exact image digests that could be deployed. |
| Medium | Dependency update automation is not visible in the repository inventory. | Add Dependabot or Renovate with grouped, reviewed update PRs. |
| Medium | Deploy hooks can be optional and CD may skip a target when secrets are absent. | Make production targets mandatory for protected production runs, or require an explicit approved skip with an audit trail. |
| Medium | CI runs frontend browser tests against a configured public API URL. | Use an isolated test backend or contract-test fixture to avoid coupling PR validation to production availability/data. |
| Medium | AI artifacts are provisioned externally and the deployment document requires manual placement. | Store artifacts in a versioned artifact registry/object store with checksum/signature verification during bootstrap. |
| Low | The repository contains both historical Docker/Nginx documentation and the native deployment model. | Keep the superseded label prominent and remove stale operational instructions when no longer needed. |

## 6. Practical Maturity Summary

- **Build and test automation:** strong and broad.
- **Application security:** strong baseline with meaningful defense in depth.
- **Supply-chain security:** good npm/Trivy/Sonar coverage, but secret scanning,
  image scanning, and automated dependency updates should be added.
- **Deployment safety:** functional post-deploy verification, weakened by the
  absence of staging and optional deployment target secrets.
- **Operations:** good health, metrics, alerting, audit, and rollback support.
- **Incident readiness:** documented but not complete because the historical
  backup exposure still requires verified remediation.

## 7. Recommended Next Sequence

1. Finish the historical secret exposure response and record evidence of
   rotation, revocation, and repository cleanup.
2. Add staging and require CI plus smoke checks before production promotion.
3. Add secret scanning, Dependabot/Renovate, and image scanning.
4. Make AI artifact integrity verifiable with immutable versions and checksums.
5. Exercise rollback, restore, alerting, and incident-response runbooks on a
   schedule and retain the evidence.

## Evidence Index

- `.github/workflows/ci-pr.yml`: CI quality, security, coverage, and E2E gates.
- `.github/workflows/cd-deploy.yml`: production trigger and post-deploy checks.
- `DEPLOYMENT.md`: environment ownership, security boundaries, rollback, and
  incident notes.
- `render.yaml`: Render service topology and secret declarations.
- `sonar-project.properties`: source, test, and coverage analysis settings.
- `backend/scripts/smoke-test.ts`: public post-deploy health validation.
- `frontend/tests/env-secret-exposure.test.ts`: frontend secret-exposure guard.
- `monitoring/`: Prometheus/Grafana deployment and alert configuration.
- `backend/docs/rag-phase-1.md`: RAG security and resource boundaries.
- `ai-service/app/tests/test_api_anomaly.py`: AI API security and validation
  tests.
