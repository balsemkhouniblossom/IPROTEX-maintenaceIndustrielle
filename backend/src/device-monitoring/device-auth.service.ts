import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { Device, DeviceDocument } from '../schemas/device.schema';

const KEY_PREFIX_LENGTH = 10;
const KEY_SECRET_BYTES = 32;

export interface GeneratedDeviceKey {
  rawKey: string;
  keyPrefix: string;
  keyHash: string;
}

/**
 * The single source of truth for device-credential creation and
 * verification, shared by every ingestion transport (REST device-gateway,
 * MQTT bridge, WebSocket device channel) so a device is authenticated
 * identically no matter which transport it uses. Deliberately independent
 * of `AuthService`/`JwtStrategy` — a `Device` is not a `User` and this
 * service never touches the `User` collection or issues a JWT.
 */
@Injectable()
export class DeviceAuthService {
  constructor(
    @InjectModel(Device.name)
    private readonly deviceModel: Model<DeviceDocument>,
  ) {}

  async generateApiKey(): Promise<GeneratedDeviceKey> {
    const keyPrefix = crypto.randomBytes(KEY_PREFIX_LENGTH / 2).toString('hex');
    const secret = crypto.randomBytes(KEY_SECRET_BYTES).toString('hex');
    const rawKey = `${keyPrefix}.${secret}`;
    const keyHash = await bcrypt.hash(rawKey, 10);
    return { rawKey, keyPrefix, keyHash };
  }

  /**
   * Verifies a presented `(deviceId, rawKey)` pair and returns the active
   * Device on success. Every failure mode (unknown device, wrong key,
   * deactivated device) throws the same generic `UnauthorizedException` so
   * a caller learns nothing about which part was wrong.
   */
  async verifyCredentials(
    deviceId: string,
    rawKey: string,
  ): Promise<DeviceDocument> {
    if (!deviceId || !rawKey || !rawKey.includes('.')) {
      throw new UnauthorizedException('Invalid device credentials');
    }
    const keyPrefix = rawKey.split('.')[0];

    const device = await this.deviceModel
      .findOne({ device_id: deviceId, key_prefix: keyPrefix })
      .exec();
    if (!device || !device.is_active) {
      throw new UnauthorizedException('Invalid device credentials');
    }

    const matches = await bcrypt.compare(rawKey, device.api_key_hash);
    if (!matches) {
      throw new UnauthorizedException('Invalid device credentials');
    }

    return device;
  }

  /**
   * Re-fetches a device by its Mongo `_id` and re-checks `is_active` — used
   * by the WebSocket gateway on every `device:*` message rather than
   * trusting the snapshot captured at connection time, so deactivating a
   * device (revoking a compromised credential) takes effect immediately
   * against an already-open socket, not just against new connections.
   */
  async getDeviceOrThrow(deviceMongoId: string): Promise<DeviceDocument> {
    if (!Types.ObjectId.isValid(deviceMongoId)) {
      throw new UnauthorizedException('Invalid device credentials');
    }
    const device = await this.deviceModel.findById(deviceMongoId).exec();
    if (!device || !device.is_active) {
      throw new UnauthorizedException('Invalid device credentials');
    }
    return device;
  }
}
