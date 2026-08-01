import { HttpException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthThrottleService } from './auth-throttle.service';

function createRequest(ip: string): Request {
  return {
    ip,
    socket: { remoteAddress: ip },
    headers: {},
  } as unknown as Request;
}

describe('AuthThrottleService', () => {
  let service: AuthThrottleService;

  beforeEach(() => {
    service = new AuthThrottleService();
  });

  it('locks a normalized login account after repeated failures', async () => {
    const request = createRequest('203.0.113.10');

    for (let i = 0; i < 5; i += 1) {
      await service.consume('login', request, { email: ' User@Example.COM ' });
      service.recordFailure('login', request, { email: 'user@example.com' });
    }

    await expect(
      service.consume('login', request, { email: 'user@example.com' }),
    ).rejects.toMatchObject({
      status: 429,
      response: expect.objectContaining({
        code: 'AUTH_TOO_MANY_ATTEMPTS',
      }),
    });
  });

  it('uses the forwarded IP address for IP throttling', async () => {
    const request = {
      ...createRequest('10.0.0.1'),
      headers: { 'x-forwarded-for': '198.51.100.44, 10.0.0.1' },
    } as unknown as Request;

    for (let i = 0; i < 10; i += 1) {
      await service.consume('forgot-password', request, {
        email: `user-${i}@example.com`,
      });
    }

    await expect(
      service.consume('forgot-password', request, {
        email: 'another@example.com',
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('clears failure lockouts after a successful account attempt', async () => {
    const request = createRequest('203.0.113.20');

    for (let i = 0; i < 4; i += 1) {
      await service.consume('login', request, { email: 'user@example.com' });
      service.recordFailure('login', request, { email: 'user@example.com' });
    }

    service.recordSuccess('login', request, { email: 'user@example.com' });

    await expect(
      service.consume('login', request, { email: 'user@example.com' }),
    ).resolves.toBeUndefined();
  });

  it('hashes reset tokens and Google exchange codes before keying account buckets', async () => {
    const request = createRequest('203.0.113.30');

    for (let i = 0; i < 5; i += 1) {
      await service.consume('google-exchange', request, {
        code: 'secret-code',
      });
      service.recordFailure('google-exchange', request, {
        code: 'secret-code',
      });
    }

    await expect(
      service.consume('google-exchange', request, { code: 'secret-code' }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: 'Too many authentication attempts. Please try again later.',
      }),
    });
  });
});
