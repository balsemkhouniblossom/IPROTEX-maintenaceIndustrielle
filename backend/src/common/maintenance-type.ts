/**
 * `MaintenancePlan`/`WorkOrder.type_maintenance` is a free-form string (no
 * schema enum) — the Admin UI offers preventive/corrective/inspection/
 * lubrication plus a free-text custom option. Every scheduling-related check
 * in the app cares about exactly one distinction: corrective (one-off
 * reactive repair, never auto-scheduled/recurring) vs. everything else
 * (preventive, lubrication, inspection, or any custom scheduled-maintenance
 * label). These helpers are the single source of truth for that check, so
 * "preventive-only" substring checks don't silently exclude lubrication/
 * inspection plans from scheduling.
 */
export const CORRECTIVE_TYPE_REGEX = /correct/i;

export function isCorrectiveMaintenanceType(type?: string | null): boolean {
  return CORRECTIVE_TYPE_REGEX.test(type || '');
}

/**
 * True for any populated, non-corrective type (preventive, lubrication,
 * inspection, or a custom admin-entered value). False for corrective AND
 * for an empty/missing type — matches every existing throw-based guard's
 * original "must actually say something non-corrective" behavior.
 */
export function isSchedulableMaintenanceType(type?: string | null): boolean {
  return Boolean(type) && !isCorrectiveMaintenanceType(type);
}

export const NOT_CORRECTIVE_TYPE_FILTER = {
  type_maintenance: { $not: CORRECTIVE_TYPE_REGEX },
} as const;
