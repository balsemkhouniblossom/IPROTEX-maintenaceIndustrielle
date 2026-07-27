import { ForbiddenException } from '@nestjs/common';
import { ApprovalStatus, Role } from '../schemas/user.schema';
import {
  validateAccountAccess,
  validateSessionRestoreAccess,
} from './account-access.validator';
import { AccountAccessErrorCode } from './account-access-error-code';

function expectAccessCode(
  user: Record<string, unknown>,
  code: AccountAccessErrorCode,
) {
  try {
    validateAccountAccess(user);
    throw new Error('Expected account access validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toEqual(
      expect.objectContaining({ code }),
    );
  }
}

describe('validateAccountAccess', () => {
  it('allows explicit approved active verified accounts for all existing roles', () => {
    for (const role of [Role.ADMIN, Role.TECHNICIAN, Role.OPERATOR]) {
      expect(() =>
        validateAccountAccess({
          approval_status: ApprovalStatus.APPROVED,
          is_active: true,
          is_verified: true,
          role,
        }),
      ).not.toThrow();
    }
  });

  it('returns rejected when explicit rejected, even when inactive', () => {
    expectAccessCode(
      {
        approval_status: ApprovalStatus.REJECTED,
        is_active: false,
        is_verified: true,
        role: Role.OPERATOR,
      },
      AccountAccessErrorCode.ACCOUNT_REJECTED,
    );
  });

  it('returns email-not-verified for pending unverified accounts', () => {
    expectAccessCode(
      {
        approval_status: ApprovalStatus.PENDING,
        is_active: false,
        is_verified: false,
        role: Role.OPERATOR,
      },
      AccountAccessErrorCode.EMAIL_NOT_VERIFIED,
    );
  });

  it('returns pending for pending verified accounts', () => {
    expectAccessCode(
      {
        approval_status: ApprovalStatus.PENDING,
        is_active: false,
        is_verified: true,
        role: Role.OPERATOR,
      },
      AccountAccessErrorCode.ACCOUNT_PENDING_APPROVAL,
    );
  });

  it('returns email-not-verified for approved unverified accounts', () => {
    expectAccessCode(
      {
        approval_status: ApprovalStatus.APPROVED,
        is_active: true,
        is_verified: false,
        role: Role.OPERATOR,
      },
      AccountAccessErrorCode.EMAIL_NOT_VERIFIED,
    );
  });

  it('returns inactive for approved inactive accounts', () => {
    expectAccessCode(
      {
        approval_status: ApprovalStatus.APPROVED,
        is_active: false,
        is_verified: true,
        role: Role.OPERATOR,
      },
      AccountAccessErrorCode.ACCOUNT_INACTIVE,
    );
  });

  it('supports legacy fallback states without mutating the user', () => {
    const legacyApproved = {
      is_active: true,
      is_verified: true,
      role: Role.OPERATOR,
    };
    const snapshot = { ...legacyApproved };

    expect(() => validateAccountAccess(legacyApproved)).not.toThrow();
    expect(legacyApproved).toEqual(snapshot);

    expectAccessCode(
      { is_active: true, is_verified: false, role: Role.OPERATOR },
      AccountAccessErrorCode.EMAIL_NOT_VERIFIED,
    );
    expectAccessCode(
      { is_active: false, is_verified: true, role: Role.OPERATOR },
      AccountAccessErrorCode.ACCOUNT_PENDING_APPROVAL,
    );
  });

  it('explicit status wins over legacy fallback and malformed roles fail safely', () => {
    expectAccessCode(
      {
        approval_status: ApprovalStatus.PENDING,
        is_active: true,
        is_verified: true,
        role: Role.OPERATOR,
      },
      AccountAccessErrorCode.ACCOUNT_PENDING_APPROVAL,
    );
    expectAccessCode(
      {
        approval_status: ApprovalStatus.APPROVED,
        is_active: true,
        is_verified: true,
        role: 'supervisor',
      },
      AccountAccessErrorCode.ACCOUNT_ROLE_NOT_ALLOWED,
    );
  });
});

describe('validateSessionRestoreAccess', () => {
  it('allows an incomplete Google profile to restore its session', () => {
    expect(() =>
      validateSessionRestoreAccess({
        approval_status: ApprovalStatus.PENDING,
        is_active: false,
        is_verified: true,
        role: Role.OPERATOR,
        profile_completed: false,
      }),
    ).not.toThrow();
  });

  it('still blocks a rejected account even with an incomplete profile', () => {
    try {
      validateSessionRestoreAccess({
        approval_status: ApprovalStatus.REJECTED,
        is_active: false,
        is_verified: true,
        role: Role.OPERATOR,
        profile_completed: false,
      });
      throw new Error('Expected session restoration to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toEqual(
        expect.objectContaining({
          code: AccountAccessErrorCode.ACCOUNT_REJECTED,
        }),
      );
    }
  });

  it('keeps the established behavior for a completed profile still pending approval', () => {
    try {
      validateSessionRestoreAccess({
        approval_status: ApprovalStatus.PENDING,
        is_active: false,
        is_verified: true,
        role: Role.OPERATOR,
        profile_completed: true,
      });
      throw new Error('Expected session restoration to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toEqual(
        expect.objectContaining({
          code: AccountAccessErrorCode.ACCOUNT_PENDING_APPROVAL,
        }),
      );
    }
  });

  it('keeps the established behavior when profile completion is unknown (legacy/non-Google accounts)', () => {
    try {
      validateSessionRestoreAccess({
        approval_status: ApprovalStatus.PENDING,
        is_active: false,
        is_verified: true,
        role: Role.OPERATOR,
      });
      throw new Error('Expected session restoration to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toEqual(
        expect.objectContaining({
          code: AccountAccessErrorCode.ACCOUNT_PENDING_APPROVAL,
        }),
      );
    }
  });

  it('allows a fully approved active account to restore its session as before', () => {
    expect(() =>
      validateSessionRestoreAccess({
        approval_status: ApprovalStatus.APPROVED,
        is_active: true,
        is_verified: true,
        role: Role.OPERATOR,
        profile_completed: true,
      }),
    ).not.toThrow();
  });
});
