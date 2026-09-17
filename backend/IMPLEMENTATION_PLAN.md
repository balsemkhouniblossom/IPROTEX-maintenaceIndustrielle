# MTTR Calculation Implementation Plan

## Architecture
- Shared `MttrCalculationService` in KpiModule (reused by KpiService, WorkOrderKpiService, AnalyticsService)
- KpiModule gains InterventionReport schema (no schema changes, just query access)
- New AnalyticsModule with GET /analytics/mttr (JWT auth + role guard)
- No circular DI: AnalyticsModule imports KpiModule + DocumentsModule

## Files Created
1. `src/kpi/mttr-calculation.service.ts` - Core MTTR calc (pure function + service)
2. `src/analytics/analytics.module.ts`
3. `src/analytics/analytics.controller.ts`
4. `src/analytics/analytics.service.ts`
5. `src/analytics/analytics.service.spec.ts`

## Files Modified
1. `src/kpi/kpi.module.ts` - Add InterventionReport schema
2. `src/kpi/kpi.service.ts` - MTTR uses MttrCalculationService
3. `src/work-orders/services/work-order-kpi.service.ts` - mttr_value uses MttrCalculationService
4. `src/app.module.ts` - Import AnalyticsModule
5. `test/dashboard-kpis.e2e-spec.ts` - Add InterventionReport seeds, update MTTR assertions
6. `src/kpi/kpi.service.spec.ts` - Update computeMttrMtbf tests
7. `src/work-orders/services/work-order-kpi.service.spec.ts` - Update MTTR tests

## Key Design Decisions
- MTTR unit: minutes (detail rows also show milliseconds for precision)
- Null MTTR for zero repairs (not 0)
- Exclusion reasons tracked per category
- All 12 months returned for requested year
- JWT auth + AuthenticatedRoles guard on endpoint
