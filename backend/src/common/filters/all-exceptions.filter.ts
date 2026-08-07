import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { MulterError } from 'multer';
import * as Sentry from '@sentry/nestjs';
import {
  buildRequestLogMessage,
  getRequestId,
  getRequestPathname,
  type RequestWithLogContext,
} from '../log-sanitizer';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithLogContext>();

    // Multer rejects an oversized upload mid-stream once its configured
    // `limits.fileSize` is exceeded, before any of our own handlers ever
    // run — that MulterError would otherwise fall through to the generic
    // 500 branch below instead of the 413 a caller streaming too large a
    // file should see.
    const isMulterFileSizeError =
      exception instanceof MulterError && exception.code === 'LIMIT_FILE_SIZE';
    const isHttpException = exception instanceof HttpException;
    const status: HttpStatus = isMulterFileSizeError
      ? HttpStatus.PAYLOAD_TOO_LARGE
      : isHttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = isMulterFileSizeError
      ? 'Uploaded file exceeds the maximum allowed size'
      : isHttpException
        ? exception.getResponse()
        : 'Internal server error';
    const exceptionCode =
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null &&
      typeof (exceptionResponse as { code?: unknown }).code === 'string'
        ? (exceptionResponse as { code: string }).code
        : undefined;

    const message =
      typeof exceptionResponse === 'string'
        ? exceptionResponse
        : ((exceptionResponse as { message?: unknown })?.message ??
          'Internal server error');

    const messageText = Array.isArray(message)
      ? message.join(', ')
      : typeof message === 'string'
        ? message
        : JSON.stringify(message);

    const requestId = getRequestId(request);
    const pathname = getRequestPathname(request);
    const logMessage = buildRequestLogMessage({
      requestId,
      method: request.method,
      pathname,
      status,
      message: messageText,
    });

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        logMessage,
        exception instanceof Error ? exception.stack : undefined,
      );
      // A safe no-op when SENTRY_DSN is unset (see instrument.ts) — only
      // unexpected 5xx failures are worth an error-tracking event; the
      // 4xx branch below is expected-shape client error handling, not a
      // bug to alert on.
      Sentry.captureException(exception, {
        tags: { requestId },
        contexts: {
          request: { method: request.method, path: pathname, status },
        },
      });
    } else {
      this.logger.warn(logMessage);
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: pathname,
      method: request.method,
      message,
      ...(exceptionCode ? { code: exceptionCode } : {}),
    });
  }
}
