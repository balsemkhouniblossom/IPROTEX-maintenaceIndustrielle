import { Types } from 'mongoose';
import { LiveStatusService } from './live-status.service';

describe('LiveStatusService', () => {
  let deviceModel: { findOne: jest.Mock; find: jest.Mock };
  let telemetryModel: { findOne: jest.Mock };
  let faultEventModel: { countDocuments: jest.Mock; aggregate: jest.Mock };
  let service: LiveStatusService;

  beforeEach(() => {
    deviceModel = { findOne: jest.fn(), find: jest.fn() };
    telemetryModel = { findOne: jest.fn() };
    faultEventModel = { countDocuments: jest.fn(), aggregate: jest.fn() };
    service = new LiveStatusService(
      deviceModel as never,
      telemetryModel as never,
      faultEventModel as never,
    );
  });

  describe('isOnline', () => {
    it('is offline when the device was never seen', () => {
      expect(
        service.isOnline({
          is_active: true,
          last_seen_at: undefined,
          heartbeat_interval_seconds: 30,
        }),
      ).toBe(false);
    });

    it('is offline when deactivated, even with a recent heartbeat', () => {
      expect(
        service.isOnline({
          is_active: false,
          last_seen_at: new Date(),
          heartbeat_interval_seconds: 30,
        }),
      ).toBe(false);
    });

    it('is online within 3x the heartbeat interval', () => {
      const lastSeenAt = new Date(Date.now() - 60_000); // 60s ago
      expect(
        service.isOnline({
          is_active: true,
          last_seen_at: lastSeenAt,
          heartbeat_interval_seconds: 30,
        }),
      ).toBe(true); // threshold is 90s
    });

    it('is offline beyond 3x the heartbeat interval', () => {
      const lastSeenAt = new Date(Date.now() - 100_000); // 100s ago
      expect(
        service.isOnline({
          is_active: true,
          last_seen_at: lastSeenAt,
          heartbeat_interval_seconds: 30,
        }),
      ).toBe(false); // threshold is 90s
    });
  });

  describe('getMachineLiveStatus', () => {
    it('reports hasDevice=false for a machine with no registered device', async () => {
      deviceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });
      const result = await service.getMachineLiveStatus('machine-1');
      expect(result).toEqual({
        machineId: 'machine-1',
        hasDevice: false,
        online: false,
        lastSeenAt: null,
        device: null,
        activeAlarmCount: 0,
        latestTelemetry: null,
      });
    });

    it('reports live status, active alarm count, and latest telemetry for a machine with a device', async () => {
      const lastSeenAt = new Date();
      deviceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          is_active: true,
          last_seen_at: lastSeenAt,
          heartbeat_interval_seconds: 30,
          device_id: 'DEV-1',
          device_type: 'simulator',
          label: 'Line 1 PLC',
        }),
      });
      faultEventModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(2),
      });
      telemetryModel.findOne.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            metrics: { temperature: 55 },
            recorded_at: lastSeenAt,
          }),
        }),
      });

      const result = await service.getMachineLiveStatus('machine-1');

      expect(result.hasDevice).toBe(true);
      expect(result.online).toBe(true);
      expect(result.activeAlarmCount).toBe(2);
      expect(result.latestTelemetry).toEqual({
        metrics: { temperature: 55 },
        recordedAt: lastSeenAt,
      });
      expect(faultEventModel.countDocuments).toHaveBeenCalledWith({
        machine_id: 'machine-1',
        resolved_at: { $exists: false },
      });
    });
  });

  describe('getMachinesLiveSummary', () => {
    it('returns an empty array when there are no devices in scope', async () => {
      deviceModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      });
      const result = await service.getMachinesLiveSummary(null);
      expect(result).toEqual([]);
    });

    it('scopes the device query to the given machine ids when not admin (non-null)', async () => {
      const machineIds = [new Types.ObjectId()];
      deviceModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      });
      await service.getMachinesLiveSummary(machineIds);
      expect(deviceModel.find).toHaveBeenCalledWith({
        machine_id: { $in: machineIds },
      });
    });

    it('does not scope the device query when machineIds is null (admin/unrestricted)', async () => {
      deviceModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      });
      await service.getMachinesLiveSummary(null);
      expect(deviceModel.find).toHaveBeenCalledWith({});
    });

    it('joins per-machine active alarm counts onto each device summary', async () => {
      const machineId = new Types.ObjectId();
      deviceModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          {
            machine_id: machineId,
            is_active: true,
            last_seen_at: new Date(),
            heartbeat_interval_seconds: 30,
            device_id: 'DEV-1',
            device_type: 'openplc',
          },
        ]),
      });
      faultEventModel.aggregate.mockResolvedValue([
        { _id: machineId, count: 3 },
      ]);

      const result = await service.getMachinesLiveSummary(null);

      expect(result).toHaveLength(1);
      expect(result[0].activeAlarmCount).toBe(3);
      expect(result[0].online).toBe(true);
    });
  });
});
