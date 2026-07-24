import { BadRequestException, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import {
  assignRequestId,
  buildRequestLogMessage,
  getRequestPathname,
  type RequestWithLogContext,
} from './log-sanitizer';
import { RequestLoggingMiddleware } from './middleware/request-logging.middleware';
import type { ArgumentsHost } from '@nestjs/common';
import type { Request, Response } from 'express';

describe('backend log sanitization', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('extracts only the request pathname from tokenized URLs', () => {
    const request = {
      originalUrl:
        '/auth/verify-email?token=verification-secret&code=oauth-secret',
      url: '/auth/verify-email?token=verification-secret&code=oauth-secret',
      path: '/auth/verify-email',
      headers: {
        authorization: 'Bearer access-secret',
        cookie: 'refresh_token=refresh-secret',
      },
    } as unknown as Request;

    const pathname = getRequestPathname(request);
    const message = buildRequestLogMessage({
      requestId: 'request-1',
      method: 'GET',
      pathname,
      status: 400,
    });

    expect(pathname).toBe('/auth/verify-email');
    expect(message).not.toContain('verification-secret');
    expect(message).not.toContain('oauth-secret');
    expect(message).not.toContain('access-secret');
    expect(message).not.toContain('refresh-secret');
    expect(message).not.toContain('?');
  });

  it('does not log verification tokens from request logging middleware', () => {
    const middleware = new RequestLoggingMiddleware();
    const response = createMockResponse(200);
    const request = {
      method: 'GET',
      originalUrl: '/auth/verify-email?token=verification-log-secret',
      url: '/auth/verify-email?token=verification-log-secret',
      headers: {
        authorization: 'Bearer authorization-secret',
        cookie: 'google_auth_state=cookie-secret',
        'x-request-id': 'req-verify-1',
      },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as RequestWithLogContext;

    middleware.use(request, response as unknown as Response, jest.fn());
    response.emit('finish');

    const renderedLogs = renderLoggerCalls(logSpy, warnSpy, errorSpy);
    expect(renderedLogs).toContain('path=/auth/verify-email');
    expect(renderedLogs).toContain('requestId=req-verify-1');
    expect(renderedLogs).not.toContain('verification-log-secret');
    expect(renderedLogs).not.toContain('authorization-secret');
    expect(renderedLogs).not.toContain('cookie-secret');
    expect(renderedLogs).not.toContain('?token=');
  });

  it('does not log or return reset tokens from the exception filter path', () => {
    const filter = new AllExceptionsFilter();
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const request = {
      method: 'GET',
      originalUrl: '/auth/verify-reset-token?token=reset-log-secret',
      url: '/auth/verify-reset-token?token=reset-log-secret',
      headers: {
        authorization: 'Bearer authorization-secret',
        cookie: 'refresh_token=refresh-secret',
        'x-request-id': 'req-reset-1',
      },
    } as unknown as RequestWithLogContext;
    assignRequestId(request);

    filter.catch(
      new BadRequestException('Invalid or expired reset token'),
      createArgumentsHost(request, { status } as unknown as Response),
    );

    const renderedLogs = renderLoggerCalls(logSpy, warnSpy, errorSpy);
    expect(renderedLogs).toContain('path=/auth/verify-reset-token');
    expect(renderedLogs).toContain('requestId=req-reset-1');
    expect(renderedLogs).not.toContain('reset-log-secret');
    expect(renderedLogs).not.toContain('authorization-secret');
    expect(renderedLogs).not.toContain('refresh-secret');
    expect(renderedLogs).not.toContain('?token=');
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/auth/verify-reset-token',
      }),
    );
  });
});

function createMockResponse(statusCode: number) {
  const response = new EventEmitter() as EventEmitter & {
    statusCode: number;
    setHeader: jest.Mock;
  };
  response.statusCode = statusCode;
  response.setHeader = jest.fn();
  return response;
}

function createArgumentsHost(
  request: Request,
  response: Response,
): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as ArgumentsHost;
}

function renderLoggerCalls(...spies: jest.SpyInstance[]): string {
  return spies
    .flatMap((spy) => spy.mock.calls)
    .map((call) => call.join(' '))
    .join('\n');
}
