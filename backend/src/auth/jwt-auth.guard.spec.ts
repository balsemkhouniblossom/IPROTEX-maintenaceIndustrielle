import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ApprovalStatus, Role } from '../schemas/user.schema';

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => contextFor,
    getClass: () => JwtAuthGuard,
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard account state enforcement', () => {
  let passportCanActivate: jest.SpyInstance;
  let guard: JwtAuthGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  beforeEach(() => {
    const parentPrototype = Object.getPrototypeOf(JwtAuthGuard.prototype) as {
      canActivate: (context: ExecutionContext) => boolean | Promise<boolean>;
    };
    passportCanActivate = jest
      .spyOn(parentPrototype, 'canActivate')
      .mockResolvedValue(true);
    reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    };
    guard = new JwtAuthGuard(reflector as unknown as Reflector);
  });

  afterEach(() => {
    passportCanActivate.mockRestore();
  });

  it('allows approved completed users to access protected APIs', async () => {
    await expect(
      guard.canActivate(
        contextFor({
          method: 'GET',
          path: '/documents',
          user: {
            role: Role.OPERATOR,
            is_active: true,
            is_verified: true,
            approval_status: ApprovalStatus.APPROVED,
            profile_completed: true,
          },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('skips JWT validation for explicitly public routes', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    await expect(
      guard.canActivate(
        contextFor({
          method: 'GET',
          path: '/health',
        }),
      ),
    ).resolves.toBe(true);
    expect(passportCanActivate).not.toHaveBeenCalled();
  });

  it.each([
    [
      'incomplete',
      {
        role: Role.OPERATOR,
        is_active: false,
        is_verified: true,
        approval_status: ApprovalStatus.PENDING,
        profile_completed: false,
      },
      'PROFILE_COMPLETION_REQUIRED',
    ],
    [
      'pending',
      {
        role: Role.OPERATOR,
        is_active: false,
        is_verified: true,
        approval_status: ApprovalStatus.PENDING,
        profile_completed: true,
      },
      'ACCOUNT_PENDING_APPROVAL',
    ],
    [
      'inactive',
      {
        role: Role.OPERATOR,
        is_active: false,
        is_verified: true,
        approval_status: ApprovalStatus.APPROVED,
        profile_completed: true,
      },
      'ACCOUNT_INACTIVE',
    ],
    [
      'rejected',
      {
        role: Role.OPERATOR,
        is_active: false,
        is_verified: true,
        approval_status: ApprovalStatus.REJECTED,
        profile_completed: true,
      },
      'ACCOUNT_REJECTED',
    ],
  ])('blocks %s users from protected APIs', async (_, user, code) => {
    await expect(
      guard.canActivate(
        contextFor({
          method: 'GET',
          path: '/documents',
          user,
        }),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code }),
    });
  });

  it('allows incomplete Google users to submit profile completion', async () => {
    await expect(
      guard.canActivate(
        contextFor({
          method: 'POST',
          path: '/auth/complete-profile',
          user: {
            role: Role.OPERATOR,
            is_active: false,
            is_verified: true,
            approval_status: ApprovalStatus.PENDING,
            profile_completed: false,
          },
        }),
      ),
    ).resolves.toBe(true);
  });
});
