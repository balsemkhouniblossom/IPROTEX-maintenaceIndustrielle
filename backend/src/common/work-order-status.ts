/**
 * The canonical status vocabulary for a WorkOrder's lifecycle stage,
 * shared by every place that needs to know whether an order is "still
 * open" or "done with" — access-control scoping, technician dashboards,
 * and fleet-wide KPI aggregation all used to keep their own copy of these
 * lists (with real risk of drifting apart); this file is the one place
 * they're defined now.
 */
export const CLOSED_WORK_ORDER_STATUSES = [
  'completed',
  'validated',
  'cancelled',
  'canceled',
  'CLOTURE',
  'ANNULE',
];

export const COMPLETED_WORK_ORDER_STATUSES = [
  'completed',
  'validated',
  'CLOTURE',
];

export const WAITING_VALIDATION_STATUS = 'waiting_validation';
