import { ApprovalStatus } from '../schemas/user.schema';

export interface ApprovalStatusLikeUser {
  approval_status?: ApprovalStatus;
  is_active?: boolean;
  is_verified?: boolean;
}

export function resolveApprovalStatus(
  user?: ApprovalStatusLikeUser | null,
): ApprovalStatus {
  if (user?.approval_status) {
    return user.approval_status;
  }

  if (user?.is_active === true && user?.is_verified === true) {
    return ApprovalStatus.APPROVED;
  }

  return ApprovalStatus.PENDING;
}

export function isEffectivelyApproved(
  user?: ApprovalStatusLikeUser | null,
): boolean {
  return resolveApprovalStatus(user) === ApprovalStatus.APPROVED;
}
