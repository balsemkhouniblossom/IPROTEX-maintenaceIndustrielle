import { Types } from 'mongoose';
import { MqttIngestionService } from './mqtt-ingestion.service';
import { DeviceConnectionStatus } from '../schemas/device.schema';

describe('MqttIngestionService.handleMessage', () => {
  let configService: { get: jest.Mock };
  let deviceAuthService: { verifyCredentials: jest.Mock };
  let telemetryIngestionService: {
    recordHeartbeat: jest.Mock;
    recordTelemetry: jest.Mock;
    recordFault: jest.Mock;
  };
  let liveMonitoringGateway: {
    emitTelemetry: jest.Mock;
    emitFault: jest.Mock;
    emitStatusChange: jest.Mock;
  };
  let service: MqttIngestionService;
  const device = {
    _id: new Types.ObjectId(),
    device_id: 'DEV-1',
    machine_id: new Types.ObjectId(),
    last_known_status: DeviceConnectionStatus.ONLINE,
  };

  function payload(body: Record<string, unknown>): Buffer {
    return Buffer.from(JSON.stringify(body), 'utf8');
  }

  beforeEach(() => {
    configService = { get: jest.fn().mockReturnValue(undefined) };
    deviceAuthService = { verifyCredentials: jest.fn().mockResolvedValue(device) };
    telemetryIngestionService = {
      recordHeartbeat: jest.fn().mockResolvedValue({ cameOnline: false }),
      recordTelemetry: jest.fn().mockResolvedValue({
        record: { metrics: { temperature: 70 }, recorded_at: new Date() },
        cameOnline: false,
      }),
      recordFault: jest.fn().mockResolvedValue({
        record: {
          _id: new Types.ObjectId(),
          code_panne: 'E-1',
          severity: 'warning',
          raised_at: new Date(),
        },
        cameOnline: false,
      }),
    };
    liveMonitoringGateway = {
      emitTelemetry: jest.fn(),
      emitFault: jest.fn(),
      emitStatusChange: jest.fn(),
    };

    service = new MqttIngestionService(
      configService as never,
      deviceAuthService as never,
      telemetryIngestionService as never,
      liveMonitoringGateway as never,
    );
  });

  it('ignores a message on a topic that is not devices/{id}/{kind}', async () => {
    await service.handleMessage('unrelated/topic', payload({ api_key: 'x' }));
    expect(deviceAuthService.verifyCredentials).not.toHaveBeenCalled();
  });

  it('ignores a message with malformed JSON', async () => {
    await service.handleMessage('devices/DEV-1/heartbeat', Buffer.from('not json'));
    expect(deviceAuthService.verifyCredentials).not.toHaveBeenCalled();
  });

  it('ignores a message with no api_key rather than treating the device as authenticated', async () => {
    await service.handleMessage('devices/DEV-1/heartbeat', payload({}));
    expect(deviceAuthService.verifyCredentials).not.toHaveBeenCalled();
  });

  it('drops a message when device credential verification fails', async () => {
    deviceAuthService.verifyCredentials.mockRejectedValue(new Error('bad creds'));
    await service.handleMessage('devices/DEV-1/heartbeat', payload({ api_key: 'wrong' }));
    expect(telemetryIngestionService.recordHeartbeat).not.toHaveBeenCalled();
  });

  it('routes a verified heartbeat message to recordHeartbeat', async () => {
    await service.handleMessage('devices/DEV-1/heartbeat', payload({ api_key: 'prefix.secret' }));
    expect(deviceAuthService.verifyCredentials).toHaveBeenCalledWith('DEV-1', 'prefix.secret');
    expect(telemetryIngestionService.recordHeartbeat).toHaveBeenCalledWith(device);
  });

  it('routes a verified telemetry message to recordTelemetry and pushes a live update', async () => {
    await service.handleMessage(
      'devices/DEV-1/telemetry',
      payload({ api_key: 'prefix.secret', metrics: { temperature: 70 } }),
    );
    expect(telemetryIngestionService.recordTelemetry).toHaveBeenCalledWith(
      device,
      expect.objectContaining({ metrics: { temperature: 70 } }),
    );
    expect(liveMonitoringGateway.emitTelemetry).toHaveBeenCalledWith(
      device.machine_id.toString(),
      expect.objectContaining({ deviceId: 'DEV-1' }),
    );
  });

  it('routes a verified fault message to recordFault and pushes a live update', async () => {
    await service.handleMessage(
      'devices/DEV-1/fault',
      payload({ api_key: 'prefix.secret', code_panne: 'E-1' }),
    );
    expect(telemetryIngestionService.recordFault).toHaveBeenCalledWith(
      device,
      expect.objectContaining({ codePanne: 'E-1' }),
    );
    expect(liveMonitoringGateway.emitFault).toHaveBeenCalledWith(
      device.machine_id.toString(),
      expect.objectContaining({ codePanne: 'E-1' }),
    );
  });

  it('emits a status-change event when a message brings a device back online', async () => {
    telemetryIngestionService.recordHeartbeat.mockResolvedValue({ cameOnline: true });
    await service.handleMessage('devices/DEV-1/heartbeat', payload({ api_key: 'prefix.secret' }));
    expect(liveMonitoringGateway.emitStatusChange).toHaveBeenCalledWith(
      device.machine_id.toString(),
      expect.objectContaining({ status: DeviceConnectionStatus.ONLINE }),
    );
  });

  it('ignores an unrecognized topic kind', async () => {
    await service.handleMessage('devices/DEV-1/unknown', payload({ api_key: 'prefix.secret' }));
    expect(telemetryIngestionService.recordHeartbeat).not.toHaveBeenCalled();
    expect(telemetryIngestionService.recordTelemetry).not.toHaveBeenCalled();
    expect(telemetryIngestionService.recordFault).not.toHaveBeenCalled();
  });
});
