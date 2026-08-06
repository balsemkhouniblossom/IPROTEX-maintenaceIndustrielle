import { ExecutionContext, RequestTimeoutException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of, throwError, timer } from 'rxjs';
import { delay, mergeMap } from 'rxjs/operators';
import { TimeoutInterceptor } from './timeout.interceptor';

function mockContext(): ExecutionContext {
  return {
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
}

describe('TimeoutInterceptor', () => {
  it('lets a fast response through unchanged', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector;
    const interceptor = new TimeoutInterceptor(reflector, 50);
    const next = { handle: () => of('ok') };

    const result = await interceptor.intercept(mockContext(), next).toPromise();

    expect(result).toBe('ok');
  });

  it('converts a hung handler into a RequestTimeoutException once the limit elapses', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector;
    const interceptor = new TimeoutInterceptor(reflector, 20);
    const next = {
      handle: () => timer(5000).pipe(mergeMap(() => of('too late'))),
    };

    await expect(
      interceptor.intercept(mockContext(), next).toPromise(),
    ).rejects.toBeInstanceOf(RequestTimeoutException);
  });

  it('skips the timeout entirely for a route marked @SkipTimeout', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(true),
    } as unknown as Reflector;
    const interceptor = new TimeoutInterceptor(reflector, 20);
    const next = {
      handle: () => of('slow but exempt').pipe(delay(50)),
    };

    const result = await interceptor.intercept(mockContext(), next).toPromise();

    expect(result).toBe('slow but exempt');
  });

  it('passes through a non-timeout error unchanged', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector;
    const interceptor = new TimeoutInterceptor(reflector, 50);
    const boom = new Error('downstream failure');
    const next = { handle: () => throwError(() => boom) };

    await expect(
      interceptor.intercept(mockContext(), next).toPromise(),
    ).rejects.toBe(boom);
  });
});
