import { ApprovalStatus } from '../schemas/user.schema';
import {
  isEffectivelyApproved,
  resolveApprovalStatus,
} from './approval-status.utils';

describe('approval status helpers', () => {
  it('returns explicit approved status', () => {
    expect(
      resolveApprovalStatus({ approval_status: ApprovalStatus.APPROVED }),
    ).toBe(ApprovalStatus.APPROVED);
  });

  it('returns explicit pending status', () => {
    expect(
      resolveApprovalStatus({ approval_status: ApprovalStatus.PENDING }),
    ).toBe(ApprovalStatus.PENDING);
  });

  it('returns explicit rejected status', () => {
    expect(
      resolveApprovalStatus({ approval_status: ApprovalStatus.REJECTED }),
    ).toBe(ApprovalStatus.REJECTED);
  });

  it('treats missing status with active and verified flags as approved', () => {
    expect(resolveApprovalStatus({ is_active: true, is_verified: true })).toBe(
      ApprovalStatus.APPROVED,
    );
  });

  it('treats missing status with inactive flag as pending', () => {
    expect(resolveApprovalStatus({ is_active: false, is_verified: true })).toBe(
      ApprovalStatus.PENDING,
    );
  });

  it('treats missing status with unverified flag as pending', () => {
    expect(resolveApprovalStatus({ is_active: true, is_verified: false })).toBe(
      ApprovalStatus.PENDING,
    );
  });

  it('treats an active and verified legacy administrator as effectively approved', () => {
    expect(isEffectivelyApproved({ is_active: true, is_verified: true })).toBe(
      true,
    );
  });

  it('does not override explicit rejected status with active and verified flags', () => {
    expect(
      isEffectivelyApproved({
        approval_status: ApprovalStatus.REJECTED,
        is_active: true,
        is_verified: true,
      }),
    ).toBe(false);
  });

  it('does not mutate the supplied user object', () => {
    const user = { is_active: true, is_verified: true };
    const snapshot = { ...user };

    resolveApprovalStatus(user);

    expect(user).toEqual(snapshot);
  });

  it('does not throw when optional fields are missing', () => {
    expect(() => resolveApprovalStatus({})).not.toThrow();
    expect(resolveApprovalStatus({})).toBe(ApprovalStatus.PENDING);
  });
});
