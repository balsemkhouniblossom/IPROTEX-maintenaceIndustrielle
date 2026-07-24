import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ApprovalStatus, Role } from '../schemas/user.schema';
import { resolveApprovalStatus } from '../users/approval-status.utils';
import { AccountAccessErrorCode } from './account-access-error-code';

export type AccountAccessUser = {
  approval_status?: ApprovalStatus;
  is_active?: boolean;
  is_verified?: boolean;
  role?: string;
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
