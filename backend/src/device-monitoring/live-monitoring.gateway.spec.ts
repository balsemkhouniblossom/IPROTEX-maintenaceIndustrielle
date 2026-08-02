import { Types } from 'mongoose';
import { LiveMonitoringGateway } from './live-monitoring.gateway';
import { DeviceConnectionStatus } from '../schemas/device.schema';
import { ApprovalStatus, Role } from '../schemas/user.schema';

function fakeSocket(
  auth: Record<string, unknown>,
  query: Record<string, unknown> = {},
) {
  return {
    handshake: { auth, query },
    data: undefined as unknown,
    emit: jest.fn(),
    disconnect: jest.fn(),
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
  };
}

function withReadyData(data: Record<string, unknown>) {
  return {
    ready: Promise.resolve(data),
    subscribedMachineIds: new Set<string>(),
    unauthorizedSubscriptionAttempts: 0,
  };
}

function createQuery<T>(value: T) {
  return {
    select: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

async function settleAuth(socket: { data: unknown }): Promise<void> {
  const state = socket.data as { ready?: Promise<unknown> } | undefined;
  await state?.ready?.catch(() => undefined);
}

function activeUser(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    role: Role.OPERATOR,
    is_active: true,
    is_verified: true,
    approval_status: ApprovalStatus.APPROVED,
    profile_completed: true,
    ...overrides,
  };
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
  let userModel: { findById: jest.Mock };
  let gateway: LiveMonitoringGateway;
  let machineId: string;

  beforeEach(() => {
    machineId = new Types.ObjectId().toString();
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
    userModel = {
      findById: jest.fn().mockReturnValue(createQuery(activeUser())),
    };

    gateway = new LiveMonitoringGateway(
      jwtService as never,
      configService as never,
      documentAccessService as never,
      deviceAuthService as never,
      telemetryIngestionService as never,
      userModel as never,
    );
  });

  describe('handleConnection', () => {
    it('synchronously stashes an awaitable auth promise on client.data before any await', () => {
      const user = activeUser();
      userModel.findById.mockReturnValue(createQuery(user));
      jwtService.verify.mockReturnValue({
        sub: user._id.toString(),
        role: Role.ADMIN,
      });
      const socket = fakeSocket({ token: 'a.b.c' });

      gateway.handleConnection(socket as never);

      expect(socket.data).toEqual(
        expect.objectContaining({
          ready: expect.any(Promise),
          subscribedMachineIds: expect.any(Set),
        }),
      );
    });

    it('disconnects a client presenting neither a token nor device credentials', async () => {
      const socket = fakeSocket({});
      gateway.handleConnection(socket as never);
      await settleAuth(socket);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.emit).toHaveBeenCalledWith('socket:error', {
        code: 'SOCKET_AUTH_REQUIRED',
      });
    });

    it('rejects query-parameter token authentication', async () => {
      const socket = fakeSocket({}, { token: 'a.b.c' });
      gateway.handleConnection(socket as never);
      await settleAuth(socket);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.emit).toHaveBeenCalledWith('socket:error', {
        code: 'SOCKET_AUTH_INVALID',
      });
      expect(jwtService.verify).not.toHaveBeenCalled();
    });

    it('authenticates a device socket via DeviceAuthService, never touching JwtService', async () => {
      const device = {
        _id: 'mongo-id',
        device_id: 'DEV-1',
        machine_id: machineId,
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

    it('authenticates a user socket via a verified JWT and ignores a forged handshake role', async () => {
      const user = activeUser({ role: Role.TECHNICIAN });
      userModel.findById.mockReturnValue(createQuery(user));
      jwtService.verify.mockReturnValue({
        sub: user._id.toString(),
        role: 'admin',
      });
      const socket = fakeSocket({ token: 'a.b.c', role: 'admin' });

      gateway.handleConnection(socket as never);
      await settleAuth(socket);

      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(deviceAuthService.verifyCredentials).not.toHaveBeenCalled();
      const resolved = await (socket.data as { ready: Promise<unknown> }).ready;
      expect(resolved).toEqual({
        kind: 'user',
        userId: user._id.toString(),
        role: Role.TECHNICIAN,
      });
    });

    it('disconnects a user socket presenting an invalid or expired JWT', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });
      const socket = fakeSocket({ token: 'bad' });
      gateway.handleConnection(socket as never);
      await settleAuth(socket);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.emit).toHaveBeenCalledWith('socket:error', {
        code: 'SOCKET_AUTH_EXPIRED',
      });
    });

    it('rejects inactive, rejected, pending, and incomplete-profile users from the current database record', async () => {
      for (const user of [
        activeUser({ is_active: false }),
        activeUser({ approval_status: ApprovalStatus.REJECTED }),
        activeUser({ approval_status: ApprovalStatus.PENDING }),
        activeUser({ profile_completed: false }),
      ]) {
        userModel.findById.mockReturnValueOnce(createQuery(user));
        jwtService.verify.mockReturnValueOnce({
          sub: user._id.toString(),
          role: Role.ADMIN,
        });
        const socket = fakeSocket({ token: 'a.b.c' });

        gateway.handleConnection(socket as never);
        await settleAuth(socket);

        expect(socket.disconnect).toHaveBeenCalledWith(true);
        expect(socket.emit).toHaveBeenCalledWith('socket:error', {
          code: 'SOCKET_ACCESS_DENIED',
        });
      }
    });

    it('a message handler awaiting the auth promise sees the resolved identity even if the message arrives before authentication settles', async () => {
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
      const pendingHandler = gateway.handleDeviceHeartbeat(socket as never);
      resolveVerify({
        _id: 'mongo-id',
        device_id: 'DEV-1',
        machine_id: machineId,
      });
      deviceAuthService.getDeviceOrThrow.mockResolvedValue({
        _id: 'mongo-id',
        device_id: 'DEV-1',
        machine_id: machineId,
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
        machineId,
      });

      const result = await gateway.handleSubscribeMachine(socket as never, {
        machineId,
      });

      expect(result).toEqual({ ok: false, error: 'SOCKET_ACCESS_DENIED' });
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('rejects arbitrary room strings and malformed machine IDs before access checks', async () => {
      const socket = fakeSocket({});
      socket.data = withReadyData({
        kind: 'user',
        userId: new Types.ObjectId().toString(),
        role: Role.ADMIN,
      });

      const result = await gateway.handleSubscribeMachine(socket as never, {
        machineId: 'machine:other-room',
      });

      expect(result).toEqual({ ok: false, error: 'SOCKET_INVALID_PAYLOAD' });
      expect(
        documentAccessService.assertCanAccessMachine,
      ).not.toHaveBeenCalled();
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('rejects a user socket subscribing to a machine it cannot access without revealing existence', async () => {
      documentAccessService.assertCanAccessMachine.mockRejectedValue(
        new Error('forbidden'),
      );
      const socket = fakeSocket({});
      socket.data = withReadyData({
        kind: 'user',
        userId: new Types.ObjectId().toString(),
        role: Role.OPERATOR,
      });

      const result = await gateway.handleSubscribeMachine(socket as never, {
        machineId,
      });

      expect(result).toEqual({ ok: false, error: 'SOCKET_ACCESS_DENIED' });
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('joins the generated machine room for a user socket that is allowed to access it', async () => {
      const socket = fakeSocket({});
      socket.data = withReadyData({
        kind: 'user',
        userId: new Types.ObjectId().toString(),
        role: Role.ADMIN,
      });

      const result = await gateway.handleSubscribeMachine(socket as never, {
        machineId,
      });

      expect(result).toEqual({ ok: true });
      expect(socket.join).toHaveBeenCalledWith(`machine:${machineId}`);
    });

    it('does not join the same machine room twice for repeated subscriptions', async () => {
      const socket = fakeSocket({});
      socket.data = withReadyData({
        kind: 'user',
        userId: new Types.ObjectId().toString(),
        role: Role.ADMIN,
      });

      await gateway.handleSubscribeMachine(socket as never, { machineId });
      await gateway.handleSubscribeMachine(socket as never, { machineId });

      expect(socket.join).toHaveBeenCalledTimes(1);
    });
  });

  describe('device:* message handlers reject non-device sockets', () => {
    it('device:heartbeat is a no-op for a user socket', async () => {
      const socket = fakeSocket({});
      socket.data = withReadyData({
        kind: 'user',
        userId: new Types.ObjectId().toString(),
        role: Role.ADMIN,
      });

      const result = await gateway.handleDeviceHeartbeat(socket as never);

      expect(result).toEqual({ ok: false });
      expect(telemetryIngestionService.recordHeartbeat).not.toHaveBeenCalled();
    });

    it('device:telemetry is rejected for a user socket', async () => {
      const socket = fakeSocket({});
      socket.data = withReadyData({
        kind: 'user',
        userId: new Types.ObjectId().toString(),
        role: Role.ADMIN,
      });

      const result = await gateway.handleDeviceTelemetry(socket as never, {
        metrics: { x: 1 },
      });

      expect(result).toEqual({ ok: false, error: 'SOCKET_ACCESS_DENIED' });
      expect(telemetryIngestionService.recordTelemetry).not.toHaveBeenCalled();
    });

    it('device:fault is rejected for a user socket', async () => {
      const socket = fakeSocket({});
      socket.data = withReadyData({
        kind: 'user',
        userId: new Types.ObjectId().toString(),
        role: Role.ADMIN,
      });

      const result = await gateway.handleDeviceFault(socket as never, {
        code_panne: 'E-1',
      });

      expect(result).toEqual({ ok: false, error: 'SOCKET_ACCESS_DENIED' });
      expect(telemetryIngestionService.recordFault).not.toHaveBeenCalled();
    });
  });

  describe('device:telemetry for an authenticated device socket', () => {
    it('re-verifies the device is still active before ingesting', async () => {
      const record = { machine_id: machineId, device_id: 'DEV-1' };
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
        machineId,
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
        machineId,
      });

      const result = await gateway.handleDeviceTelemetry(socket as never, {
        metrics: { x: 1 },
      });

      expect(result).toEqual({ ok: false, error: 'SOCKET_INTERNAL_ERROR' });
      expect(telemetryIngestionService.recordTelemetry).not.toHaveBeenCalled();
    });
  });

  describe('emit helpers', () => {
    it('emit* methods are no-ops before the socket.io server is attached', () => {
      expect(() => gateway.emitTelemetry(machineId, {})).not.toThrow();
      expect(() => gateway.emitFault(machineId, {})).not.toThrow();
      expect(() =>
        gateway.emitStatusChange(machineId, {
          status: DeviceConnectionStatus.ONLINE,
        }),
      ).not.toThrow();
    });

    it('emits to the correct machine room once the server is attached', () => {
      const emit = jest.fn();
      const to = jest.fn().mockReturnValue({ emit });
      (gateway as unknown as { server: unknown }).server = { to };

      gateway.emitTelemetry(machineId, { metrics: { x: 1 } });

      expect(to).toHaveBeenCalledWith(`machine:${machineId}`);
      expect(emit).toHaveBeenCalledWith('telemetry', {
        machineId,
        metrics: { x: 1 },
      });
      expect(JSON.stringify(emit.mock.calls)).not.toMatch(/token|secret/i);
    });
  });
});
