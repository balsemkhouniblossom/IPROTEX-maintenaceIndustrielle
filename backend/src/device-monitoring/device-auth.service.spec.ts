import { UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DeviceAuthService } from './device-auth.service';

describe('DeviceAuthService', () => {
  let deviceModel: {
    findOne: jest.Mock;
    findById: jest.Mock;
  };
  let service: DeviceAuthService;

  beforeEach(() => {
    deviceModel = { findOne: jest.fn(), findById: jest.fn() };
    service = new DeviceAuthService(deviceModel as never);
  });

  describe('generateApiKey', () => {
    it('generates a raw key containing the prefix and a bcrypt hash of the full key', async () => {
      const generated = await service.generateApiKey();

      expect(generated.rawKey.startsWith(`${generated.keyPrefix}.`)).toBe(true);
      expect(generated.keyHash).not.toBe(generated.rawKey);
      expect(generated.keyHash.startsWith('$2')).toBe(true); // bcrypt hash marker
    });

    it('never generates the same key twice', async () => {
      const a = await service.generateApiKey();
      const b = await service.generateApiKey();
      expect(a.rawKey).not.toBe(b.rawKey);
    });
  });

  describe('verifyCredentials', () => {
    it('rejects a malformed key with no prefix separator', async () => {
      await expect(
        service.verifyCredentials('DEV-1', 'not-a-valid-key'),
      ).rejects.toThrow(UnauthorizedException);
      expect(deviceModel.findOne).not.toHaveBeenCalled();
    });

    it('rejects an unknown device id', async () => {
      deviceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });
      await expect(
        service.verifyCredentials('DEV-1', 'prefix123.secret'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a deactivated device even with the correct key', async () => {
      const generated = await service.generateApiKey();
      deviceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          is_active: false,
          api_key_hash: generated.keyHash,
        }),
      });
      await expect(
        service.verifyCredentials('DEV-1', generated.rawKey),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a wrong key for a real, active device', async () => {
      const generated = await service.generateApiKey();
      const otherGenerated = await service.generateApiKey();
      deviceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          is_active: true,
          api_key_hash: generated.keyHash,
        }),
      });
      await expect(
        service.verifyCredentials('DEV-1', otherGenerated.rawKey),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('accepts the correct key for a real, active device and returns it', async () => {
      const generated = await service.generateApiKey();
      const device = {
        is_active: true,
        api_key_hash: generated.keyHash,
        device_id: 'DEV-1',
      };
      deviceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(device),
      });

      const result = await service.verifyCredentials('DEV-1', generated.rawKey);
      expect(result).toBe(device);
      expect(deviceModel.findOne).toHaveBeenCalledWith({
        device_id: 'DEV-1',
        key_prefix: generated.keyPrefix,
      });
    });
  });

  describe('getDeviceOrThrow', () => {
    it('rejects an invalid Mongo id', async () => {
      await expect(service.getDeviceOrThrow('not-an-id')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a missing device', async () => {
      deviceModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });
      await expect(
        service.getDeviceOrThrow(new Types.ObjectId().toString()),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a deactivated device', async () => {
      deviceModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ is_active: false }),
      });
      await expect(
        service.getDeviceOrThrow(new Types.ObjectId().toString()),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('returns an active device', async () => {
      const device = { is_active: true };
      deviceModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(device),
      });
      const result = await service.getDeviceOrThrow(
        new Types.ObjectId().toString(),
      );
      expect(result).toBe(device);
    });
  });
});
