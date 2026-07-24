import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../schemas/user.schema';
import { RolesGuard } from './roles.guard';

function contextFor(role?: Role): ExecutionContext {
  return {
    getHandler: () => contextFor,
    getClass: () => RolesGuard,
    switchToHttp: () => ({
      getRequest: () => ({
        user: role ? { role } : undefined,
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    };
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it('allows explicitly public routes', () => {
    reflector.getAllAndOverride.mockReturnValueOnce(true);

    expect(guard.canActivate(contextFor())).toBe(true);
  });

  it('allows shared authenticated routes without role metadata', () => {
    reflector.getAllAndOverride
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(undefined);

    expect(guard.canActivate(contextFor(Role.OPERATOR))).toBe(true);
  });

  it('allows users with a declared role', () => {
    reflector.getAllAndOverride
      .mockReturnValueOnce(false)
      .mockReturnValueOnce([Role.ADMIN]);

    expect(guard.canActivate(contextFor(Role.ADMIN))).toBe(true);
  });

  it('rejects users without a declared role', () => {
    reflector.getAllAndOverride
      .mockReturnValueOnce(false)
      .mockReturnValueOnce([Role.ADMIN]);

    expect(() => guard.canActivate(contextFor(Role.OPERATOR))).toThrow(
      'Your role is not allowed to access this resource.',
    );
  });
});
