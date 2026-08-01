import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { TelemetryIngestionService } from './telemetry-ingestion.service';
import { DeviceConnectionStatus } from '../schemas/device.schema';
import { FaultEventSeverity } from '../schemas/fault-event.schema';

function device(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    device_id: 'DEV-1',
    machine_id: new Types.ObjectId(),
    last_known_status: DeviceConnectionStatus.UNKNOWN,
    ...overrides,
  };
}

describe('TelemetryIngestionService', () => {
  let deviceModel: { updateOne: jest.Mock };
  let telemetryModel: { create: jest.Mock };
  let faultEventModel: {
    create: jest.Mock;
    findById: jest.Mock;
    findOneAndUpdate: jest.Mock;
  };
  let notificationCenterService: { createIfNotExists: jest.Mock };
  let service: TelemetryIngestionService;

  beforeEach(() => {
    deviceModel = {
      updateOne: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) }),
    };
    telemetryModel = { create: jest.fn() };
    faultEventModel = {
      create: jest.fn(),
      findById: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    notificationCenterService = {
      createIfNotExists: jest.fn().mockResolvedValue(null),
    };

    service = new TelemetryIngestionService(
      deviceModel as never,
      telemetryModel as never,
      faultEventModel as never,
      notificationCenterService as never,
    );
  });

  describe('recordHeartbeat', () => {
    it('marks the device seen and online, reporting cameOnline when it was not already online', async () => {
      const dev = device({ last_known_status: DeviceConnectionStatus.OFFLINE });
      const result = await service.recordHeartbeat(dev as never);

      expect(result.cameOnline).toBe(true);
      expect(deviceModel.updateOne).toHaveBeenCalledWith(
        { _id: dev._id },
        {
          $set: {
            last_seen_at: expect.any(Date),
            last_known_status: DeviceConnectionStatus.ONLINE,
          },
        },
      );
    });

    it('reports cameOnline=false when the device was already online', async () => {
      const dev = device({ last_known_status: DeviceConnectionStatus.ONLINE });
      const result = await service.recordHeartbeat(dev as never);
      expect(result.cameOnline).toBe(false);
    });
  });

  describe('recordTelemetry', () => {
    it('rejects a payload with no metrics', async () => {
      const dev = device();
      await expect(
        service.recordTelemetry(dev as never, { metrics: undefined as never }),
      ).rejects.toThrow(BadRequestException);
    });

    it('persists a telemetry record scoped to the device and its machine', async () => {
      const dev = device();
      const created = { metrics: { temperature: 72 }, recorded_at: new Date() };
      telemetryModel.create.mockResolvedValue(created);

      const { record, cameOnline } = await service.recordTelemetry(
        dev as never,
        {
          metrics: { temperature: 72 },
        },
      );

      expect(record).toBe(created);
      expect(cameOnline).toBe(true);
      expect(telemetryModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          device_id: dev._id,
          machine_id: dev.machine_id,
          metrics: { temperature: 72 },
        }),
      );
    });
  });

  describe('recordFault', () => {
    it('rejects a payload with no code_panne', async () => {
      const dev = device();
      await expect(
        service.recordFault(dev as never, { codePanne: '' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('persists a fault event and does not notify for non-critical severity', async () => {
      const dev = device();
      const created = {
        _id: new Types.ObjectId(),
        code_panne: 'E-42',
        severity: FaultEventSeverity.WARNING,
      };
      faultEventModel.create.mockResolvedValue(created);

      await service.recordFault(dev as never, {
        codePanne: 'E-42',
        severity: FaultEventSeverity.WARNING,
      });

      expect(
        notificationCenterService.createIfNotExists,
      ).not.toHaveBeenCalled();
    });

    it('creates a deduped Admin notification for a critical fault', async () => {
      const dev = device();
      const created = {
        _id: new Types.ObjectId(),
        code_panne: 'E-99',
        severity: FaultEventSeverity.CRITICAL,
      };
      faultEventModel.create.mockResolvedValue(created);

      await service.recordFault(dev as never, {
        codePanne: 'E-99',
        severity: FaultEventSeverity.CRITICAL,
      });

      expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith(
        expect.objectContaining({ recipientRole: 'admin' }),
      );
    });
  });

  describe('resolveFault', () => {
    it('throws NotFoundException for a nonexistent fault', async () => {
      faultEventModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });
      await expect(service.resolveFault('id', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when already resolved', async () => {
      faultEventModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ resolved_at: new Date() }),
      });
      await expect(service.resolveFault('id', 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('resolves an active fault, setting resolved_at and resolved_by', async () => {
      faultEventModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ resolved_at: undefined }),
      });
      const resolved = { resolved_at: new Date(), resolved_by: 'user-1' };
      faultEventModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(resolved),
      });

      const result = await service.resolveFault('id', 'user-1');
      expect(result).toBe(resolved);
    });

    it('raises a conflict if the update races and matches nothing', async () => {
      faultEventModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ resolved_at: undefined }),
      });
      faultEventModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.resolveFault('id', 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
