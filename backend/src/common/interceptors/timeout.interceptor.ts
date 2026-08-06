import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  RequestTimeoutException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, TimeoutError, throwError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';
import { SKIP_TIMEOUT_KEY } from '../decorators/skip-timeout.decorator';

/**
 * Defense-in-depth backstop, not a replacement for the timeout-bounded
 * calls individual services already make to slow external dependencies
 * (`AiAssistantService`, `EmailService`) — this exists for the request
 * paths that don't have one, so a hung downstream dependency can't hold a
 * connection (and its resources) open indefinitely.
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly timeoutMs: number,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TIMEOUT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return next.handle();
    }

    return next.handle().pipe(
      timeout(this.timeoutMs),
      catchError((error: unknown) => {
        if (error instanceof TimeoutError) {
          return throwError(() => new RequestTimeoutException());
        }
        return throwError(() => error);
      }),
    );
  }
}
