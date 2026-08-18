import { Types } from 'mongoose';

export function isMaintenanceDocumentType(type?: string): boolean {
  const value = (type || '').toLowerCase();
  return Boolean(value) && (
    value.includes('manual') ||
    value.includes('maintenance') ||
    value.includes('electrical') ||
    value.includes('pneumatic') ||
    value.includes('safety') ||
    value.includes('spare') ||
    value.includes('catalogue')
  );
}

export function populatedObjectIdString(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Types.ObjectId) return value.toHexString();
  if (typeof value === 'object' && '_id' in value) {
    return populatedObjectIdString((value as { _id?: unknown })._id);
  }
  return '';
}