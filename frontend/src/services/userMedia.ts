import { resolveManagedFileUrl } from './managedFileUrls.ts';

const LEGACY_AVATAR_PATH_PREFIX = 'uploads/avatars/';
const MANAGED_AVATAR_ROUTE = '/files/uploads/avatars/';

function stripWrappingQuotes(value?: string | null): string | undefined {
  if (!value) return undefined;
  let start = 0;
  let end = value.length;

  while (start < end && (value[start] === '"' || value[start] === "'")) start += 1;
  while (end > start && (value[end - 1] === '"' || value[end - 1] === "'")) end -= 1;

  return value.slice(start, end);
}

function normalizeUserPhotoPath(photoPath?: string | null): string | undefined {
  const stripped = stripWrappingQuotes(photoPath)?.trim().replace(/\\/g, '/');
  if (!stripped || /^https?:\/\//i.test(stripped)) return stripped;

  if (stripped.startsWith(LEGACY_AVATAR_PATH_PREFIX)) {
    return `${MANAGED_AVATAR_ROUTE}${stripped.slice(LEGACY_AVATAR_PATH_PREFIX.length)}`;
  }

  const slashLegacyAvatarPathPrefix = `/${LEGACY_AVATAR_PATH_PREFIX}`;
  if (stripped.startsWith(slashLegacyAvatarPathPrefix)) {
    return `${MANAGED_AVATAR_ROUTE}${stripped.slice(slashLegacyAvatarPathPrefix.length)}`;
  }

  return stripped;
}

export function resolveUserPhotoUrl(photoPath?: string | null): string {
  const resolved = resolveManagedFileUrl(normalizeUserPhotoPath(photoPath));
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

  const last = parts.at(-1)?.charAt(0)?.toUpperCase();
  return last || null;
}
