import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
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

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = isHttpException
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
    this.logger.error(
      `${buildRequestLogMessage({
        requestId,
        method: request.method,
        pathname,
        status,
      })} message=${messageText}`,
      exception instanceof Error ? exception.stack : undefined,
    );

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
