import { UnauthorizedException } from '@nestjs/common';
import { LocalStrategy } from './local.strategy';

describe('LocalStrategy', () => {
  const request = { ip: '127.0.0.1' } as never;
  let authService: { validateUser: jest.Mock };
  let throttle: {
    consume: jest.Mock;
    recordSuccess: jest.Mock;
    recordFailure: jest.Mock;
  };
  let strategy: LocalStrategy;

  beforeEach(() => {
    authService = {
      validateUser: jest.fn(),
    };
    throttle = {
      consume: jest.fn().mockResolvedValue(undefined),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
    };
    strategy = new LocalStrategy(authService as never, throttle as never);
  });

  it('consumes a login attempt, returns the validated user, and records success', async () => {
    const user = { _id: 'user-id', email: 'admin@example.test' };
    authService.validateUser.mockResolvedValue(user);

    await expect(
      strategy.validate(request, 'admin@example.test', 'correct-password'),
    ).resolves.toBe(user);

    expect(throttle.consume).toHaveBeenCalledWith('login', request, {
      email: 'admin@example.test',
    });
    expect(authService.validateUser).toHaveBeenCalledWith(
      'admin@example.test',
      'correct-password',
    );
    expect(throttle.recordSuccess).toHaveBeenCalledWith('login', request, {
      email: 'admin@example.test',
    });
    expect(throttle.recordFailure).not.toHaveBeenCalled();
  });

  it('records a failure and throws UnauthorizedException when credentials are invalid', async () => {
    authService.validateUser.mockResolvedValue(null);

    await expect(
      strategy.validate(request, 'admin@example.test', 'wrong-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(throttle.recordFailure).toHaveBeenCalledWith('login', request, {
      email: 'admin@example.test',
    });
    expect(throttle.recordSuccess).not.toHaveBeenCalled();
  });

  it('records a failure when validation throws', async () => {
    const error = new Error('database unavailable');
    authService.validateUser.mockRejectedValue(error);

    await expect(
      strategy.validate(request, 'admin@example.test', 'password'),
    ).rejects.toBe(error);

    expect(throttle.recordFailure).toHaveBeenCalledWith('login', request, {
      email: 'admin@example.test',
    });
  });
});
