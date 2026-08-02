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
  let documentAccessService: { assertCanAccessMachine: jest.Mock };
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
    documentAccessService = {
      assertCanAccessMachine: jest.fn().mockResolvedValue(undefined),
    };

    service = new TelemetryIngestionService(
      deviceModel as never,
      telemetryModel as never,
      faultEventModel as never,
      notificationCenterService as never,
      documentAccessService as never,
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
    const faultId = new Types.ObjectId().toHexString();
    const userId = new Types.ObjectId().toHexString();
    const machineId = new Types.ObjectId();
    const actor = { userId, role: 'technician' };

    function mockFaultLookup(value: unknown) {
      const exec = jest.fn().mockResolvedValue(value);
      const select = jest.fn().mockReturnValue({ exec });
      faultEventModel.findById.mockReturnValue({ select });
      return { select, exec };
    }

    it('throws BadRequestException for a malformed fault id without touching storage', async () => {
      await expect(service.resolveFault('not-an-id', actor)).rejects.toThrow(
        BadRequestException,
      );
      expect(faultEventModel.findById).not.toHaveBeenCalled();
      expect(faultEventModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a nonexistent fault', async () => {
      mockFaultLookup(null);
      await expect(service.resolveFault(faultId, actor)).rejects.toThrow(
        NotFoundException,
      );
      expect(
        documentAccessService.assertCanAccessMachine,
      ).not.toHaveBeenCalled();
    });

    it('authorizes the fault machine before attempting the atomic update', async () => {
      mockFaultLookup({ machine_id: machineId });
      const resolved = {
        resolved_at: new Date(),
        resolved_by: new Types.ObjectId(userId),
      };
      faultEventModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(resolved),
      });

      await expect(service.resolveFault(faultId, actor)).resolves.toBe(
        resolved,
      );

      expect(documentAccessService.assertCanAccessMachine).toHaveBeenCalledWith(
        actor,
        machineId.toHexString(),
      );
      expect(faultEventModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: faultId, resolved_at: { $exists: false } },
        {
          $set: {
            resolved_at: expect.any(Date),
            resolved_by: new Types.ObjectId(userId),
          },
        },
        { new: true },
      );
    });

    it('does not update the fault when machine authorization fails', async () => {
      mockFaultLookup({ machine_id: machineId });
      documentAccessService.assertCanAccessMachine.mockRejectedValue(
        new Error('denied'),
      );

      await expect(service.resolveFault(faultId, actor)).rejects.toThrow(
        'denied',
      );
      expect(faultEventModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('persists an optional validated resolution note with server audit fields', async () => {
      mockFaultLookup({ machine_id: machineId });
      const resolved = {
        resolved_at: new Date(),
        resolved_by: new Types.ObjectId(userId),
        resolution_note: 'Cleared after inspection',
      };
      faultEventModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(resolved),
      });

      const result = await service.resolveFault(faultId, actor, {
        resolution_note: 'Cleared after inspection',
      });
      expect(result).toBe(resolved);
      expect(faultEventModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.any(Object),
        {
          $set: expect.objectContaining({
            resolved_at: expect.any(Date),
            resolved_by: new Types.ObjectId(userId),
            resolution_note: 'Cleared after inspection',
          }),
        },
        { new: true },
      );
    });

    it('raises a conflict if the update races and matches nothing', async () => {
      mockFaultLookup({ machine_id: machineId });
      faultEventModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.resolveFault(faultId, actor)).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
