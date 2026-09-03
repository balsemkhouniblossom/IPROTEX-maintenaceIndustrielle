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

type MetricsRequestScenario = Record<string, unknown> & {
  clearConfiguredToken?: boolean;
};

const approvedUser = {
  role: Role.OPERATOR,
  is_active: true,
  is_verified: true,
  approval_status: ApprovalStatus.APPROVED,
  profile_completed: true,
};

describe('JwtAuthGuard account state enforcement', () => {
  let passportCanActivate: jest.SpyInstance;
  let guard: JwtAuthGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let previousMetricsToken: string | undefined;

  beforeEach(() => {
    previousMetricsToken = process.env.METRICS_BEARER_TOKEN;
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
    if (previousMetricsToken === undefined) {
      delete process.env.METRICS_BEARER_TOKEN;
    } else {
      process.env.METRICS_BEARER_TOKEN = previousMetricsToken;
    }
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

  it('allows Prometheus metrics scrapes with the dedicated bearer token', async () => {
    process.env.METRICS_BEARER_TOKEN = 'strong-test-metrics-token';
    const request = {
      method: 'GET',
      path: '/health/metrics',
      headers: {
        authorization: 'Bearer strong-test-metrics-token',
      },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(passportCanActivate).not.toHaveBeenCalled();
    expect(request).toMatchObject({
      user: {
        role: Role.ADMIN,
        is_active: true,
        is_verified: true,
        approval_status: ApprovalStatus.APPROVED,
        profile_completed: true,
        must_reset_password: false,
      },
    });
  });

  it.each<[string, MetricsRequestScenario]>([
    [
      'non-GET metrics requests',
      {
        method: 'POST',
        path: '/health/metrics',
        headers: { authorization: 'Bearer strong-test-metrics-token' },
        user: approvedUser,
      },
    ],
    [
      'non-metrics paths',
      {
        method: 'GET',
        path: '/health',
        headers: { authorization: 'Bearer strong-test-metrics-token' },
        user: approvedUser,
      },
    ],
    [
      'missing configured tokens',
      {
        method: 'GET',
        path: '/health/metrics',
        headers: { authorization: 'Bearer strong-test-metrics-token' },
        user: approvedUser,
        clearConfiguredToken: true,
      },
    ],
    [
      'missing bearer headers',
      {
        method: 'GET',
        path: '/health/metrics',
        headers: {},
        user: approvedUser,
      },
    ],
    [
      'mismatched bearer tokens',
      {
        method: 'GET',
        path: '/health/metrics',
        headers: { authorization: 'Bearer different-token' },
        user: approvedUser,
      },
    ],
  ])('uses normal JWT validation for %s', async (_, request) => {
    process.env.METRICS_BEARER_TOKEN = 'strong-test-metrics-token';
    if (request.clearConfiguredToken) {
      delete process.env.METRICS_BEARER_TOKEN;
    }

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(passportCanActivate).toHaveBeenCalledTimes(1);
  });

  it('rejects metrics scrapes with a same-length but incorrect bearer token', async () => {
    process.env.METRICS_BEARER_TOKEN = 'abcdefghij';
    const request = {
      method: 'GET',
      path: '/health/metrics',
      headers: { authorization: 'Bearer jihgfedcba' },
      user: approvedUser,
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(passportCanActivate).toHaveBeenCalledTimes(1);
  });

  it('falls back to originalUrl when path is not set on the request', async () => {
    process.env.METRICS_BEARER_TOKEN = 'strong-test-metrics-token';
    const request = {
      method: 'GET',
      originalUrl: '/health/metrics?foo=bar',
      headers: { authorization: 'Bearer strong-test-metrics-token' },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(passportCanActivate).not.toHaveBeenCalled();
  });

  it('allows logout requests for users with an incomplete profile', async () => {
    await expect(
      guard.canActivate(
        contextFor({
          method: 'POST',
          path: '/auth/logout',
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
