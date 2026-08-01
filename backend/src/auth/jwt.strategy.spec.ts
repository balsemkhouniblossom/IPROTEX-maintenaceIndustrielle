import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

function execResult<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

describe('JwtStrategy.validate', () => {
  const userId = 'user-1';
  let userModel: { findById: jest.Mock };
  let strategy: JwtStrategy;

  function selectChain<T>(value: T) {
    return { select: jest.fn().mockReturnValue(execResult(value)) };
  }

  beforeEach(() => {
    const configService = {
      get: jest.fn().mockReturnValue('test-jwt-secret'),
    } as unknown as ConfigService;
    userModel = { findById: jest.fn() };
    strategy = new JwtStrategy(configService, userModel as never);
  });

  it('rejects when the authenticated user no longer exists', async () => {
    userModel.findById.mockReturnValue(selectChain(null));

    try {
      await strategy.validate({
        sub: userId,
        email: 'a@test.com',
        role: 'operator',
        user_id: 'U-1',
      });
      throw new Error('Expected validate() to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).getResponse()).toEqual(
        expect.objectContaining({ code: 'AUTHENTICATED_USER_NOT_FOUND' }),
      );
    }
  });

  it('accepts a token issued after the last credentials_invalidated_at, and forwards must_reset_password', async () => {
    const invalidatedAt = new Date('2026-01-01T00:00:00.000Z');
    userModel.findById.mockReturnValue(
      selectChain({
        email: 'a@test.com',
        role: 'operator',
        user_id: 'U-1',
        is_active: true,
        is_verified: true,
        approval_status: 'approved',
        profile_completed: true,
        must_reset_password: true,
        credentials_invalidated_at: invalidatedAt,
      }),
    );

    const issuedAfter = Math.floor(invalidatedAt.getTime() / 1000) + 10;
    const result = await strategy.validate({
      sub: userId,
      email: 'a@test.com',
      role: 'operator',
      user_id: 'U-1',
      iat: issuedAfter,
    });

    expect(result).toMatchObject({ userId, must_reset_password: true });
  });

  it('rejects a token issued before credentials_invalidated_at, even though the token itself has not expired', async () => {
    const invalidatedAt = new Date('2026-01-01T00:00:00.000Z');
    userModel.findById.mockReturnValue(
      selectChain({
        email: 'a@test.com',
        role: 'operator',
        user_id: 'U-1',
        is_active: true,
        is_verified: true,
        approval_status: 'approved',
        profile_completed: true,
        credentials_invalidated_at: invalidatedAt,
      }),
    );

    const issuedBefore = Math.floor(invalidatedAt.getTime() / 1000) - 10;

    await expect(
      strategy.validate({
        sub: userId,
        email: 'a@test.com',
        role: 'operator',
        user_id: 'U-1',
        iat: issuedBefore,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    try {
      await strategy.validate({
        sub: userId,
        email: 'a@test.com',
        role: 'operator',
        user_id: 'U-1',
        iat: issuedBefore,
      });
    } catch (error) {
      expect((error as UnauthorizedException).getResponse()).toEqual(
        expect.objectContaining({ code: 'SESSION_REVOKED' }),
      );
    }
  });

  it('does not reject anything when credentials_invalidated_at was never set', async () => {
    userModel.findById.mockReturnValue(
      selectChain({
        email: 'a@test.com',
        role: 'operator',
        user_id: 'U-1',
        is_active: true,
        is_verified: true,
        approval_status: 'approved',
        profile_completed: true,
      }),
    );

    await expect(
      strategy.validate({
        sub: userId,
        email: 'a@test.com',
        role: 'operator',
        user_id: 'U-1',
        iat: 1,
      }),
    ).resolves.toMatchObject({ userId, must_reset_password: false });
  });
});
