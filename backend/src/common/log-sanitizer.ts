import * as crypto from 'crypto';
import type { Request, Response } from 'express';

export type RequestWithLogContext = Request & {
  requestId?: string;
};

const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,100}$/;

export function assignRequestId(
  request: RequestWithLogContext,
  response?: Response,
): string {
  const existing = normalizeRequestId(request.headers['x-request-id']);
  const requestId = existing || crypto.randomUUID();
  request.requestId = requestId;
  response?.setHeader?.('x-request-id', requestId);
  return requestId;
}

export function getRequestId(request: RequestWithLogContext): string {
  return (
    request.requestId ||
    normalizeRequestId(request.headers['x-request-id']) ||
    crypto.randomUUID()
  );
}

export function getRequestPathname(request: Request): string {
  // `originalUrl` first, deliberately: NestJS's `consumer.apply(...)
  // .forRoutes('*')` mounts global middleware by passing the literal
  // string `'*'` to Express as a path argument, which makes Express treat
  // it as a mount point and rewrite `req.url`/`req.path` to `/` for
  // everything inside — `req.originalUrl` is the only one of the three
  // that still holds the real incoming path at this point. Confirmed via
  // a live e2e request, not assumed: every request-logging/metrics call
  // site fed the same wrong `/` into request logs and the metrics
  // registry until this was reordered.
  const rawPath = request.originalUrl || request.path || request.url || '/';

  try {
    const parsed = new URL(rawPath, 'http://internal.local');
    return parsed.pathname || '/';
  } catch {
    return rawPath.split('?')[0] || '/';
  }
}

/**
 * `LOG_FORMAT=json` switches every request/error log line emitted through
 * this function to a single-line JSON object instead of the pipe-style
 * text below — read directly from `process.env` (not threaded through
 * `env.validation.ts`) the same way `BUSINESS_TIMEZONE` is, since this is
 * a log-formatting preference re-read at each call, not a startup
 * precondition. Text stays the default so local dev output is unaffected;
 * production log aggregators (Render's log stream, or anything shipping
 * to a JSON-log-based backend later) opt in via the env var.
 */
function isJsonLogFormat(): boolean {
  return (process.env.LOG_FORMAT ?? '').trim().toLowerCase() === 'json';
}

export function buildRequestLogMessage(input: {
  method: string;
  pathname: string;
  status: number;
  requestId: string;
  durationMs?: number;
  message?: string;
}): string {
  if (isJsonLogFormat()) {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      requestId: input.requestId,
      method: input.method,
      path: input.pathname,
      status: input.status,
      ...(Number.isFinite(input.durationMs)
        ? { durationMs: input.durationMs }
        : {}),
      ...(input.message ? { message: input.message } : {}),
    });
  }

  const duration = Number.isFinite(input.durationMs)
    ? ` durationMs=${input.durationMs}`
    : '';
  const message = input.message ? ` message=${input.message}` : '';
  return `requestId=${input.requestId} method=${input.method} path=${input.pathname} status=${input.status}${duration}${message}`;
}

function normalizeRequestId(value: unknown): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== 'string') {
    return null;
  }

  const trimmed = candidate.trim();
  return SAFE_REQUEST_ID_PATTERN.test(trimmed) ? trimmed : null;
}
