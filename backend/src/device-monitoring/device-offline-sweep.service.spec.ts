import { Types } from 'mongoose';
import { DeviceOfflineSweepService } from './device-offline-sweep.service';
import { DeviceConnectionStatus } from '../schemas/device.schema';

describe('DeviceOfflineSweepService', () => {
  let deviceModel: { find: jest.Mock; findOneAndUpdate: jest.Mock };
  let liveStatusService: { isOnline: jest.Mock };
  let liveMonitoringGateway: { emitStatusChange: jest.Mock };
  let notificationCenterService: { createIfNotExists: jest.Mock };
  let service: DeviceOfflineSweepService;

  beforeEach(() => {
    deviceModel = { find: jest.fn(), findOneAndUpdate: jest.fn() };
    liveStatusService = { isOnline: jest.fn() };
    liveMonitoringGateway = { emitStatusChange: jest.fn() };
    notificationCenterService = {
      createIfNotExists: jest.fn().mockResolvedValue(null),
    };

    service = new DeviceOfflineSweepService(
      deviceModel as never,
      liveStatusService as never,
      liveMonitoringGateway as never,
      notificationCenterService as never,
    );
  });

  it('only scans active devices not already known offline', async () => {
    deviceModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
    await service.runSweep();
    expect(deviceModel.find).toHaveBeenCalledWith({
      is_active: true,
      last_known_status: { $ne: DeviceConnectionStatus.OFFLINE },
    });
  });

  it('leaves a device untouched when it is still computed as online', async () => {
    const dev = {
      _id: new Types.ObjectId(),
      device_id: 'DEV-1',
      last_known_status: 'online',
    };
    deviceModel.find.mockReturnValue({
      exec: jest.fn().mockResolvedValue([dev]),
    });
    liveStatusService.isOnline.mockReturnValue(true);

    const result = await service.runSweep();

    expect(deviceModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(liveMonitoringGateway.emitStatusChange).not.toHaveBeenCalled();
    expect(result).toEqual({ processed: 0, details: { scanned: 1 } });
  });

  it('flips a stale device to offline exactly once, pushes a WS event, and notifies Admin', async () => {
    const machineId = new Types.ObjectId();
    const dev = {
      _id: new Types.ObjectId(),
      device_id: 'DEV-1',
      machine_id: machineId,
      last_seen_at: new Date(),
      last_known_status: 'online',
    };
    deviceModel.find.mockReturnValue({
      exec: jest.fn().mockResolvedValue([dev]),
    });
    liveStatusService.isOnline.mockReturnValue(false);
    deviceModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        ...dev,
        last_known_status: DeviceConnectionStatus.OFFLINE,
      }),
    });

    const result = await service.runSweep();

    expect(result.processed).toBe(1);
    expect(liveMonitoringGateway.emitStatusChange).toHaveBeenCalledWith(
      machineId.toString(),
      expect.objectContaining({
        deviceId: 'DEV-1',
        status: DeviceConnectionStatus.OFFLINE,
      }),
    );
    expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({ recipientRole: 'admin' }),
    );
  });

  it('does not double-count or double-notify when the guarded update loses a race', async () => {
    const dev = {
      _id: new Types.ObjectId(),
      device_id: 'DEV-1',
      machine_id: new Types.ObjectId(),
      last_known_status: 'online',
    };
    deviceModel.find.mockReturnValue({
      exec: jest.fn().mockResolvedValue([dev]),
    });
    liveStatusService.isOnline.mockReturnValue(false);
    // Another concurrent sweep already flipped it — the guarded update matches nothing.
    deviceModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    const result = await service.runSweep();

    expect(result.processed).toBe(0);
    expect(liveMonitoringGateway.emitStatusChange).not.toHaveBeenCalled();
    expect(notificationCenterService.createIfNotExists).not.toHaveBeenCalled();
  });
});
