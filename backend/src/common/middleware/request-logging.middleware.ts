import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Response } from 'express';
import {
  assignRequestId,
  buildRequestLogMessage,
  getRequestPathname,
  type RequestWithLogContext,
} from '../log-sanitizer';
import { MetricsRegistry } from '../metrics/metrics-registry';

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly metrics: MetricsRegistry) {}

  use(req: RequestWithLogContext, res: Response, next: NextFunction): void {
    if (req.url.startsWith('/.well-known')) {
      res.status(204).end();
      return;
    }
    const startedAt = Date.now();
    const requestId = assignRequestId(req, res);
    const pathname = getRequestPathname(req);

    res.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      this.metrics.record(req.method, pathname, res.statusCode, durationMs);
      const level =
        res.statusCode >= 500
          ? 'error'
          : res.statusCode >= 400
            ? 'warn'
            : 'log';
      const message = buildRequestLogMessage({
        requestId,
        method: req.method,
        pathname,
        status: res.statusCode,
        durationMs,
      });

      if (level === 'error') {
        this.logger.error(message);
      } else if (level === 'warn') {
        this.logger.warn(message);
      } else {
        this.logger.log(message);
      }
    });

    next();
  }
}
