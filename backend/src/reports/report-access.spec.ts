import { canRequestReportType, REPORT_TYPE_ROLES } from './report-access';
import { ReportType } from '../schemas/generated-report.schema';
import { Role } from '../schemas/user.schema';

describe('canRequestReportType', () => {
  it('every report type maps to at least Admin', () => {
    for (const type of Object.values(ReportType)) {
      expect(REPORT_TYPE_ROLES[type]).toContain(Role.ADMIN);
    }
  });

  it('allows Admin for every report type', () => {
    for (const type of Object.values(ReportType)) {
      expect(canRequestReportType(Role.ADMIN, type)).toBe(true);
    }
  });

  it('restricts fleet-wide/cross-entity report types to Admin only', () => {
    for (const type of [
      ReportType.STOCK_MOVEMENTS,
      ReportType.MAINTENANCE_COSTS,
      ReportType.TECHNICIAN_WORKLOAD,
      ReportType.AUDIT_HISTORY,
    ]) {
      expect(canRequestReportType(Role.TECHNICIAN, type)).toBe(false);
      expect(canRequestReportType(Role.OPERATOR, type)).toBe(false);
    }
  });

  it('allows Technician for machine-scoped report types', () => {
    for (const type of [
      ReportType.MACHINE_HISTORY,
      ReportType.PREVENTIVE_COMPLIANCE,
      ReportType.CORRECTIVE_DOWNTIME,
      ReportType.MTTR_MTBF_TRENDS,
      ReportType.FAULT_FREQUENCY,
      ReportType.PREDICTIVE_RISK,
    ]) {
      expect(canRequestReportType(Role.TECHNICIAN, type)).toBe(true);
    }
  });

  it('restricts Operator to machine history only', () => {
    expect(canRequestReportType(Role.OPERATOR, ReportType.MACHINE_HISTORY)).toBe(true);
    expect(canRequestReportType(Role.OPERATOR, ReportType.PREVENTIVE_COMPLIANCE)).toBe(false);
  });

  it('returns false for an undefined or unknown role', () => {
    expect(canRequestReportType(undefined, ReportType.MACHINE_HISTORY)).toBe(false);
    expect(canRequestReportType('not-a-role', ReportType.MACHINE_HISTORY)).toBe(false);
  });
});
