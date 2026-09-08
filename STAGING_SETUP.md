# Isolated staging setup

This is the repository-side preparation for Phase 2 UAT. It does not prove
that staging exists and it must never be used with production data.

## Release candidate

Build every staging component from the same reviewed corrective commit. Record
that SHA in Render and Vercel deployment evidence before UAT. The corrective
branch is based on `411ad7f`.

## Topology and configuration

- Vercel staging project, root directory `frontend`, using
  `frontend/.env.staging.example`.
- Render NestJS staging service, root directory `backend`, using
  `backend/.env.staging.example`.
- Render FastAPI staging service, root directory `ai-service`, using
  `ai-service/.env.staging.example` and a staging-only artifact disk.
- Dedicated Atlas database and database user with access only to that database.
- Dedicated private Supabase project/bucket and staging-only service key.
- Optional staging Prometheus/Grafana instances targeting only staging.

The same random `AI_SERVICE_TOKEN` is stored in the backend and FastAPI secret
stores. It is never a Vercel variable. FastAPI `/health` and `/ready` remain
public probes; `/v1/*` requires `X-AI-Service-Token`. Stateful requests include
the backend-derived machine/sensor `stream_id`.

## Guarded synthetic seed

Populate the environment from `backend/.env.staging.example`, using secret
storage rather than a committed file. The URI must name the exact dedicated
database and both explicit safety controls must match:

```powershell
cd backend
$env:UAT_SEED_CONFIRM = 'SEED_ISOLATED_STAGING'
$env:UAT_EXPECTED_DATABASE = 'gmao_uat_staging'
npm run mongodb:indexes:check
npm run mongodb:indexes:apply
npm run seed:uat-staging
npm run verify:uat-staging
```

The seeder rejects a missing confirmation, a URI/database mismatch, names that
do not contain `staging`, `uat`, or `test`, and any production-named database.
Passwords come from `UAT_*_PASSWORD` secrets and are never logged. Stable
`UAT-*` keys make reruns idempotent. It creates approved/verified/active test
users, three synthetic machines, assignments, a corrective work order, one
part/stock fixture, a checklist, and an active six-calendar-month plan. Plan
activation and the initial occurrence use existing lifecycle/scheduling
services; no alternate scheduler is introduced.

The seeder intentionally disables background automation while it runs. The
staging service may enable automation afterward for acceptance testing.

## Index and recurrence acceptance

`mongodb:indexes:check/apply` uses the registered Mongoose schemas. The
read-only `verify:uat-staging` check additionally requires:

- the unique partial `work_orders_preventive_occurrence_key_unique` index;
- no duplicate populated preventive occurrence keys;
- scheduler-lock unique-name and TTL indexes;
- exactly one initial occurrence for `UAT-PLAN-6M-001`.

Live acceptance, not this preparation, must execute:

```text
active plan -> initial occurrence -> Operator checklist submission
-> waiting_validation -> Admin validation -> exactly one successor
```

The successor must be six calendar months after the validated execution date in
`Africa/Tunis`, survive duplicate/concurrent validation without another
successor, preserve the historical occurrence and plan history/version, and be
visible as the Operator's next scheduled date. Record API IDs, timestamps,
index output and browser evidence without recording credentials.

## Infrastructure isolation checklist

- [ ] Atlas staging project/database/user are separate from production.
- [ ] Supabase staging project/private bucket/key are separate from production.
- [ ] Render backend and AI services have staging-only names, URLs and secrets.
- [ ] Vercel staging project points only to the staging backend.
- [ ] Exact CORS origins contain only the staging frontend.
- [ ] Staging mail uses a sandbox or controlled synthetic recipient domain.
- [ ] The same reviewed SHA is deployed to all services.
- [ ] State-changing Phase 2 UAT is explicitly authorized.
