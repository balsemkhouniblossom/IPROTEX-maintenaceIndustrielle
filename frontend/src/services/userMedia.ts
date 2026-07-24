import { resolveManagedFileUrl } from '@/services/managedFileUrls';

export function resolveUserPhotoUrl(photoPath?: string | null): string {
  const stripped = photoPath?.replace(/^['\"]+|['\"]+$/g, '');
  const resolved = resolveManagedFileUrl(stripped);
  return resolved ? encodeURI(resolved) : '';
}

export function getAvatarInitial(name?: string | null): string | null {
  if (!name) return null;

  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return null;
  }

  const first = parts[0]?.charAt(0)?.toUpperCase();
  if (first) {
    return first;
  }

  const last = parts[parts.length - 1]?.charAt(0)?.toUpperCase();
  return last || null;
}
