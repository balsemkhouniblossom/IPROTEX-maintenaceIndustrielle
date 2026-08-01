import { Role } from '../schemas/user.schema';
import { ReportType } from '../schemas/generated-report.schema';

/**
 * Which roles may *request* each report type — checked before a data
 * provider ever runs. This is coarse (report-type-level) scoping; machine-
 * scoped report types additionally re-check per-machine access inside
 * their own provider via `DocumentAccessService`, exactly like every
 * other machine-scoped read in this app (Documents, Live Monitoring, the
 * AI assistant, Predictive Maintenance). Fleet-wide/cross-entity report
 * types (stock movements, maintenance costs, technician workload, audit
 * history) are Admin-only outright — there's no natural per-machine or
 * per-technician boundary that would make partial access meaningful for
 * them.
 */
export const REPORT_TYPE_ROLES: Record<ReportType, Role[]> = {
  [ReportType.MACHINE_HISTORY]: [Role.ADMIN, Role.TECHNICIAN, Role.OPERATOR],
  [ReportType.PREVENTIVE_COMPLIANCE]: [Role.ADMIN, Role.TECHNICIAN],
  [ReportType.CORRECTIVE_DOWNTIME]: [Role.ADMIN, Role.TECHNICIAN],
  [ReportType.MTTR_MTBF_TRENDS]: [Role.ADMIN, Role.TECHNICIAN],
  [ReportType.STOCK_MOVEMENTS]: [Role.ADMIN],
  [ReportType.MAINTENANCE_COSTS]: [Role.ADMIN],
  [ReportType.TECHNICIAN_WORKLOAD]: [Role.ADMIN],
  [ReportType.FAULT_FREQUENCY]: [Role.ADMIN, Role.TECHNICIAN],
  [ReportType.AUDIT_HISTORY]: [Role.ADMIN],
  [ReportType.PREDICTIVE_RISK]: [Role.ADMIN, Role.TECHNICIAN],
};

export function canRequestReportType(
  role: string | undefined,
  type: ReportType,
): boolean {
  const allowed = REPORT_TYPE_ROLES[type];
  return Boolean(allowed && role && allowed.includes(role as Role));
}
