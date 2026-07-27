import { ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
  getOptionsToken,
  getStorageToken,
} from '@nestjs/throttler';
import { Inject } from '@nestjs/common';
import type { Request } from 'express';

/**
 * The global rate-limiting guard, registered as the last (third) `APP_GUARD`
 * in `app.module.ts` — deliberately *after* `JwtAuthGuard`/`RolesGuard`, not
 * before. `getTracker` below keys authenticated requests by user id rather
 * than IP so that many legitimate users sitting behind one corporate NAT/VPN
 * egress never share a single bucket; that only works once Passport's JWT
 * strategy (inside `JwtAuthGuard`) has actually populated `request.user`,
 * which is why this guard cannot run first even though "reject floods
 * before paying auth's cost" would otherwise argue for that ordering.
 *
 * `onModuleInit` filters this instance down to only the `'default'` named
 * throttler tier. This is required, not cosmetic: `ThrottlerModule` provides
 * one shared options object (with both the `'default'` and `'device'` tiers)
 * to every `ThrottlerGuard` instance in the app, global and local alike. Left
 * unfiltered, this global guard would also evaluate the `'device'` tier on
 * every request — including on `DeviceGatewayController`'s routes, where it
 * would run before the local `DeviceAuthGuard` populates `request.device`,
 * producing a broken tracker key. See `device-throttler.guard.ts` for the
 * mirror-image filter.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  constructor(
    @Inject(getOptionsToken()) options: ThrottlerModuleOptions,
    @Inject(getStorageToken()) storageService: ThrottlerStorage,
    reflector: Reflector,
  ) {
    super(options, storageService, reflector);
  }

  async onModuleInit(): Promise<void> {
    await super.onModuleInit();
    this.throttlers = this.throttlers.filter((throttler) => throttler.name !== 'device');
  }

  protected async getTracker(req: Request & { user?: { userId?: string } }): Promise<string> {
    const userId = req.user?.userId;
    if (userId) {
      return `user:${userId}`;
    }
    return `ip:${this.getClientIp(req)}`;
  }

  protected async throwThrottlingException(_context: ExecutionContext): Promise<void> {
    throw new HttpException(
      {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please slow down and try again shortly.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /**
   * Mirrors `AuthThrottleService.getClientIp` (`auth/auth-throttle.service.ts`)
   * exactly, for consistency between the two IP-scoped mechanisms: the first
   * `x-forwarded-for` entry when present, else Express's own `req.ip`, else
   * the raw socket address. Both are only as trustworthy as the app's
   * `TRUST_PROXY` configuration (`config/env.validation.ts`) — see that
   * file's `validateTrustProxy` doc comment.
   */
  private getClientIp(req: Request): string {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
      return forwardedFor.split(',')[0].trim();
    }

    return req.ip || req.socket?.remoteAddress || 'unknown';
  }
}
