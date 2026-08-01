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
  const rawPath = request.path || request.originalUrl || request.url || '/';

  try {
    const parsed = new URL(rawPath, 'http://internal.local');
    return parsed.pathname || '/';
  } catch {
    return rawPath.split('?')[0] || '/';
  }
}

export function buildRequestLogMessage(input: {
  method: string;
  pathname: string;
  status: number;
  requestId: string;
  durationMs?: number;
}): string {
  const duration = Number.isFinite(input.durationMs)
    ? ` durationMs=${input.durationMs}`
    : '';
  return `requestId=${input.requestId} method=${input.method} path=${input.pathname} status=${input.status}${duration}`;
}

function normalizeRequestId(value: unknown): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== 'string') {
    return null;
  }

  const trimmed = candidate.trim();
  return SAFE_REQUEST_ID_PATTERN.test(trimmed) ? trimmed : null;
}
