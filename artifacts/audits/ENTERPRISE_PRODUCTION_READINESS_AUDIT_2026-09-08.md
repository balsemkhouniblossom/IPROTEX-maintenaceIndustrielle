# Enterprise production-readiness audit — 8 September 2026

## 1. Executive summary and release decision

**Final decision: NOT READY.** The repository contains a substantial, credible CMMS implementation, not a prototype: role-specific workspaces, authenticated API boundaries, maintenance occurrence controls, transactional stock paths, document lifecycle controls, notifications, telemetry, reporting, monitoring, and two distinct AI capabilities are present. The current frontend type-check, frontend logic suite, production compilation, and Python suite succeed. These are meaningful improvements over the 6 September audits.

The product nevertheless lacks the evidence and controls required for an enterprise production handover. Four release-blocking conditions remain:

1. The separately deployed FastAPI inference service exposes state-changing inference without service authentication, while `render.yaml` declares it as an Internet-facing web service.
2. Current production dependency scans find one high frontend advisory and three moderate backend advisories; the repository scan is explicitly non-blocking (`exit-code: "0"`).
3. No authenticated, role-by-role browser journey, production-like backend E2E run, backup restoration, rollback, load, or deployed network-control test was completed. Passing source-oriented logic tests is not production verification.
4. The committed Docker Compose path is internally inconsistent (ports, health route, required environment, and browser API origin). It cannot serve as a reproducible recovery/deployment path as written.

The earlier operator compilation and occurrence-identity defects are not repeated as current findings: the present checkout type-checks, builds, and contains occurrence-preserving frontend tests and backend submission/scheduling protections. That distinction is important—the decision is based on current evidence, not stale audit findings.

## 2. Scope, evidence levels, and limitations

Audit target: commit `322bffae1bd0d71ebf8ba560f2dcf343666cdffa` (`refactor: extract WorkOrderTabs component for improved readability and maintainability`). The worktree was clean at the start. No source, configuration, database, or production data was modified. This report is the only intentional artifact.

Evidence labels used below:

- **LIVE-LOCAL:** command or HTTP behavior observed locally.
- **TEST:** behavior covered by an automated test that ran in this audit.
- **SOURCE:** confirmed by inspecting the current source/configuration.
- **BLOCKED:** production or authenticated behavior not safely available to this audit.

Checks executed:

| Check | Result | Evidence level |
|---|---|---|
| Frontend `tsc --noEmit` | Pass | LIVE-LOCAL |
| Frontend logic tests | **378/378 pass** | LIVE-LOCAL / TEST |
| Frontend `next build` | Compiled, type-checked, and generated all 299 static page instances successfully | LIVE-LOCAL |
| AI `pytest -q` | **42/42 pass**; 44,549 deprecation warnings | LIVE-LOCAL / TEST |
| Backend Jest | Broad suite ran; one confirmed infrastructure failure in `preventive-scheduler-generation.spec.ts` because MongoMemoryServer failed its 10-second startup, while many subsequent suites passed. Final all-suite success was not established at report cutoff. | LIVE-LOCAL / BLOCKED |
| Backend build | TypeScript compilation completed and lint started; final lint completion was not established at report cutoff | LIVE-LOCAL / BLOCKED |
| Backend production dependency audit | 0 critical, 0 high, **3 moderate** | LIVE-LOCAL |
| Frontend production dependency audit | 0 critical, **1 high**, 0 moderate | LIVE-LOCAL |
| Authenticated browser/E2E journeys | Not run; credentials and an explicitly isolated integrated environment were not supplied | BLOCKED |
| Live production APIs/database | Not probed to avoid writes and unauthorized production access | BLOCKED |
| Restore, failover, rollback, load and mobile-device exercises | Not run | BLOCKED |

## 3. Actual architecture and implemented feature inventory

The platform consists of:

- **Next.js 16 / React 18 frontend** with locale-prefixed App Router routes, six message locales, in-memory access-token handling, refresh-cookie recovery, role shells, error/loading/empty states, and responsive navigation. Evidence: `frontend/package.json`, `frontend/middleware.ts`, `frontend/src/contexts/AuthContext.tsx`, `frontend/src/components/DashboardLayout.tsx`.
- **NestJS 11 / MongoDB backend** with global JWT and role guards, DTO validation (`whitelist`, transformation, and rejection of unknown fields), Helmet/HPP/compression, CORS policy, throttling, request timeouts, Sentry instrumentation, metrics, schedulers, and graceful shutdown hooks. Evidence: `backend/src/main.ts`, `backend/src/app.module.ts`, `backend/src/auth/jwt-auth.guard.ts`, `backend/src/auth/roles.guard.ts`.
- **FastAPI IMS anomaly service** using a saved scikit-learn/joblib artifact and both stateful streaming and stateless batch endpoints. Evidence: `ai-service/app/main.py`, `ai-service/app/api/routes/anomaly.py`, `ai-service/app/services/inference_service.py`.
- **Deployment/operations** through Render blueprints for API, AI, Prometheus and Grafana; Vercel frontend configuration; Dockerfiles; GitHub Actions; SonarCloud; Sentry; Prometheus/Grafana. Evidence: `render.yaml`, `frontend/vercel.json`, `.github/workflows/*.yml`, `monitoring/`.

Implemented domain relationships (SOURCE):

`MachineType -> Machine -> Module -> MaintenancePlan -> PreventiveTask`; an active plan produces uniquely keyed `WorkOrder` occurrences. A work order relates to its machine, plan, assignee, part requests/OT pieces, intervention report, documents, lubrication logs, notifications and timeline events. Operator corrective reporting creates/follows a work order. Technician execution changes ownership/lifecycle and records parts/report evidence. Admin validation is the authoritative closure step; preventive validation schedules the next occurrence. Telemetry belongs to device/machine/sensor records and feeds predictive health; AI anomaly analyses persist separately and require human confirmation/rejection. Relevant schemas are under `backend/src/schemas/`; orchestration is under `backend/src/work-orders/services/`, `operator/`, `technician/`, `notification-center/`, `predictive-maintenance/`, and `ai-anomaly/`.

Implemented but conditional/limited:

- Gemini assistance is feature-flagged, advisory-only, rate-limited, and may use a null provider. It is not an authoritative maintenance decision engine.
- IMS analysis is explicitly a NASA IMS bearing dataset replay, not validation on IPROTEX machines.
- Predictive maintenance includes z-score, DBSCAN, isolation forest and autoencoder implementations, but production usefulness depends on actual telemetry volume/quality and per-machine validation.
- Digital twin assets and scene exist, but repository evidence does not establish a live bidirectional operational twin or authoritative control path.
- Local file storage remains available; durable production storage requires correctly provisioned Supabase and access policies.

## 4. Role navigation and UX audit

### Admin

The sidebar exposes dashboard, digital twin, machines/devices, work orders/plans/checklists/intervention/lubrication, failures, catalogue/stock/parts/lubricants, sensors/measurements, AI analysis, reports, documents/knowledge, and users/types. This is comprehensive but configuration-heavy. Labels such as “Machine Health” leading to sensor management and “Alerts & Failures” leading to the failure library can still misdirect operational triage. Admin pages are predominantly generic CRUD/table surfaces; the user must understand entity dependencies. Evidence: `frontend/src/components/DashboardLayout.tsx`, admin pages under `frontend/src/app/[locale]/`.

### Technician

The technician receives a compact dashboard, assigned work orders, machine history/context, machine health, parts, manuals, knowledge base and completed history. Work-order detail now provides state-aware intervention/report/parts structure. Remaining production uncertainty is behavioral: draft survival through refresh/back/parts actions and the complete return/review loop were not exercised in a browser. Evidence: `frontend/src/components/technician/TechnicianWorkspace.tsx`, `TechnicianWorkOrderDetail.tsx`, `frontend/src/app/[locale]/technician/**`.

### Operator

The operator sidebar is appropriately small: dashboard, machines, report problem, preventive tasks, reports and notifications. Additional manuals, knowledge and calendar routes exist but are contextual rather than primary. Current tests assert preservation of occurrence/report IDs, read-only completed results, canonical operator routes, and access denial to generic management routes. These are TEST-level claims only; device navigation, draft retention, attachment retry, notification deep-linking and refresh behavior remain BLOCKED pending browser execution. Evidence: `DashboardLayout.tsx`, `frontend/src/app/[locale]/operator/**`, `frontend/tests/operator-*.test.ts`.

Cross-role UX risks:

- Route authorization in the UI is client-side and improves usability, but only backend guards are a security boundary. Direct-route behavior must be included in E2E acceptance.
- Several legacy/alternate routes remain (`panne-solutions`, operator calendar/manual/knowledge routes). Their redirects/context are tested at source level, not interactively.
- The UI has strong shared modal, pagination, status, offline and error components, but most frontend tests inspect logic/source structure rather than render complete user interactions.
- Mobile responsiveness is implemented through responsive layouts, but touch targets, focus order, contrast, RTL, low-connectivity and real tablet use were not measured.

## 5. End-to-end scenario matrix

“Pass (TEST)” means the relevant contracts/state rules passed automated tests; it does not mean a human completed the workflow against production.

| Role / scenario stage | Status | Evidence and gap |
|---|---|---|
| Operator login, approved-account routing | Pass (TEST) | Auth/session/approval frontend and backend unit tests; no deployed login |
| Assigned machines and machine detail | Pass (SOURCE/TEST) | Scoped operator controllers and canonical route tests; no real assignment dataset |
| Report problem with evidence and confirmation | Partial | Corrective DTO/workflow/partial photo retry tested; no actual upload/storage/SMTP flow |
| Follow exact report status and notification | Partial | ID-preserving routes and notification APIs tested; no browser click-through or delivery proof |
| View due preventive occurrence | Pass (TEST) | Role-scoped task/calendar queries and grouping tests |
| Complete checklist and submit existing occurrence | Pass (TEST) | Backend assignment/state guards and frontend occurrence payload tests |
| Show next date and prevent duplicate scheduling | Partial | Unique occurrence key, idempotent scheduling and source logic exist; the race test could not start MongoMemoryServer in this run |
| Technician login and assigned queue | Pass (SOURCE/TEST) | Role/controller/query tests; no deployed dataset |
| Diagnose, add parts, report, submit | Partial | Service/unit coverage is extensive; unsaved draft and multi-tab browser continuity not executed |
| Admin users/permissions/machines/plans | Pass (SOURCE/TEST) | Role guards, approval and plan lifecycle tests; no authenticated browser execution |
| Admin corrective/preventive review and validation | Partial | Lifecycle services/tests exist; evidence review UX not executed end-to-end |
| Admin inventory/report/AI/twin/configuration | Partial | Routes and services exist; external storage, report scheduling, AI availability and twin fidelity not production-verified |

### Recurrence conclusion

The intended authoritative chain is now coherent by source: a plan is activated, one first occurrence is created, the assigned operator submits that exact occurrence to `waiting_validation`, and approval creates the next occurrence from the plan’s recurrence rules. `preventive_occurrence_key` has a partial unique index (`backend/src/schemas/work-order.schema.ts`), scheduling is centralized (`work-order-preventive-scheduling.service.ts`), and multi-instance jobs use scheduler locks. Plan edits with validated history require optimistic versioning, and plans with occurrences cannot be deleted (`maintenance-plans.service.ts`). Acceptance is still conditional on a production-like race test, timezone-boundary cases, migration/index verification on Atlas, and visible next-date browser assertions.

## 6. AI/ML and industrial intelligence audit

### Validated facts

- The IMS artifact loading, API models, health/readiness, streaming chronology, batch behavior and inference tests pass (42 tests).
- The pipeline records features, thresholds, model metadata and scientific limitations; the UI labels dataset replay and separates facts, model output and uncertainty.
- Backend anomaly routes are JWT/role controlled, persist analyses, support human validation, and do not automatically create work orders.
- Gemini output is filtered, prompt-injection guarded, rate-limited, feature-flagged and presented as advisory.

### Limitations and unsafe boundary

- **Confirmed high risk:** `ai-service/app/api/routes/anomaly.py` has no authentication dependency. `render.yaml` deploys `gmao-ai-service` as `type: web`. Anyone reaching it can consume stateful/batch inference and bypass NestJS RBAC/audit controls. Add a service credential or private network identity at both backend client and FastAPI middleware; deny public ingress. Acceptance: anonymous inference returns 401/403, only the backend identity succeeds, key rotation is documented, and an external reachability test passes.
- Streaming state is keyed only by `(experiment, sensor_channel)` in `inference_service.py`; backend requests do not transmit a platform stream/machine identity. Multiple machines replaying the same IMS channel can interfere, and in-memory state differs across workers/restarts. Either make replay stateless or add an explicit tenant/machine/stream identity with durable/partitioned ordering semantics.
- 44,549 NumPy/joblib deprecation warnings indicate artifact/runtime compatibility debt. Pin a validated runtime matrix and rebuild/revalidate artifacts before these warnings become failures.
- No evidence establishes RUL accuracy on this plant. Do not display a remaining-life value as an operational commitment unless target-machine labels, time-split validation, calibration, drift thresholds and acceptance owners are documented.
- Model drift, champion/challenger promotion, rollback, signed artifact provenance and incident runbooks are incomplete as an enterprise operating system.

## 7. Security findings

### SEC-01 — High — public unauthenticated AI inference (confirmed)

Problem/impact: bypass of platform RBAC, audit and throttling; resource exhaustion and cross-stream state manipulation. Evidence: `ai-service/app/api/routes/anomaly.py`, `ai-service/app/main.py`, `render.yaml`. Fix/acceptance: private ingress plus authenticated service-to-service requests; anonymous tests fail closed and rate/body limits run before parsing.

### SEC-02 — High — vulnerable production dependency and ineffective release gate (confirmed)

Problem/impact: frontend `npm audit --omit=dev` reports high-severity `nanoid` advisory GHSA-2v37-7h3g-55p8. Backend reports moderate `qs`, `uuid`, and `exceljs` dependency paths. CI Trivy uses `exit-code: "0"` for both scans (`.github/workflows/ci-pr.yml:277-296`). Vulnerable releases are therefore not blocked. Fix/acceptance: upgrade/override after compatibility tests, add lockfile auditing/SBOM, fail on agreed severity and exploitability, and record exceptions with owner/expiry.

### SEC-03 — High — historical credential/data exposure remains an explicit unresolved incident (confirmed documentation risk)

`DEPLOYMENT.md:479-488` states that backup archives may contain MongoDB users including password and refresh-token hashes and records unresolved GitHub history exposure. No secret is reproduced here. Complete repository-history purge verification, rotate every affected credential/session, document incident closure, and scan all refs/releases/forks. Acceptance: independent secret scan clean, rotations evidenced, all sessions invalidated, incident owner signs off.

### SEC-04 — Medium — production controls are configuration-dependent (risk)

The backend has good defaults: global JWT/RBAC, active/approved-account checks, validation, CORS allow-list, Helmet/CSP, throttling, refresh-cookie/CSRF handling, upload type/size/quarantine logic, log sanitization and protected document delivery. Their effective production values were not observable. Acceptance requires deployed tests for cookie flags/domain/SameSite, CORS, CSP, refresh replay/revocation, rate limiting behind the actual proxy, Supabase bucket policies, upload malware scanning, and object-level access across roles.

### SEC-05 — Medium — monitoring ingress requires external assurance (risk)

Prometheus/Grafana are Render web services. Grafana disables anonymous signup, but Prometheus ingress authentication/private reachability is not demonstrated by the repository; the bearer token protects scraping the backend, not necessarily reading Prometheus. Acceptance: private/authenticated ingress and external 401/403 tests for dashboards, query and lifecycle endpoints.

Positive controls: `.env.production` is not tracked; tracked environment files are examples only. Frontend tests confirm server-only secret names are absent from `frontend/src` and access tokens are memory-only. No secrets were printed during this audit.

## 8. DevSecOps and infrastructure findings

- CI has build/test/coverage, lockfile/runtime-artifact checks, Playwright, Sonar quality-gate wait and Trivy SARIF. Actions are partly pinned by commit.
- Python tests are not visibly enforced in the inspected CI route, despite deployment of the AI service. Add artifact-bootstrap, API and inference jobs with the production Python/runtime lock.
- Trivy is informational rather than a gate. Add dependency review, CodeQL/SAST, container-image scanning of built images, SBOM and signed provenance.
- `docker-compose.yml` forwards only `NODE_ENV`; the backend requires Mongo/JWT/CORS/storage settings. It publishes host 3000 to container 3000 although the documented backend default is 3001; the backend Docker health check targets `/api/health` while the controller is `/health`; frontend production origin validation is deployment-specific. Treat Compose as unsupported until one clean-room deployment proves it.
- Render uses `autoDeployTrigger: off`, which can be an intentional change-control choice, but release promotion, approval, immutable artifact identity and rollback evidence must be documented.
- Monitoring definitions exist, but paging/on-call ownership, SLOs, retention/capacity, log correlation, alert routing and restore drills are not proven.
- Deployment documents describe backups and rollback but include stale Redis/Compose examples inconsistent with the implemented Mongo/Render stack. A document is not restore evidence.

## 9. Production-readiness checklist

| Control | Result |
|---|---|
| Core domain implementation | Pass (SOURCE) |
| Current frontend compilation/unit logic | Pass (LIVE-LOCAL) |
| Current Python suite | Pass with severe warning debt |
| Full backend suite | Conditional; one infrastructure timeout prevented a clean result |
| Role/object authorization | Strong source/test evidence; deployed negative tests missing |
| Data integrity/recurrence | Strong design/test evidence; Atlas/race/timezone acceptance missing |
| Dependency vulnerability gate | Fail |
| AI service isolation/authentication | Fail |
| Reproducible supported deployment | Fail for Compose; Render/Vercel not clean-room verified |
| Browser journeys/mobile/accessibility | Blocked |
| Performance/scalability | Blocked |
| Backup restoration/RPO/RTO | Blocked |
| Monitoring/on-call/incident response | Partial |
| Operational and admin handover | Partial |

## 10. Enterprise handover assessment

The enterprise cannot yet operate and recover the platform independently of the original developer. The README and deployment documents are broad, and scheduler/index documentation is useful, but there is no signed environment inventory, data dictionary, migration ledger, tested restore record, RPO/RTO evidence, supported deployment declaration, runbook ownership matrix, production smoke-test record, AI model card/approval, or role-specific user acceptance pack. The presence of conflicting deployment guidance increases recovery risk.

Required handover evidence: architecture/data-flow and trust-boundary diagrams; versioned environment manifest; Atlas/Supabase/Vercel/Render ownership; least-privilege access roster; migration/index procedure; backup and restore drill; monitoring/SLO/on-call runbook; security/AI incident process; operator/technician/admin guides; known limitations; and signed UAT/release checklist.

## 11. Prioritized remediation plan

| Priority | Work | Effort | Dependencies | Acceptance criteria |
|---|---|---:|---|---|
| P0 | Isolate/authenticate FastAPI; fix stream identity/stateless semantics | M | Render networking, backend client, key management | Anonymous denied; machine streams independent; load/race tests pass |
| P0 | Remediate current dependency advisories and make vulnerability gates blocking | S-M | Dependency compatibility and CI policy | Production audits meet policy; CI fails on unapproved findings |
| P0 | Close historical backup/credential exposure incident | M | Repo admin, secret owners, Atlas/Supabase/SMTP/OAuth | All refs scanned, credentials rotated, sessions invalidated, closure signed |
| P0 | Execute isolated authenticated UAT for all three scenarios | M-L | Seeded staging, test identities, storage/email/AI | Every matrix step has screenshots/log IDs and no P0/P1 failure |
| P0 | Prove recurrence under concurrency/timezone/index conditions | M | Atlas-like staging and required indexes | One and only one successor; correct factory date; visible next due date |
| P1 | Establish one supported reproducible deployment path; repair or retire Compose | M | Platform decision | Clean-room deploy, health checks, smoke test and rollback pass |
| P1 | Add Python, E2E, SAST, image and supply-chain gates | M | CI runners/secrets | Required jobs block merge/release and publish retained evidence |
| P1 | Run object-level authorization matrix and external boundary tests | M | Staging identities | Cross-role/cross-machine IDOR attempts all fail and are logged |
| P1 | Perform backup restore/failover drill | M | Sanitized staging backup | Measured RPO/RTO achieved; application integrity checks pass |
| P1 | Complete observability/on-call readiness | M | Operations ownership | SLO dashboards, actionable alerts and incident exercise pass |
| P2 | Simplify admin information architecture and complete contextual deep links/draft protection | M-L | UAT findings | Role users finish tasks without reselecting records or losing drafts |
| P2 | Formalize AI model governance and drift monitoring | L | Plant data/maintenance experts | Approved model card, baseline/drift alerts, rollback/retraining runbook |
| P2 | Remove runtime/artifact deprecation warnings | S-M | Validated Python dependency set | Clean test run on production image |
| P3 | Visual/mobile/RTL/glove-use polish and digital-twin positioning | M | Field-device testing | Agreed accessibility/usability targets met |

## 12. Ordered path to release

1. Freeze the release candidate and close SEC-01 through SEC-03.
2. Provision a sanitized, production-shaped staging environment with all required indexes and integrations.
3. Run the complete backend, frontend, Python, container and security gates from a clean checkout; make them required.
4. Execute recurrence concurrency/timezone/data-integrity tests and the three authenticated user journeys, including error, refresh, back, retry, empty, direct URL and mobile cases.
5. Execute restore, rollback, failover, capacity and monitoring incident drills; record RPO/RTO and owners.
6. Reconcile deployment/runbook documentation to the single supported architecture and deliver role guides plus AI limitations.
7. Obtain security, maintenance-domain, operations and business-owner sign-off. Only then reconsider the verdict as READY WITH CONDITIONS or READY.

No remediation was implemented. Production verification remains blocked until an explicitly authorized isolated environment, test identities, and operational owners are available.
