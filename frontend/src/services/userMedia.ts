import { resolveManagedFileUrl } from '@/services/managedFileUrls';

function stripWrappingQuotes(value?: string | null): string | undefined {
  if (!value) return undefined;
  let start = 0;
  let end = value.length;

  while (start < end && (value[start] === '"' || value[start] === "'")) start += 1;
  while (end > start && (value[end - 1] === '"' || value[end - 1] === "'")) end -= 1;

  return value.slice(start, end);
}

export function resolveUserPhotoUrl(photoPath?: string | null): string {
  const stripped = stripWrappingQuotes(photoPath);
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
