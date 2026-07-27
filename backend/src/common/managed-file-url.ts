import type { Request } from 'express';

export const MANAGED_UPLOAD_ROUTE = '/uploads';
export const MANAGED_FILE_UPLOAD_ROUTE = '/files/uploads';
export const MANAGED_AVATAR_DIRECTORY = 'avatars';
export const MANAGED_AVATAR_FILE_PREFIX = 'avatar-';
export const MANAGED_AVATAR_ROUTE = `${MANAGED_FILE_UPLOAD_ROUTE}/${MANAGED_AVATAR_DIRECTORY}`;
// Deliberately not mounted under any Express static route and not a
// sub-path of `/uploads` — quarantined files (rejected document uploads)
// must never be resolvable through the public/protected file-serving code
// paths that key off the `/uploads/...` prefix.
export const MANAGED_QUARANTINE_DIRECTORY = 'quarantine';

export function getApiBaseUrl(req?: Request): string {
  return (
    process.env.API_URL ||
    `${req?.protocol || 'http'}://${req?.get('host') || 'localhost:3001'}`
  ).replace(/\/$/, '');
}

export function toManagedUploadPath(fileName: string): string {
  return `${MANAGED_UPLOAD_ROUTE}/${fileName}`;
}

export function toManagedAvatarPath(fileName: string): string {
  return `${MANAGED_AVATAR_ROUTE}/${fileName}`;
}

export function toManagedQuarantinePath(fileName: string): string {
  return `/${MANAGED_QUARANTINE_DIRECTORY}/${fileName}`;
}

export function resolveManagedFileUrl(
  pathOrUrl?: string | null,
  req?: Request,
): string {
  if (!pathOrUrl) return '';

  const normalized = pathOrUrl.trim().replace(/\\/g, '/');
  if (!normalized) return '';

  if (/^https?:\/\//i.test(normalized)) return normalized;

  const path = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return `${getApiBaseUrl(req)}${path}`;
}
