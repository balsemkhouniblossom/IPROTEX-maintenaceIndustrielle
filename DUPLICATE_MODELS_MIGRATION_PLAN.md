# Duplicate Data Models — Migration Plan (2026-08-01)

Read-only analysis, verified against current source (see the backend audit
this accompanies). No data has been migrated or deleted. This document is
the plan; execution is a separate, deliberate follow-up.

---

## 1. KPI (`kpi/`) vs KPIs (`kpis/` + `schemas/kpi.schema.ts`)

### Current state (verified)

- **`KpiService` (`backend/src/kpi/`)** computes everything **fresh, on every call**, via aggregation over live `WorkOrder`/`Stock`/`Machine`/`User` data. It is the sole backer of:
  - `GET /dashboard/admin` (Admin dashboard)
  - Technician dashboard counts
  - Operator home dashboard (`GET /operator/dashboard`)
  - Every report provider that needs MTTR/MTBF/compliance/workload figures
- **The `KPI` model / `kpis/` module** is a **stored per-machine snapshot**:
  - Written by `WorkOrdersService.updateKpiForMachine()` on 3 work-order lifecycle events (create-as-completed, update-to-completed, validation-approve) plus a nightly cron (`AutomationSchedulerService.jobRefreshKpis`, `5 0 * * *`).
  - Read by `GET /operator/kpis`, rendered on the **Operator → Preventive** page as per-machine MTBF/MTTR/availability.
  - `KpisController`'s own CRUD (`POST/GET/PATCH/DELETE /kpis`) has **zero frontend callers** — dead from the UI's perspective.

### Why they can disagree

Both implement the same MTTR/MTBF/availability formulas **independently** (`kpi.service.ts` explicitly comments that it "mirrors" the legacy one). A future edit to one and not the other silently diverges. The stored snapshot is only as fresh as the last write trigger; the computed value is always current. A user can see different numbers for the same machine on the Admin dashboard vs. the Operator preventive page.

### Verdict

**`KpiService` (`kpi/`) is canonical.** The `KPI` collection is not dead code (it has a live writer and a live reader) but it is legacy, and the two live formulas should not continue to exist independently.

### Migration strategy (do not execute without product sign-off — this changes a UI-visible feature)

1. **Phase 0 — no code change (already true):** confirm no external/API-only consumer of `GET/POST/PATCH/DELETE /kpis` exists outside this frontend (ask before removing a public route, even an unused one — it may be called by something outside this repo).
2. **Phase 1 — stop the drift, keep both surfaces:** change `operator/preventive`'s KPI card to call `KpiService.computeMttrMtbf({ machineIds: [id] })` (already scope-filterable) instead of reading the stored `KPI` collection. This makes the Operator page live-accurate immediately, with no schema change and no data migration. Low risk, reversible in one line.
3. **Phase 2 — stop writing the snapshot:** once Phase 1 has been running long enough to confirm no regression, remove `updateKpiForMachine`'s 3 call sites in `work-orders.service.ts` and the `jobRefreshKpis` cron entry. The `KPI` collection stops growing but existing rows remain (historical record).
4. **Phase 3 — retire the dead CRUD:** remove `KpisController`/`KpisService`/the `/kpis` routes, having confirmed in Phase 0 nothing external depends on them.
5. **Phase 4 (optional, later):** archive or drop the `kpis` collection itself, only after Phase 2 has been live for a full reporting cycle (so nobody is relying on trend data pulled directly from the collection) and after taking a backup.

### Rollback

- Phase 1 rollback: revert the Operator page's data source back to `GET /operator/kpis` — one-line change, no data loss (the collection was never stopped being written in this phase).
- Phase 2 rollback: re-add the 3 `updateKpiForMachine` call sites and the cron entry — the collection resumes updating; no data was deleted, so historical continuity is preserved.
- Phase 3 rollback: restore the controller/service/routes from version control — no data was touched.
- Phase 4 rollback: restore from the pre-Phase-4 backup.

### Compatibility

Phases 1–3 are entirely internal (server-side data source + admin-only dead-route removal); no request/response shape used by a real UI feature changes. Phase 4 is the only phase that touches stored data, and it is explicitly gated on a backup and a full reporting-cycle soak of Phase 2.

---

## 2. PartRequest vs OTPieces

### Verdict up front: these are **not duplicates**

`PartRequest` is a **request/reservation ledger** (workflow state: pending → reserved → fulfilled/cancelled, who asked, when, tied to a stock hold). `OTPieces` is a **usage/consumption record** (what was actually installed: `ot_id + part_id + quantite`, no workflow, no requester). They represent different moments of the same physical event. **Do not delete either based on "one is a duplicate of the other" — that premise is false.**

### The real problems (verified)

1. **`PartRequest`'s entire operator-request → admin/technician-approve workflow is unreachable from the frontend.** The backend (`requestPartsForOperator`, `decidePartRequest`) is fully built, transactionally correct, and guarded — but grepping all of `frontend/src` for any call to `requestOperatorParts`/`decidePartRequest` finds zero call sites. No operator has a "request a part" button; no technician/admin has an approve/reject UI. In practice, `PartRequest` rows are never created by real usage today, and `OTPieces` is the only collection actually populated end-to-end.
2. **The `RESERVED → FULFILLED` link between them is a heuristic, not a stored reference.** `StockMovementsService.recordUsageChange` looks up a matching `(ot_id, part_id)` `PartRequest` and flips it to `FULFILLED` if the consumed quantity covers the reservation — but `OTPieces` has no foreign key to `PartRequest`, and there is no cleanup path if the technician logs a smaller quantity than was reserved. That reservation stays `RESERVED` forever, permanently holding `Stock.quantite_reservee` for nothing.
3. **The admin `ot-pieces` CRUD (`ot-pieces.controller.ts`) bypasses `StockMovementsService` entirely.** An admin `PATCH`/`DELETE` on an `OTPieces` row changes `quantite` directly with no transaction, no stock adjustment, and no audit trail — silently desynchronizing `Stock` from what `OTPieces` claims was consumed. (This request's DTO validation gap on that same controller is fixed as part of this change; the stock-consistency bypass is not — see below.)

### Recommendation (a product decision, not purely technical — this document does not implement it)

Pick one of two directions; do not leave the current dead-half-built state as-is:

- **Option A — retire `PartRequest`:** if the intent is that operators never formally "request" a part (they just report what they used, via `OTPieces`), delete `PartRequest`, `decidePartRequest`, `requestPartsForOperator`, and the `FULFILLED`-sync code in `stock-movements.service.ts` together, as one unit, after confirming the `PartRequest` collection has no rows worth preserving (or archiving it first).
- **Option B — wire up the UI:** if the intent was always to have a real request/approval workflow (which the backend clearly was built for), add the operator "request part" button and the admin/technician approve/reject screen. This is the larger option but recovers real, already-built backend value.

Either way, **fix the admin `ot-pieces` CRUD bypass** regardless of which option is chosen: route `OtPiecesService.update`/`remove` through `StockMovementsService` (or block direct quantity edits entirely and require going through the technician's transactional `setPartQuantity` path) so `Stock` can never drift from what `OTPieces` records. This is a contained, backend-only change with no data migration required — recommended as a near-term follow-up, not done in this pass (it changes admin-facing behavior and deserves its own focused change + tests, not to be bundled into a validation-hardening pass).

### Migration strategy if Option A is chosen

1. Confirm (via a read-only query against the real database, not assumed) how many `PartRequest` rows exist and their status distribution.
2. Export/archive those rows (e.g. to a one-off collection or a JSON dump) before deleting anything — never delete until the export is verified restorable.
3. Remove the write paths (`requestPartsForOperator`, `decidePartRequest`) and their controller routes.
4. Remove the `FULFILLED`-sync lookup in `stock-movements.service.ts` (it becomes dead code once nothing can reach `RESERVED`).
5. Leave the `PartRequest` collection and schema in place, unread, for one full release cycle before dropping it — in case something was missed.
6. Only then drop the collection.

### Rollback

Every step above is additive-safe until step 6: removing routes/controllers is a version-control revert; the collection itself is untouched until the final, explicitly-gated step. If Option B is chosen instead, no rollback is needed — nothing is removed, only added.

### Compatibility

Neither option changes `OTPieces`'s existing behavior or schema. Option A removes two admin-invisible backend routes (`POST /operator/work-orders/:id/parts-request`, `PATCH /work-orders/part-requests/:id/decision`) that have no current frontend caller, so no visible feature regresses. Option B is purely additive.
