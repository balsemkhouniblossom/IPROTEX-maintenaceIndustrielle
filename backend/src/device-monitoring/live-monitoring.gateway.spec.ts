import { LiveMonitoringGateway } from './live-monitoring.gateway';
import { DeviceConnectionStatus } from '../schemas/device.schema';

function fakeSocket(auth: Record<string, unknown>) {
  return {
    handshake: { auth },
    data: undefined as unknown,
    disconnect: jest.fn(),
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
  };
}

function withReadyData(data: Record<string, unknown>) {
  return { ready: Promise.resolve(data) };
}

/** Waits for handleConnection's synchronously-stashed auth promise to settle. */
async function settleAuth(socket: { data: unknown }): Promise<void> {
  const state = socket.data as { ready?: Promise<unknown> } | undefined;
  await state?.ready?.catch(() => undefined);
}

describe('LiveMonitoringGateway', () => {
  let jwtService: { verify: jest.Mock };
  let configService: { get: jest.Mock };
  let documentAccessService: { assertCanAccessMachine: jest.Mock };
  let deviceAuthService: {
    verifyCredentials: jest.Mock;
    getDeviceOrThrow: jest.Mock;
  };
  let telemetryIngestionService: {
    recordHeartbeat: jest.Mock;
    recordTelemetry: jest.Mock;
    recordFault: jest.Mock;
  };
  let gateway: LiveMonitoringGateway;

  beforeEach(() => {
    jwtService = { verify: jest.fn() };
    configService = { get: jest.fn().mockReturnValue(undefined) };
    documentAccessService = {
      assertCanAccessMachine: jest.fn().mockResolvedValue(undefined),
    };
    deviceAuthService = {
      verifyCredentials: jest.fn(),
      getDeviceOrThrow: jest.fn(),
    };
    telemetryIngestionService = {
      recordHeartbeat: jest.fn(),
      recordTelemetry: jest.fn(),
      recordFault: jest.fn(),
    };

    gateway = new LiveMonitoringGateway(
      jwtService as never,
      configService as never,
      documentAccessService as never,
      deviceAuthService as never,
      telemetryIngestionService as never,
    );
  });

  describe('handleConnection', () => {
    it('synchronously stashes an awaitable auth promise on client.data before any await', () => {
      const socket = fakeSocket({ token: 'a.b.c' });
      jwtService.verify.mockReturnValue({ sub: 'user-1', role: 'admin' });

      gateway.handleConnection(socket as never);

      expect(socket.data).toEqual(
        expect.objectContaining({ ready: expect.any(Promise) }),
      );
    });

    it('disconnects a client presenting neither a token nor device credentials', async () => {
      const socket = fakeSocket({});
      gateway.handleConnection(socket as never);
      await settleAuth(socket);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('authenticates a device socket via DeviceAuthService, never touching JwtService', async () => {
      const device = {
        _id: 'mongo-id',
        device_id: 'DEV-1',
        machine_id: 'machine-1',
      };
      deviceAuthService.verifyCredentials.mockResolvedValue(device);
      const socket = fakeSocket({
        deviceId: 'DEV-1',
        deviceKey: 'prefix.secret',
      });

      gateway.handleConnection(socket as never);
      await settleAuth(socket);

      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(jwtService.verify).not.toHaveBeenCalled();
      const resolved = await (socket.data as { ready: Promise<unknown> }).ready;
      expect(resolved).toMatchObject({ kind: 'device', deviceId: 'DEV-1' });
    });

    it('disconnects a device socket presenting invalid credentials', async () => {
      deviceAuthService.verifyCredentials.mockRejectedValue(
        new Error('invalid'),
      );
      const socket = fakeSocket({ deviceId: 'DEV-1', deviceKey: 'wrong' });
      gateway.handleConnection(socket as never);
      await settleAuth(socket);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('authenticates a user socket via a verified JWT, never touching DeviceAuthService', async () => {
      jwtService.verify.mockReturnValue({ sub: 'user-1', role: 'technician' });
      const socket = fakeSocket({ token: 'a.b.c' });

      gateway.handleConnection(socket as never);
      await settleAuth(socket);

      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(deviceAuthService.verifyCredentials).not.toHaveBeenCalled();
      const resolved = await (socket.data as { ready: Promise<unknown> }).ready;
      expect(resolved).toEqual({
        kind: 'user',
        userId: 'user-1',
        role: 'technician',
      });
    });

    it('disconnects a user socket presenting an invalid/expired JWT', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });
      const socket = fakeSocket({ token: 'bad' });
      gateway.handleConnection(socket as never);
      await settleAuth(socket);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('a message handler awaiting the auth promise on an already-connected socket sees the resolved identity even if it arrives before authentication settles', async () => {
      let resolveVerify!: (value: unknown) => void;
      deviceAuthService.verifyCredentials.mockReturnValue(
        new Promise((resolve) => {
          resolveVerify = resolve;
        }),
      );
      const socket = fakeSocket({
        deviceId: 'DEV-1',
        deviceKey: 'prefix.secret',
      });

      gateway.handleConnection(socket as never);
      // Simulate a message arriving on the very next tick, before the DB/bcrypt
      // lookup above resolves — this is exactly the race the ready-promise
      // design exists to close.
      const pendingHandler = gateway.handleDeviceHeartbeat(socket as never);
      resolveVerify({
        _id: 'mongo-id',
        device_id: 'DEV-1',
        machine_id: 'machine-1',
      });
      deviceAuthService.getDeviceOrThrow.mockResolvedValue({
        _id: 'mongo-id',
        device_id: 'DEV-1',
        machine_id: 'machine-1',
      });
      telemetryIngestionService.recordHeartbeat.mockResolvedValue({
        cameOnline: false,
      });

      const result = await pendingHandler;
      expect(result).toEqual({ ok: true });
    });
  });

  describe('subscribe:machine', () => {
    it('rejects a device socket attempting to subscribe to a machine room', async () => {
      const socket = fakeSocket({});
      socket.data = withReadyData({
        kind: 'device',
        deviceMongoId: 'x',
        deviceId: 'DEV-1',
        machineId: 'm1',
      });

      const result = await gateway.handleSubscribeMachine(socket as never, {
        machineId: 'm1',
      });

      expect(result).toEqual({ ok: false, error: 'forbidden' });
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('rejects a user socket subscribing to a machine it cannot access', async () => {
      documentAccessService.assertCanAccessMachine.mockRejectedValue(
        new Error('forbidden'),
      );
      const socket = fakeSocket({});
      socket.data = withReadyData({
        kind: 'user',
        userId: 'user-1',
        role: 'operator',
      });

      const result = await gateway.handleSubscribeMachine(socket as never, {
        machineId: 'm1',
      });

      expect(result).toEqual({ ok: false, error: 'forbidden' });
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('joins the machine room for a user socket that is allowed to access it', async () => {
      const socket = fakeSocket({});
      socket.data = withReadyData({
        kind: 'user',
        userId: 'user-1',
        role: 'admin',
      });

      const result = await gateway.handleSubscribeMachine(socket as never, {
        machineId: 'm1',
      });

      expect(result).toEqual({ ok: true });
      expect(socket.join).toHaveBeenCalledWith('machine:m1');
    });
  });

  describe('device:* message handlers reject non-device sockets', () => {
    it('device:heartbeat is a no-op for a user socket', async () => {
      const socket = fakeSocket({});
      socket.data = withReadyData({
        kind: 'user',
        userId: 'user-1',
        role: 'admin',
      });

      const result = await gateway.handleDeviceHeartbeat(socket as never);

      expect(result).toEqual({ ok: false });
      expect(telemetryIngestionService.recordHeartbeat).not.toHaveBeenCalled();
    });

    it('device:telemetry is rejected for a user socket', async () => {
      const socket = fakeSocket({});
      socket.data = withReadyData({
        kind: 'user',
        userId: 'user-1',
        role: 'admin',
      });

      const result = await gateway.handleDeviceTelemetry(socket as never, {
        metrics: { x: 1 },
      });

      expect(result).toEqual({ ok: false, error: 'forbidden' });
      expect(telemetryIngestionService.recordTelemetry).not.toHaveBeenCalled();
    });

    it('device:fault is rejected for a user socket', async () => {
      const socket = fakeSocket({});
      socket.data = withReadyData({
        kind: 'user',
        userId: 'user-1',
        role: 'admin',
      });

      const result = await gateway.handleDeviceFault(socket as never, {
        code_panne: 'E-1',
      });

      expect(result).toEqual({ ok: false, error: 'forbidden' });
      expect(telemetryIngestionService.recordFault).not.toHaveBeenCalled();
    });
  });

  describe('device:telemetry for an authenticated device socket', () => {
    it('re-verifies the device is still active before ingesting', async () => {
      const record = { machine_id: 'm1', device_id: 'DEV-1' };
      deviceAuthService.getDeviceOrThrow.mockResolvedValue(record);
      telemetryIngestionService.recordTelemetry.mockResolvedValue({
        record: { metrics: { x: 1 }, recorded_at: new Date() },
        cameOnline: false,
      });
      const socket = fakeSocket({});
      socket.data = withReadyData({
        kind: 'device',
        deviceMongoId: 'mongo-1',
        deviceId: 'DEV-1',
        machineId: 'm1',
      });

      const result = await gateway.handleDeviceTelemetry(socket as never, {
        metrics: { x: 1 },
      });

      expect(result).toEqual({ ok: true });
      expect(deviceAuthService.getDeviceOrThrow).toHaveBeenCalledWith(
        'mongo-1',
      );
      expect(telemetryIngestionService.recordTelemetry).toHaveBeenCalledWith(
        record,
        expect.objectContaining({ metrics: { x: 1 } }),
      );
    });

    it('a deactivated device is rejected mid-session even with a still-open socket', async () => {
      deviceAuthService.getDeviceOrThrow.mockRejectedValue(
        new Error('Invalid device credentials'),
      );
      const socket = fakeSocket({});
      socket.data = withReadyData({
        kind: 'device',
        deviceMongoId: 'mongo-1',
        deviceId: 'DEV-1',
        machineId: 'm1',
      });

      const result = await gateway.handleDeviceTelemetry(socket as never, {
        metrics: { x: 1 },
      });

      expect(result.ok).toBe(false);
      expect(telemetryIngestionService.recordTelemetry).not.toHaveBeenCalled();
    });
  });

  describe('emit helpers', () => {
    it('emit* methods are no-ops before the socket.io server is attached', () => {
      expect(() => gateway.emitTelemetry('m1', {})).not.toThrow();
      expect(() => gateway.emitFault('m1', {})).not.toThrow();
      expect(() =>
        gateway.emitStatusChange('m1', {
          status: DeviceConnectionStatus.ONLINE,
        }),
      ).not.toThrow();
    });

    it('emits to the correct machine room once the server is attached', () => {
      const to = jest.fn().mockReturnValue({ emit: jest.fn() });
      (gateway as unknown as { server: unknown }).server = { to };

      gateway.emitTelemetry('m1', { metrics: { x: 1 } });

      expect(to).toHaveBeenCalledWith('machine:m1');
    });
  });
});
