import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { DevicesService } from './devices.service';
import { DeviceType } from '../schemas/device.schema';

describe('DevicesService', () => {
  let deviceModel: {
    create: jest.Mock;
    find: jest.Mock;
    findById: jest.Mock;
    findByIdAndDelete: jest.Mock;
  };
  let machineModel: { exists: jest.Mock };
  let deviceAuthService: { generateApiKey: jest.Mock };
  let service: DevicesService;

  beforeEach(() => {
    deviceModel = {
      create: jest.fn(),
      find: jest.fn(),
      findById: jest.fn(),
      findByIdAndDelete: jest.fn(),
    };
    machineModel = {
      exists: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(true) }),
    };
    deviceAuthService = {
      generateApiKey: jest.fn().mockResolvedValue({
        rawKey: 'prefix.secret',
        keyPrefix: 'prefix',
        keyHash: 'hashed',
      }),
    };
    service = new DevicesService(
      deviceModel as never,
      machineModel as never,
      deviceAuthService as never,
    );
  });

  describe('register', () => {
    it('rejects registering a device against a nonexistent machine', async () => {
      machineModel.exists.mockReturnValue({
        exec: jest.fn().mockResolvedValue(false),
      });
      await expect(
        service.register({
          device_id: 'DEV-1',
          machine_id: new Types.ObjectId().toString(),
          device_type: DeviceType.SIMULATOR,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates the device with a hashed key and returns the raw key exactly once', async () => {
      const created = { device_id: 'DEV-1' };
      deviceModel.create.mockResolvedValue(created);

      const result = await service.register(
        {
          device_id: 'DEV-1',
          machine_id: new Types.ObjectId().toString(),
          device_type: DeviceType.OPENPLC,
        },
        'admin-1',
      );

      expect(result.device).toBe(created);
      expect(result.apiKey).toBe('prefix.secret');
      expect(deviceModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          api_key_hash: 'hashed',
          key_prefix: 'prefix',
          created_by: 'admin-1',
        }),
      );
    });

    it('raises a friendly conflict when device_id is already taken', async () => {
      deviceModel.create.mockRejectedValue(
        Object.assign(new Error('dup'), { code: 11000 }),
      );
      await expect(
        service.register({
          device_id: 'DEV-1',
          machine_id: new Types.ObjectId().toString(),
          device_type: DeviceType.SIMULATOR,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findOne', () => {
    it('rejects an invalid id', async () => {
      await expect(service.findOne('not-an-id')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException for a missing device', async () => {
      deviceModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });
      await expect(
        service.findOne(new Types.ObjectId().toString()),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('applies only the provided fields and saves', async () => {
      const save = jest.fn().mockResolvedValue(undefined);
      const existing = {
        label: 'old',
        is_active: true,
        heartbeat_interval_seconds: 30,
        save,
      };
      deviceModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(existing),
      });

      const result = await service.update(new Types.ObjectId().toString(), {
        is_active: false,
      });

      expect(result.is_active).toBe(false);
      expect(result.label).toBe('old');
      expect(save).toHaveBeenCalled();
    });
  });

  describe('rotateKey', () => {
    it('replaces the stored hash/prefix and returns a new raw key', async () => {
      const save = jest.fn().mockResolvedValue(undefined);
      const existing = {
        api_key_hash: 'old-hash',
        key_prefix: 'old-prefix',
        save,
      };
      deviceModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(existing),
      });
      deviceAuthService.generateApiKey.mockResolvedValue({
        rawKey: 'new-prefix.new-secret',
        keyPrefix: 'new-prefix',
        keyHash: 'new-hash',
      });

      const result = await service.rotateKey(new Types.ObjectId().toString());

      expect(result.apiKey).toBe('new-prefix.new-secret');
      expect(existing.api_key_hash).toBe('new-hash');
      expect(existing.key_prefix).toBe('new-prefix');
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when nothing was deleted', async () => {
      deviceModel.findByIdAndDelete.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });
      await expect(
        service.remove(new Types.ObjectId().toString()),
      ).rejects.toThrow(NotFoundException);
    });

    it('resolves silently when the device was deleted', async () => {
      deviceModel.findByIdAndDelete.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: 'x' }),
      });
      await expect(
        service.remove(new Types.ObjectId().toString()),
      ).resolves.toBeUndefined();
    });
  });
});
