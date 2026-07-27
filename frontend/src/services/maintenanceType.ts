/**
 * `type_maintenance` is a free-form string (no enum) shared with the
 * backend — the Admin plan form offers preventive/corrective/inspection/
 * lubrication plus a free-text custom option. Every page that needs to
 * distinguish "corrective" (one-off reactive repair) from everything else
 * (preventive, lubrication, inspection, or a custom scheduled-maintenance
 * label) should use this helper instead of comparing against the literal
 * string `"preventive"`, which silently mis-buckets lubrication/inspection
 * as corrective. Mirrors backend/src/common/maintenance-type.ts.
 */
export function isCorrectiveMaintenanceType(type?: string | null): boolean {
  return /correct/i.test(type || '');
}
