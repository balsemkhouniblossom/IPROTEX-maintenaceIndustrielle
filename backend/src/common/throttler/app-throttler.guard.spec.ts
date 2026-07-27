import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import { AppThrottlerGuard } from './app-throttler.guard';

function contextFor(): ExecutionContext {
  return {
    getHandler: () => contextFor,
    getClass: () => AppThrottlerGuard,
  } as unknown as ExecutionContext;
}

describe('AppThrottlerGuard', () => {
  let guard: AppThrottlerGuard;
  const options: ThrottlerModuleOptions = {
    throttlers: [
      { name: 'default', ttl: 60000, limit: 120 },
      { name: 'device', ttl: 60000, limit: 120 },
    ],
  };
  const storageService = {} as ThrottlerStorage;
  const reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;

  beforeEach(async () => {
    guard = new AppThrottlerGuard(options, storageService, reflector);
    await guard.onModuleInit();
  });

  it('keeps only the default tier after onModuleInit, filtering out device', () => {
    const throttlers = (guard as unknown as { throttlers: Array<{ name: string }> }).throttlers;
    expect(throttlers.map((t) => t.name)).toEqual(['default']);
  });

  describe('getTracker', () => {
    const getTracker = (req: Record<string, unknown>) =>
      (guard as unknown as { getTracker: (req: Record<string, unknown>) => Promise<string> }).getTracker(
        req,
      );

    it('keys authenticated requests by user id', async () => {
      await expect(
        getTracker({ user: { userId: 'user-123' }, headers: {}, ip: '10.0.0.1' }),
      ).resolves.toBe('user:user-123');
    });

    it('falls back to the first x-forwarded-for entry when unauthenticated', async () => {
      await expect(
        getTracker({
          headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
          ip: '10.0.0.1',
        }),
      ).resolves.toBe('ip:203.0.113.5');
    });

    it('falls back to req.ip when no x-forwarded-for header is present', async () => {
      await expect(getTracker({ headers: {}, ip: '10.0.0.1' })).resolves.toBe('ip:10.0.0.1');
    });

    it('falls back to the socket remote address when req.ip is unavailable', async () => {
      await expect(
        getTracker({ headers: {}, ip: undefined, socket: { remoteAddress: '10.0.0.2' } }),
      ).resolves.toBe('ip:10.0.0.2');
    });

    it('falls back to "unknown" when no address information is available at all', async () => {
      await expect(getTracker({ headers: {}, ip: undefined, socket: {} })).resolves.toBe(
        'ip:unknown',
      );
    });
  });

  describe('throwThrottlingException', () => {
    it('throws a 429 HttpException with the RATE_LIMIT_EXCEEDED code', async () => {
      await expect(
        (guard as unknown as { throwThrottlingException: (context: ExecutionContext) => Promise<void> }).throwThrottlingException(
          contextFor(),
        ),
      ).rejects.toMatchObject({
        status: 429,
        response: expect.objectContaining({ code: 'RATE_LIMIT_EXCEEDED' }),
      });
    });
  });
});
