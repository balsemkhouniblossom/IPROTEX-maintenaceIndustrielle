import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import type { Request } from 'express';

export type AuthThrottleEndpoint =
  | 'login'
  | 'register'
  | 'forgot-password'
  | 'verify-reset-token'
  | 'reset-password'
  | 'google-exchange'
  | 'email-diagnostic';

type ThrottleScope = 'ip' | 'account';

type ThrottleRule = {
  windowMs: number;
  limit: number;
  failureLimit?: number;
  lockoutMs?: number;
};

type ThrottleRecord = {
  hits: number[];
  failures: number[];
  lockedUntil?: number;
};

type AuthThrottleIdentity = {
  email?: string;
  token?: string;
  code?: string;
};

const AUTH_THROTTLE_RULES: Record<
  AuthThrottleEndpoint,
  Record<ThrottleScope, ThrottleRule>
> = {
  login: {
    ip: {
      windowMs: 15 * 60 * 1000,
      limit: 20,
      failureLimit: 10,
      lockoutMs: 15 * 60 * 1000,
    },
    account: {
      windowMs: 15 * 60 * 1000,
      limit: 10,
      failureLimit: 5,
      lockoutMs: 15 * 60 * 1000,
    },
  },
  register: {
    ip: { windowMs: 60 * 60 * 1000, limit: 10 },
    account: { windowMs: 60 * 60 * 1000, limit: 3 },
  },
  'forgot-password': {
    ip: { windowMs: 60 * 60 * 1000, limit: 10 },
    account: { windowMs: 60 * 60 * 1000, limit: 3 },
  },
  'verify-reset-token': {
    ip: {
      windowMs: 15 * 60 * 1000,
      limit: 30,
      failureLimit: 15,
      lockoutMs: 15 * 60 * 1000,
    },
    account: {
      windowMs: 15 * 60 * 1000,
      limit: 8,
      failureLimit: 5,
      lockoutMs: 15 * 60 * 1000,
    },
  },
  'reset-password': {
    ip: {
      windowMs: 15 * 60 * 1000,
      limit: 20,
      failureLimit: 10,
      lockoutMs: 15 * 60 * 1000,
    },
    account: {
      windowMs: 15 * 60 * 1000,
      limit: 8,
      failureLimit: 5,
      lockoutMs: 15 * 60 * 1000,
    },
  },
  'google-exchange': {
    ip: {
      windowMs: 15 * 60 * 1000,
      limit: 30,
      failureLimit: 15,
      lockoutMs: 15 * 60 * 1000,
    },
    account: {
      windowMs: 15 * 60 * 1000,
      limit: 8,
      failureLimit: 5,
      lockoutMs: 15 * 60 * 1000,
    },
  },
  'email-diagnostic': {
    ip: {
      windowMs: 15 * 60 * 1000,
      limit: 5,
      failureLimit: 5,
      lockoutMs: 15 * 60 * 1000,
    },
    account: {
      windowMs: 15 * 60 * 1000,
      limit: 3,
      failureLimit: 3,
      lockoutMs: 15 * 60 * 1000,
    },
  },
};

@Injectable()
export class AuthThrottleService {
  private readonly records = new Map<string, ThrottleRecord>();

  async consume(
    endpoint: AuthThrottleEndpoint,
    request: Request,
    identity: AuthThrottleIdentity = {},
  ): Promise<void> {
    const now = Date.now();
    for (const key of this.buildKeys(endpoint, request, identity)) {
      const rule = AUTH_THROTTLE_RULES[endpoint][key.scope];
      const record = this.getRecord(key.value, rule, now);

      if (record.lockedUntil && record.lockedUntil > now) {
        this.throwTooManyRequests(record.lockedUntil - now);
      }

      if (record.hits.length >= rule.limit) {
        const retryAfterMs = Math.max(
          rule.windowMs - (now - record.hits[0]),
          1000,
        );
        this.throwTooManyRequests(retryAfterMs);
      }

      record.hits.push(now);
    }
  }

  recordFailure(
    endpoint: AuthThrottleEndpoint,
    request: Request,
    identity: AuthThrottleIdentity = {},
  ): void {
    const now = Date.now();
    for (const key of this.buildKeys(endpoint, request, identity)) {
      const rule = AUTH_THROTTLE_RULES[endpoint][key.scope];
      const record = this.getRecord(key.value, rule, now);
      record.failures.push(now);

      if (rule.failureLimit && record.failures.length >= rule.failureLimit) {
        record.lockedUntil = now + (rule.lockoutMs ?? rule.windowMs);
      }
    }
  }

  recordSuccess(
    endpoint: AuthThrottleEndpoint,
    request: Request,
    identity: AuthThrottleIdentity = {},
  ): void {
    for (const key of this.buildKeys(endpoint, request, identity)) {
      const record = this.records.get(key.value);
      if (record) {
        record.failures = [];
        record.lockedUntil = undefined;
      }
    }
  }

  resetForTests(): void {
    this.records.clear();
  }

  private buildKeys(
    endpoint: AuthThrottleEndpoint,
    request: Request,
    identity: AuthThrottleIdentity,
  ): Array<{ value: string; scope: ThrottleScope }> {
    const ip = this.getClientIp(request);
    const keys: Array<{ value: string; scope: ThrottleScope }> = [
      { value: `${endpoint}:ip:${ip}`, scope: 'ip' },
    ];
    const accountKey = this.getAccountKey(identity);

    if (accountKey) {
      keys.push({
        value: `${endpoint}:account:${accountKey}`,
        scope: 'account',
      });
    }

    return keys;
  }

  private getClientIp(request: Request): string {
    const forwardedFor = request.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
      return forwardedFor.split(',')[0].trim();
    }

    return request.ip || request.socket.remoteAddress || 'unknown';
  }

  private getAccountKey(identity: AuthThrottleIdentity): string | null {
    if (identity.email?.trim()) {
      return `email:${identity.email.trim().toLowerCase()}`;
    }

    if (identity.token?.trim()) {
      return `token:${this.digest(identity.token.trim())}`;
    }

    if (identity.code?.trim()) {
      return `code:${this.digest(identity.code.trim())}`;
    }

    return null;
  }

  private getRecord(
    key: string,
    rule: ThrottleRule,
    now: number,
  ): ThrottleRecord {
    const record = this.records.get(key) ?? { hits: [], failures: [] };
    record.hits = record.hits.filter((hit) => now - hit < rule.windowMs);
    record.failures = record.failures.filter(
      (hit) => now - hit < rule.windowMs,
    );

    if (record.lockedUntil && record.lockedUntil <= now) {
      record.lockedUntil = undefined;
    }

    this.records.set(key, record);
    return record;
  }

  private digest(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  private throwTooManyRequests(retryAfterMs: number): never {
    throw new HttpException(
      {
        code: 'AUTH_TOO_MANY_ATTEMPTS',
        message: 'Too many authentication attempts. Please try again later.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
      {
        cause: { retryAfterSeconds: Math.ceil(retryAfterMs / 1000) },
      },
    );
  }
}
