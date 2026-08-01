import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import { DeviceThrottlerGuard } from './device-throttler.guard';

function contextFor(): ExecutionContext {
  return {
    getHandler: () => contextFor,
    getClass: () => DeviceThrottlerGuard,
  } as unknown as ExecutionContext;
}

describe('DeviceThrottlerGuard', () => {
  let guard: DeviceThrottlerGuard;
  const options: ThrottlerModuleOptions = {
    throttlers: [
      { name: 'default', ttl: 60000, limit: 120 },
      { name: 'device', ttl: 60000, limit: 120 },
    ],
  };
  const storageService = {} as ThrottlerStorage;
  const reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;

  beforeEach(async () => {
    guard = new DeviceThrottlerGuard(options, storageService, reflector);
    await guard.onModuleInit();
  });

  it('keeps only the device tier after onModuleInit, filtering out default', () => {
    const throttlers = (
      guard as unknown as { throttlers: Array<{ name: string }> }
    ).throttlers;
    expect(throttlers.map((t) => t.name)).toEqual(['device']);
  });

  describe('getTracker', () => {
    const getTracker = (req: Record<string, unknown>) =>
      (
        guard as unknown as {
          getTracker: (req: Record<string, unknown>) => Promise<string>;
        }
      ).getTracker(req);

    it('keys requests by the authenticated device id', async () => {
      await expect(
        getTracker({ device: { device_id: 'device-abc' } }),
      ).resolves.toBe('device:device-abc');
    });

    it('falls back to "unknown" when no device is present on the request', async () => {
      await expect(getTracker({})).resolves.toBe('device:unknown');
    });
  });

  describe('throwThrottlingException', () => {
    it('throws a 429 HttpException with the RATE_LIMIT_EXCEEDED code', async () => {
      await expect(
        (
          guard as unknown as {
            throwThrottlingException: (
              context: ExecutionContext,
            ) => Promise<void>;
          }
        ).throwThrottlingException(contextFor()),
      ).rejects.toMatchObject({
        status: 429,
        response: expect.objectContaining({ code: 'RATE_LIMIT_EXCEEDED' }),
      });
    });
  });
});
