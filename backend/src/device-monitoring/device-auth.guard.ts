import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { DeviceAuthService } from './device-auth.service';
import type { DeviceDocument } from '../schemas/device.schema';

export type DeviceAuthenticatedRequest = Request & {
  device?: DeviceDocument;
};

/**
 * Guards the device-facing REST ingestion surface only. Implements
 * `CanActivate` directly (like `RolesGuard`), never delegating to Passport's
 * `jwt` strategy — a device presents `x-device-id`/`x-device-key` headers,
 * never an `Authorization: Bearer` JWT, so this guard and `JwtAuthGuard`
 * are structurally disjoint: no credential accepted by one is ever
 * accepted by the other.
 */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(private readonly deviceAuthService: DeviceAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<DeviceAuthenticatedRequest>();
    const deviceId = request.headers['x-device-id'];
    const deviceKey = request.headers['x-device-key'];

    if (typeof deviceId !== 'string' || typeof deviceKey !== 'string') {
      throw new UnauthorizedException('Missing device credentials');
    }

    request.device = await this.deviceAuthService.verifyCredentials(
      deviceId,
      deviceKey,
    );
    return true;
  }
}
