import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Model, Types } from 'mongoose';
import type { Server, Socket } from 'socket.io';
import { resolveJwtSecret } from '../auth/jwt.strategy';
import { DocumentAccessService } from '../documents/document-access.service';
import {
  ApprovalStatus,
  Role,
  User,
  UserDocument,
} from '../schemas/user.schema';
import { DeviceAuthService } from './device-auth.service';
import { TelemetryIngestionService } from './telemetry-ingestion.service';
import { DeviceConnectionStatus } from '../schemas/device.schema';
import { FaultEventSeverity } from '../schemas/fault-event.schema';

interface UserSocketData {
  kind: 'user';
  userId: string;
  role: string;
}

interface DeviceSocketData {
  kind: 'device';
  deviceMongoId: string;
  deviceId: string;
  machineId: string;
}

type SocketData = UserSocketData | DeviceSocketData;

interface SocketAuthState {
  ready: Promise<SocketData>;
  subscribedMachineIds: Set<string>;
  unauthorizedSubscriptionAttempts: number;
}

const SOCKET_ERRORS = {
  AUTH_REQUIRED: 'SOCKET_AUTH_REQUIRED',
  AUTH_INVALID: 'SOCKET_AUTH_INVALID',
  AUTH_EXPIRED: 'SOCKET_AUTH_EXPIRED',
  ACCESS_DENIED: 'SOCKET_ACCESS_DENIED',
  INVALID_PAYLOAD: 'SOCKET_INVALID_PAYLOAD',
  INTERNAL_ERROR: 'SOCKET_INTERNAL_ERROR',
} as const;

const SOCKET_ERRORS_BY_VALUE = Object.fromEntries(
  Object.values(SOCKET_ERRORS).map((code) => [code, true]),
) as Record<string, true>;

const MAX_MACHINE_SUBSCRIPTIONS_PER_SOCKET = 100;
const MAX_UNAUTHORIZED_SUBSCRIPTION_ATTEMPTS = 5;

function machineRoom(machineId: string): string {
  return `machine:${machineId}`;
}

/**
 * One gateway, two server-verified connection kinds:
 * - browser user sockets authenticate with `handshake.auth.token`;
 * - device sockets authenticate with `handshake.auth.deviceId/deviceKey`.
 *
 * Query-string token authentication is intentionally unsupported. User
 * sockets are revalidated against the current database record before any
 * room subscription can succeed; device sockets re-check the device record
 * before every ingestion event.
 */
@WebSocketGateway({
  namespace: '/live',
})
export class LiveMonitoringGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(LiveMonitoringGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly documentAccessService: DocumentAccessService,
    private readonly deviceAuthService: DeviceAuthService,
    private readonly telemetryIngestionService: TelemetryIngestionService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  handleConnection(client: Socket): void {
    const ready = this.authenticate(client);
    ready.catch(() => undefined);
    client.data = {
      ready,
      subscribedMachineIds: new Set<string>(),
      unauthorizedSubscriptionAttempts: 0,
    } satisfies SocketAuthState;
  }

  handleDisconnect(): void {
    // Socket.IO removes room memberships and listeners for the disconnected
    // socket. The per-socket state above is held only by the socket object.
  }

  private async authenticate(client: Socket): Promise<SocketData> {
    const auth = (client.handshake.auth ?? {}) as Record<string, unknown>;
    const query = (client.handshake.query ?? {}) as Record<string, unknown>;

    try {
      if (typeof query.token === 'string') {
        throw this.socketAuthError(SOCKET_ERRORS.AUTH_INVALID);
      }

      const deviceId =
        typeof auth.deviceId === 'string' ? auth.deviceId : undefined;
      const deviceKey =
        typeof auth.deviceKey === 'string' ? auth.deviceKey : undefined;
      const token = typeof auth.token === 'string' ? auth.token : undefined;
      const hasDeviceCredentials = Boolean(deviceId && deviceKey);
      const hasUserToken = Boolean(token);

      if (hasDeviceCredentials && hasUserToken) {
        throw this.socketAuthError(SOCKET_ERRORS.AUTH_INVALID);
      }

      if (hasDeviceCredentials) {
        const device = await this.deviceAuthService.verifyCredentials(
          deviceId!,
          deviceKey!,
        );
        return {
          kind: 'device',
          deviceMongoId: String(device._id),
          deviceId: device.device_id,
          machineId: String(device.machine_id),
        };
      }

      if (hasUserToken) {
        const secret = resolveJwtSecret(this.configService);
        const payload = this.jwtService.verify<{
          sub: string;
          role?: string;
          iat?: number;
        }>(token!, { secret });
        const user = await this.resolveActiveSocketUser(payload);

        return {
          kind: 'user',
          userId: user._id.toString(),
          role: user.role,
        };
      }

      throw this.socketAuthError(SOCKET_ERRORS.AUTH_REQUIRED);
    } catch (error) {
      const code = this.getSocketErrorCode(error);
      client.emit('socket:error', { code });
      this.logger.warn(`Rejected WebSocket connection: ${code}`);
      client.disconnect(true);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  @SubscribeMessage('subscribe:machine')
  async handleSubscribeMachine(
    client: Socket,
    payload: { machineId?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    const data = await this.resolveSocketData(client);
    if (data?.kind !== 'user') {
      return { ok: false, error: SOCKET_ERRORS.ACCESS_DENIED };
    }

    const machineId = this.validatedMachineId(payload);
    if (!machineId) {
      return { ok: false, error: SOCKET_ERRORS.INVALID_PAYLOAD };
    }

    const state = this.getSocketState(client);
    if (
      state.subscribedMachineIds.size >= MAX_MACHINE_SUBSCRIPTIONS_PER_SOCKET
    ) {
      return { ok: false, error: SOCKET_ERRORS.ACCESS_DENIED };
    }

    try {
      await this.documentAccessService.assertCanAccessMachine(
        { userId: data.userId, role: data.role },
        machineId,
      );
    } catch {
      state.unauthorizedSubscriptionAttempts += 1;
      if (
        state.unauthorizedSubscriptionAttempts >
        MAX_UNAUTHORIZED_SUBSCRIPTION_ATTEMPTS
      ) {
        client.disconnect(true);
      }
      return { ok: false, error: SOCKET_ERRORS.ACCESS_DENIED };
    }

    if (!state.subscribedMachineIds.has(machineId)) {
      await client.join(machineRoom(machineId));
      state.subscribedMachineIds.add(machineId);
    }
    return { ok: true };
  }

  @SubscribeMessage('unsubscribe:machine')
  async handleUnsubscribeMachine(
    client: Socket,
    payload: { machineId?: string },
  ): Promise<{ ok: boolean }> {
    const machineId = this.validatedMachineId(payload);
    if (machineId) {
      await client.leave(machineRoom(machineId));
      this.getSocketState(client).subscribedMachineIds.delete(machineId);
    }
    return { ok: true };
  }

  @SubscribeMessage('device:heartbeat')
  async handleDeviceHeartbeat(client: Socket): Promise<{ ok: boolean }> {
    const device = await this.requireDeviceSocket(client);
    if (!device) return { ok: false };

    try {
      const record = await this.deviceAuthService.getDeviceOrThrow(
        device.deviceMongoId,
      );
      const { cameOnline } =
        await this.telemetryIngestionService.recordHeartbeat(record);
      if (cameOnline) {
        this.emitStatusChange(device.machineId, {
          deviceId: device.deviceId,
          status: DeviceConnectionStatus.ONLINE,
          lastSeenAt: new Date().toISOString(),
        });
      }
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  @SubscribeMessage('device:telemetry')
  async handleDeviceTelemetry(
    client: Socket,
    payload: { metrics?: Record<string, number>; recorded_at?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    const device = await this.requireDeviceSocket(client);
    if (!device) return { ok: false, error: SOCKET_ERRORS.ACCESS_DENIED };

    try {
      const record = await this.deviceAuthService.getDeviceOrThrow(
        device.deviceMongoId,
      );
      const { record: telemetry, cameOnline } =
        await this.telemetryIngestionService.recordTelemetry(record, {
          metrics: payload?.metrics ?? {},
          recordedAt: payload?.recorded_at
            ? new Date(payload.recorded_at)
            : undefined,
        });

      this.emitTelemetry(device.machineId, {
        deviceId: device.deviceId,
        metrics: telemetry.metrics,
        recordedAt: telemetry.recorded_at.toISOString(),
      });
      if (cameOnline) {
        this.emitStatusChange(device.machineId, {
          deviceId: device.deviceId,
          status: DeviceConnectionStatus.ONLINE,
          lastSeenAt: new Date().toISOString(),
        });
      }
      return { ok: true };
    } catch {
      return { ok: false, error: SOCKET_ERRORS.INTERNAL_ERROR };
    }
  }

  @SubscribeMessage('device:fault')
  async handleDeviceFault(
    client: Socket,
    payload: {
      code_panne?: string;
      severity?: FaultEventSeverity;
      message?: string;
      raised_at?: string;
    },
  ): Promise<{ ok: boolean; error?: string }> {
    const device = await this.requireDeviceSocket(client);
    if (!device) return { ok: false, error: SOCKET_ERRORS.ACCESS_DENIED };

    try {
      const record = await this.deviceAuthService.getDeviceOrThrow(
        device.deviceMongoId,
      );
      const { record: faultEvent, cameOnline } =
        await this.telemetryIngestionService.recordFault(record, {
          codePanne: payload?.code_panne ?? '',
          severity: payload?.severity,
          message: payload?.message,
          raisedAt: payload?.raised_at
            ? new Date(payload.raised_at)
            : undefined,
        });

      this.emitFault(device.machineId, {
        id: String(faultEvent._id),
        deviceId: device.deviceId,
        codePanne: faultEvent.code_panne,
        severity: faultEvent.severity,
        message: faultEvent.message,
        raisedAt: faultEvent.raised_at.toISOString(),
      });
      if (cameOnline) {
        this.emitStatusChange(device.machineId, {
          deviceId: device.deviceId,
          status: DeviceConnectionStatus.ONLINE,
          lastSeenAt: new Date().toISOString(),
        });
      }
      return { ok: true };
    } catch {
      return { ok: false, error: SOCKET_ERRORS.INTERNAL_ERROR };
    }
  }

  emitTelemetry(machineId: string, payload: Record<string, unknown>): void {
    this.server
      ?.to(machineRoom(machineId))
      .emit('telemetry', { machineId, ...payload });
  }

  emitFault(machineId: string, payload: Record<string, unknown>): void {
    this.server
      ?.to(machineRoom(machineId))
      .emit('fault', { machineId, ...payload });
  }

  emitFaultResolved(machineId: string, payload: Record<string, unknown>): void {
    this.server
      ?.to(machineRoom(machineId))
      .emit('fault:resolved', { machineId, ...payload });
  }

  emitStatusChange(machineId: string, payload: Record<string, unknown>): void {
    this.server
      ?.to(machineRoom(machineId))
      .emit('status', { machineId, ...payload });
  }

  private async resolveSocketData(client: Socket): Promise<SocketData | null> {
    const state = client.data as SocketAuthState | undefined;
    if (!state?.ready) return null;
    return state.ready.catch(() => null);
  }

  private getSocketState(client: Socket): SocketAuthState {
    const state = client.data as SocketAuthState | undefined;
    if (state?.subscribedMachineIds) return state;

    const fallback: SocketAuthState = {
      ready: Promise.reject(this.socketAuthError(SOCKET_ERRORS.AUTH_REQUIRED)),
      subscribedMachineIds: new Set<string>(),
      unauthorizedSubscriptionAttempts: 0,
    };
    fallback.ready.catch(() => undefined);
    client.data = fallback;
    return fallback;
  }

  private async requireDeviceSocket(
    client: Socket,
  ): Promise<DeviceSocketData | null> {
    const data = await this.resolveSocketData(client);
    return data?.kind === 'device' ? data : null;
  }

  private async resolveActiveSocketUser(payload: {
    sub?: string;
    iat?: number;
  }): Promise<UserDocument> {
    if (!payload.sub || !Types.ObjectId.isValid(payload.sub)) {
      throw this.socketAuthError(SOCKET_ERRORS.AUTH_INVALID);
    }

    const user = await this.userModel
      .findById(payload.sub)
      .select(
        'role is_active is_verified approval_status profile_completed must_reset_password credentials_invalidated_at',
      )
      .exec();

    if (!user) {
      throw this.socketAuthError(SOCKET_ERRORS.AUTH_INVALID);
    }

    if (
      user.credentials_invalidated_at &&
      typeof payload.iat === 'number' &&
      payload.iat * 1000 < user.credentials_invalidated_at.getTime()
    ) {
      throw this.socketAuthError(SOCKET_ERRORS.AUTH_EXPIRED);
    }

    if (
      !user.is_active ||
      !user.is_verified ||
      user.must_reset_password ||
      user.profile_completed === false ||
      user.approval_status === ApprovalStatus.PENDING ||
      user.approval_status === ApprovalStatus.REJECTED ||
      (user.approval_status && user.approval_status !== ApprovalStatus.APPROVED)
    ) {
      throw this.socketAuthError(SOCKET_ERRORS.ACCESS_DENIED);
    }

    if (
      user.role !== Role.ADMIN &&
      user.role !== Role.TECHNICIAN &&
      user.role !== Role.OPERATOR
    ) {
      throw this.socketAuthError(SOCKET_ERRORS.ACCESS_DENIED);
    }

    return user;
  }

  private validatedMachineId(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const machineId = (payload as { machineId?: unknown }).machineId;
    if (typeof machineId !== 'string' || !Types.ObjectId.isValid(machineId)) {
      return null;
    }
    return machineId;
  }

  private socketAuthError(code: string): Error {
    const error = new Error(code);
    error.name = code;
    return error;
  }

  private getSocketErrorCode(error: unknown): string {
    if (error instanceof Error) {
      if (error.name in SOCKET_ERRORS_BY_VALUE) return error.name;
      if (/expired/i.test(error.message)) return SOCKET_ERRORS.AUTH_EXPIRED;
    }
    return SOCKET_ERRORS.AUTH_INVALID;
  }
}
