import { Types } from 'mongoose';

export const PREVENTIVE_OCCURRENCE_KEY_INDEX_NAME =
  'work_orders_preventive_occurrence_key_unique';
export const PREVENTIVE_OCCURRENCE_KEY_PREFIX = 'preventive:v1:';
export const PREVENTIVE_OCCURRENCE_KEY_PREFIX_END = 'preventive:v1;';

export const PREVENTIVE_OCCURRENCE_KEY_PARTIAL_FILTER = {
  preventive_occurrence_key: {
    $gte: PREVENTIVE_OCCURRENCE_KEY_PREFIX,
    $lt: PREVENTIVE_OCCURRENCE_KEY_PREFIX_END,
  },
} as const;

function objectIdString(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value.toLowerCase();
  if (value instanceof Types.ObjectId) return value.toHexString();
  if (typeof value === 'object' && value !== null && '_id' in value) {
    return objectIdString((value as { _id?: unknown })._id);
  }
  return '';
}

function canonicalMaintenanceType(value: unknown): string {
  const normalized =
    typeof value === 'string' && value.trim() ? value.trim() : 'maintenance';
  return encodeURIComponent(normalized.toLowerCase());
}

function canonicalId(value: unknown, fallback: string): string {
  const id = objectIdString(value);
  return id || fallback;
}

export function canonicalPreventiveOccurrenceTimestamp(value: Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('preventive occurrence due date must be a valid date');
  }
  return date.toISOString();
}

export function buildPreventiveOccurrenceKey(input: {
  maintenanceType: unknown;
  machineId: unknown;
  moduleId?: unknown;
  planId: unknown;
  dueDate: Date;
}): string {
  return [
    PREVENTIVE_OCCURRENCE_KEY_PREFIX.slice(0, -1),
    canonicalMaintenanceType(input.maintenanceType),
    canonicalId(input.machineId, 'missing-machine'),
    canonicalId(input.moduleId, 'missing-module'),
    canonicalId(input.planId, 'missing-plan'),
    canonicalPreventiveOccurrenceTimestamp(input.dueDate),
  ].join(':');
}

export function isDuplicatePreventiveOccurrenceKeyError(
  error: unknown,
  occurrenceKey: string,
): boolean {
  const mongoError = error as {
    code?: number;
    index?: string;
    keyPattern?: Record<string, unknown>;
    keyValue?: Record<string, unknown>;
  };
  if (mongoError?.code !== 11000) {
    return false;
  }
  if (mongoError.index === PREVENTIVE_OCCURRENCE_KEY_INDEX_NAME) {
    return true;
  }
  if (mongoError.keyPattern?.preventive_occurrence_key === 1) {
    return true;
  }
  return mongoError.keyValue?.preventive_occurrence_key === occurrenceKey;
}
