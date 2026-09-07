**GMAO project audit — 6 September 2026**

The project has a substantial CMMS implementation and meaningful backend safeguards, but the working tree is not ready to release. The immediate blockers are in the operator frontend; deployment and AI-service boundaries also need attention.

This audit covers the repository structure, backend bootstrap and access controls, maintenance scheduling and submission paths, inventory transactions, document access/upload handling, telemetry gateway, operator frontend changes, AI inference API, Docker/Render configuration, monitoring, and CI. It includes local automated checks and two local AI API probes. It is a repository-wide risk review with deeper inspection of sensitive workflows, not a claim that every line or deployed feature was exercised. Existing uncommitted changes were included and not edited. One frontend test changed during the audit; the frontend suite was rerun afterward.

**What is already strong**

- NestJS/Mongoose backend organized into domain modules; Next.js frontend with admin/operator/technician workflows and six message locales; separate FastAPI IMS inference service.
- Global authentication and role guards, current-user database lookup, account approval checks, session invalidation, request validation, throttling, CORS policy, and security headers.
- Machine-scoped authorization on inspected document and operator endpoints; avatar content validation and image normalization; authenticated document delivery.
- Transactions in stock changes and parts reservation; preventive occurrence keys and scheduler locking; dedicated business-time helpers.
- Significant backend test investment, CI coverage integration, repository hygiene checks, deployment runbooks, and monitoring configuration.
- AI metadata explicitly states that IMS validation does not establish generalization to IPROTEX factory machines. Keep that distinction visible.

**Prioritized findings**

1. **High — frontend type-checking fails; the corrective workflow references a missing import.** `frontend/src/app/[locale]/operator/corrective/page.tsx:187` and five other call sites use `apiService` without importing it. This prevents a normal checked production build and produces runtime failures when those paths execute. Three more errors concern nullable/optional values at `operator/preventive/hooks/usePreventiveInspection.ts:48`, `:147`, and `operator/preventive/page.tsx:182`. Restore the import and reconcile the actual API/component contracts. Evidence: nine errors in `audit-frontend-types.log`.

2. **High — preventive task list has a render/reset loop.** `frontend/src/app/[locale]/operator/preventive/page.tsx:61` runs an effect dependent on the entire `inspection` object and calls `inspection.reset()` while the list is displayed. The hook returns a fresh object each render; its reset function at `hooks/usePreventiveInspection.ts:181` creates fresh arrays/objects in state. Each reset therefore triggers another render and another effect. This can make the list unusable. Depend on the stable reset callback and the intended step transition. This is a source-level finding; the operator page was not opened in a browser during this audit.

3. **High — submitting an existing preventive job schedules another occurrence.** The page stores the selected `workOrderId` at `operator/preventive/page.tsx:33`, but calls the inspection hook with only plan and machine at line 39. The hook starts with no work-order ID and calls `scheduleOperatorPreventive` at `hooks/usePreventiveInspection.ts:142`. The backend scheduling method creates an occurrence rather than looking up the selected job (`backend/src/work-orders/services/work-order-preventive-scheduling.service.ts:156`). An active occurrence on the same date produces a duplicate conflict; an overdue occurrence can instead result in a new occurrence for today while the old one remains open. Pass and submit the selected occurrence ID. Keep first scheduling separate from execution.

4. **High — completed history hides recurring work that is still due.** `frontend/src/app/[locale]/operator/preventive/hooks/useOperatorPreventiveTasks.ts:112` groups all work orders by plan plus machine. At lines 114–119, a completed occurrence changes the group's tab to completed; active occurrences do not restore it. With one completed occurrence and one new scheduled occurrence for the same plan/machine, the active task disappears from Today/Upcoming regardless of input order. Group by occurrence, or explicitly select the active occurrence and keep history separate. The related date comparison at line 131 compares the due timestamp against today's midnight, so a job due later today is classified as upcoming.

5. **High — the standalone AI API accepts unauthenticated state-changing inference.** `ai-service/app/api/routes/anomaly.py` defines inference routes without authentication dependencies, and `app/main.py:126` installs the routers without a service-authentication gate. `render.yaml:206` configures the service as a web service. A local valid POST to `/v1/anomaly/analyze` without credentials returned 200. Direct access bypasses the NestJS role checks and rate limiting, consumes inference resources, and can advance streaming state. Require service authentication and restrict network access. Public deployment reachability was not tested.

6. **High — AI streaming state is shared across independent machine mappings.** `ai-service/app/services/inference_service.py:122` keys streaming timestamps by experiment and sensor channel, with one shared pipeline. `backend/src/ai-anomaly/ai-anomaly.service.ts:200` forwards only feature rows, omitting the platform machine/capteur identity. Two independent machine mappings using the same dataset/channel therefore share chronological state. A local first request returned 200 and the same timestamp on the next request returned 400. Chronological enforcement is correct within one stream, but the platform does not distinguish independent streams. Add a stream identity throughout the contract/state, or use stateless batch replay for independent analyses. This also makes restart/multiple-worker behavior operationally significant.

7. **High, deployment-dependent — Prometheus is configured without inbound authentication and with remote lifecycle controls.** `render.yaml:233` defines a web service. `monitoring/prometheus/render-entrypoint.sh:49` listens on all interfaces and line 50 enables lifecycle endpoints; no inbound auth configuration or proxy is supplied. The metrics bearer token protects scraping the backend, not access to Prometheus itself. If deployed as written without an external access restriction, metrics are readable and lifecycle endpoints can reload or shut down the process. Use private access or authenticated ingress and disable unnecessary lifecycle controls. The endpoint behavior is documented in the [Prometheus security model](https://prometheus.io/docs/operating/security/) and [management API](https://prometheus.io/docs/prometheus/latest/management_api/). No remote shutdown/reload requests were made.

8. **Medium — the AI request-size limit is bypassable.** `ai-service/app/main.py:77` checks only the declared Content-Length. A local chunked request with 1,048,592 bytes reached schema validation and returned 422 instead of the configured 413 size rejection. Requests without Content-Length bypass this middleware's limit. Row-count limits run after parsing as well. Enforce a bound on received bytes before full body/schema processing, with a corresponding ingress limit.

9. **High for Docker users — the committed Compose path is internally inconsistent.** `docker-compose.yml` injects only NODE_ENV; required backend credentials/configuration are neither forwarded nor mounted. The backend defaults to port 3001 (`backend/src/config/env.validation.ts:60`) while Compose publishes container port 3000. The backend Docker health check targets `/api/health` (`backend/Dockerfile:43`), while the implemented route is `/health`. The frontend has no explicit build-time API URL input in Compose/Dockerfile, and its production URL validator permits only one fixed Render origin (`frontend/src/config/api-base-url.ts:39`), so it cannot target the Compose backend as written. Fix env wiring, ports, health routes, and frontend build configuration together. Docker images were not built during this audit; these are configuration findings.

10. **Medium — checklist saves can fail silently, and submission errors are hidden on the review step.** `frontend/src/app/[locale]/operator/preventive/hooks/usePreventiveInspection.ts:107` marks answers locally before persistence. Its catch at line 119 only logs; it neither rolls back nor reports failure. `allAnswered` can become true while requests are still pending or have failed. Separately, submission stores an error at line 172, but the page renders `inspection.error` only under the checklist branch (`operator/preventive/page.tsx:171`), not the review branch where submission occurs. Track pending saves, surface failures, and render submission errors beside the submit action.

11. **Medium — completed inspection cards reopen the editable inspection flow.** `frontend/src/app/[locale]/operator/preventive/components/TaskCard.tsx:31` always invokes `onOpen`, including the completed card labeled View Results. The page's `handleOpenTask` always enters the checklist step; it has no read-only historical-report mode. Combined with the discarded occurrence ID, viewing history can lead to editing shared checklist state or attempting another submission. Open the saved report for the selected occurrence and reserve editing for executable jobs.

12. **Medium — test coverage does not currently protect the highest-risk frontend workflows or the Python service in CI.** `frontend/e2e/login.spec.ts` is the only browser test; it checks unauthenticated login controls. Many frontend tests inspect source text using regular expressions rather than executing React state transitions. The first run's KnowledgeSuggestions failure was a stale variable-name assertion; after that test changed, it passed. The remaining failure expects a contextual AiAssistantPanel on the corrective page. `.github/workflows/ci-pr.yml` runs no Python test job, despite deploying the AI service. Add browser coverage for recurring preventive work, existing-occurrence submission, failed saves, completed-result viewing, and corrective submission; run the Python API/inference suite in CI. Trivy currently reports findings with exit-code 0, so its HIGH/CRITICAL scan is informational rather than a release gate.

**Maintainability and product observations**

The backend's dedicated scheduling, command, query, response-mapping, and transaction services are a good direction. Large frontend components remain difficult to review: TechnicianWorkspace has roughly 2,000 nonempty lines and TechnicianWorkOrderDetail roughly 1,350. Several other pages and services exceed 1,000 nonempty lines. Smaller workflow components with executable behavioral tests would make refactors safer.

The new preventive task model sets both checklist counts to zero rather than loading them (`useOperatorPreventiveTasks.ts:144`), so cards display misleading counts. Several unconsumed UI values and legacy helpers remain; frontend lint reports 36 warnings. Some React safety rules are disabled globally in `frontend/eslint.config.mjs`, including set-state-in-effect and immutability.

There is also configuration drift: the production frontend URL validator is tied to one Render deployment, while other deployment files describe a differently named service. An explicit environment-specific backend origin would make staging, migrations, and Docker use possible. Consolidate the deployment instructions against a verified deployment path.

**Checks performed**

| Check | Result |
|---|---|
| Backend TypeScript build | Passed |
| Backend lint | Passed, no reported diagnostics |
| Backend Jest | 168 suites passed, 1 failed; 1,530 tests passed, 2 failed |
| Backend failure explanation | Both failing tests in mongodb-indexes.spec.ts hit MongoMemoryServer startup timeout; infrastructure failure observed, not proof of incorrect index definitions |
| Frontend TypeScript | Failed with 9 errors |
| Frontend lint | 0 errors, 36 warnings |
| Frontend tests, final run | 364 passed, 1 failed out of 365 |
| Python pytest | 42 passed; 44,549 warnings, primarily NumPy/joblib artifact-loading deprecations |
| Tracked runtime-artifact check | Passed |
| npm lockfile verification | Passed for 3 Node projects |
| Local AI authentication/state probe | Unauthenticated inference returned 200; same stream/timestamp replay returned 400 |
| Local AI size-limit probe | Oversized chunked body reached validation: 422 instead of 413 |

Raw check output is saved alongside this report in `audit-backend-build.log`, `audit-backend-lint.log`, `audit-backend-tests.log`, `audit-frontend-types.log`, `audit-frontend-lint.log`, `audit-frontend-tests-final.log`, and `audit-ai-tests.log`. The earlier frontend test log records the initial two failures before a concurrent test update.

Not exercised: authenticated browser journeys, separate backend E2E suite, Docker builds, deployed infrastructure/network restrictions, backup restore, production load, dependency advisory scans, or historical secret rotation. The frontend production build was not run after the prerequisite type-check failed. Passing the checks above is not evidence that these untested areas are correct.

Recommended order: resolve the frontend build and preventive lifecycle blockers; secure and isolate AI/monitoring access; repair the supported deployment configuration; then add workflow browser tests and Python CI coverage before release. Application source files were not changed by this audit.
