import {
  MANAGED_AVATAR_FILE_PREFIX,
  MANAGED_AVATAR_ROUTE,
  toManagedAvatarPath,
} from '../common/managed-file-url';
export { resolveManagedFileUrl as resolveUserPhotoUrl } from '../common/managed-file-url';
import { ApprovalStatus } from '../schemas/user.schema';

const MANAGED_AVATAR_FILE_PATTERN = new RegExp(
  `^${MANAGED_AVATAR_FILE_PREFIX}[A-Za-z0-9._-]+$`,
);

export function toManagedUserPhotoPath(fileName: string): string {
  return toManagedAvatarPath(fileName);
}

export function getManagedAvatarFileName(photo?: string | null): string | null {
  if (!photo) return null;

  const normalized = photo.trim().replaceAll('\\', '/');
  const managedAvatarPrefix = `${MANAGED_AVATAR_ROUTE}/`;
  if (!normalized.startsWith(managedAvatarPrefix)) return null;

  const fileName = normalized.slice(managedAvatarPrefix.length);
  if (!MANAGED_AVATAR_FILE_PATTERN.test(fileName)) return null;

  return fileName;
}

export function shouldExposeUserAvatar(
  user?: {
    is_active?: boolean;
    approval_status?: string;
  } | null,
): boolean {
  if (!user || user.is_active === false) return false;
  return (
    user.approval_status === ApprovalStatus.APPROVED ||
    user.approval_status === undefined ||
    user.approval_status === null
  );
}
