import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ApprovalStatus, Role } from '../schemas/user.schema';
import { resolveApprovalStatus } from '../users/approval-status.utils';
import { AccountAccessErrorCode } from './account-access-error-code';

export type AccountAccessUser = {
  approval_status?: ApprovalStatus;
  is_active?: boolean;
  is_verified?: boolean;
  role?: string;
  profile_completed?: boolean;
  must_reset_password?: boolean;
};

export function throwInvalidCredentials(): never {
  throw new UnauthorizedException({
    code: AccountAccessErrorCode.INVALID_CREDENTIALS,
    message: 'Invalid email or password.',
  });
}

export function validateAccountAccess(user: AccountAccessUser): void {
  const approvalStatus = resolveApprovalStatus(user);

  if (approvalStatus === ApprovalStatus.REJECTED) {
    throwAccountAccessDenied(
      AccountAccessErrorCode.ACCOUNT_REJECTED,
      'Your account request was rejected.',
    );
  }

  if (!user.is_verified) {
    throwAccountAccessDenied(
      AccountAccessErrorCode.EMAIL_NOT_VERIFIED,
      'Your email has not been verified.',
    );
  }

  if (approvalStatus === ApprovalStatus.PENDING) {
    throwAccountAccessDenied(
      AccountAccessErrorCode.ACCOUNT_PENDING_APPROVAL,
      'Your account is waiting for administrator approval.',
    );
  }

  if (approvalStatus !== ApprovalStatus.APPROVED) {
    throwAccountAccessDenied(
      AccountAccessErrorCode.ACCOUNT_PENDING_APPROVAL,
      'Your account is waiting for administrator approval.',
    );
  }

  if (!user.is_active) {
    throwAccountAccessDenied(
      AccountAccessErrorCode.ACCOUNT_INACTIVE,
      'Your account is inactive.',
    );
  }

  if (!isKnownRole(user.role)) {
    throwAccountAccessDenied(
      AccountAccessErrorCode.ACCOUNT_ROLE_NOT_ALLOWED,
      'Your account role is not allowed.',
    );
  }

  if (user.must_reset_password) {
    throwAccountAccessDenied(
      AccountAccessErrorCode.PASSWORD_RESET_REQUIRED,
      'Your password must be reset before you can continue. Use "Forgot password" to set a new one.',
    );
  }
}

/**
 * Session-restoration is deliberately narrower than full account access.
 * A Google account mid-onboarding (profile_completed === false) is always
 * approval_status PENDING / is_active false purely as a "not finished yet"
 * placeholder, not as an "awaiting admin review" state. Letting these users
 * restore their identity (so they can reach /auth/complete-profile) does not
 * grant application access: JwtAuthGuard still blocks every route except
 * complete-profile/logout for profile_completed === false users. Rejected
 * accounts are never allowed to restore a session, regardless of profile
 * completion. Every other lifecycle state keeps the existing, established
 * validateAccountAccess behavior unchanged.
 */
export function validateSessionRestoreAccess(user: AccountAccessUser): void {
  if (resolveApprovalStatus(user) === ApprovalStatus.REJECTED) {
    throwAccountAccessDenied(
      AccountAccessErrorCode.ACCOUNT_REJECTED,
      'Your account request was rejected.',
    );
  }

  if (user.profile_completed === false) {
    return;
  }

  validateAccountAccess(user);
}

function throwAccountAccessDenied(
  code: AccountAccessErrorCode,
  message: string,
): never {
  throw new ForbiddenException({
    code,
    message,
  });
}

function isKnownRole(role?: string): boolean {
  return (
    role === Role.ADMIN || role === Role.TECHNICIAN || role === Role.OPERATOR
  );
}
