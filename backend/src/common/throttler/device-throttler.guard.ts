import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
  getOptionsToken,
  getStorageToken,
} from '@nestjs/throttler';
import type { Request } from 'express';
import type { DeviceDocument } from '../../schemas/device.schema';

/**
 * Applied only locally, via `@UseGuards(DeviceAuthGuard, DeviceThrottlerGuard)`
 * on `DeviceGatewayController` — never registered as an `APP_GUARD`. Auth
 * guard runs first in that list, so `request.device` is guaranteed populated
 * by the time `getTracker` below reads it.
 *
 * `onModuleInit` filters this instance down to only the `'device'` named
 * throttler tier — the mirror image of `AppThrottlerGuard`'s filter, and for
 * the same reason: `ThrottlerModule` hands one shared options object (both
 * the `'default'` and `'device'` tiers) to every guard instance. Without
 * this filter, this guard would also evaluate the `'default'` tier here,
 * double-counting device-gateway traffic against a tier meant for
 * user/IP-keyed browser traffic.
 */
@Injectable()
export class DeviceThrottlerGuard extends ThrottlerGuard {
  constructor(
    @Inject(getOptionsToken()) options: ThrottlerModuleOptions,
    @Inject(getStorageToken()) storageService: ThrottlerStorage,
    reflector: Reflector,
  ) {
    super(options, storageService, reflector);
  }

  async onModuleInit(): Promise<void> {
    await super.onModuleInit();
    this.throttlers = this.throttlers.filter(
      (throttler) => throttler.name === 'device',
    );
  }

  protected async getTracker(
    req: Request & { device?: DeviceDocument },
  ): Promise<string> {
    return `device:${req.device?.device_id ?? 'unknown'}`;
  }

  protected async throwThrottlingException(
    _context: ExecutionContext,
  ): Promise<void> {
    throw new HttpException(
      {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please slow down and try again shortly.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
