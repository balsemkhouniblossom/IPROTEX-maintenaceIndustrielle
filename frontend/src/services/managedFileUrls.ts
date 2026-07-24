import { getApiBaseUrl } from '../config/api-base-url.ts';

export const MANAGED_UPLOAD_ROUTE = '/uploads';
export const MANAGED_FILE_UPLOAD_ROUTE = '/files/uploads';

export type ManagedDocumentPath = {
  file_path: string;
  preview_path?: string;
};

export function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function normalizeManagedPath(pathOrUrl?: string | null): string {
  return (pathOrUrl ?? '').trim().replace(/\\/g, '/');
}

export function resolveManagedFileUrl(pathOrUrl?: string | null): string {
  const normalized = normalizeManagedPath(pathOrUrl);
  if (!normalized) return '';
  if (isAbsoluteUrl(normalized)) return normalized;

  const path = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return `${getApiBaseUrl()}${path}`;
}

export function isManagedRelativeUploadPath(pathOrUrl?: string | null): boolean {
  const normalized = normalizeManagedPath(pathOrUrl);
  return (
    normalized.startsWith(`${MANAGED_UPLOAD_ROUTE}/`) ||
    normalized.startsWith(`${MANAGED_FILE_UPLOAD_ROUTE}/`)
  );
}

export function getDocumentPreviewPath(doc: ManagedDocumentPath): string {
  if (doc.preview_path) return doc.preview_path;
  return doc.file_path;
}

export function resolveDocumentPreviewUrl(doc: ManagedDocumentPath): string {
  const previewPath = getDocumentPreviewPath(doc);
  return resolveManagedFileUrl(previewPath);
}

export function isSafeManagedPreviewPath(pathOrUrl?: string | null): boolean {
  const normalized = normalizeManagedPath(pathOrUrl);
  if (!isManagedRelativeUploadPath(normalized)) return false;

  const uploadRoutePattern = MANAGED_UPLOAD_ROUTE.replace('/', '\\/');
  const fileUploadRoutePattern = MANAGED_FILE_UPLOAD_ROUTE.replace(/\//g, '\\/');
  const safePattern = new RegExp(
    `^(?:${uploadRoutePattern}|${fileUploadRoutePattern})/[A-Za-z0-9._-]+\\.(?:pdf|png|jpe?g|gif|webp|txt)$`,
    'i',
  );

  return safePattern.test(normalized);
}
