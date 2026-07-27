import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { resolveJwtSecret } from '../auth/jwt.strategy';
import { DocumentAccessService } from '../documents/document-access.service';
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
}

function machineRoom(machineId: string): string {
  return `machine:${machineId}`;
}

/**
 * A single gateway, two structurally-separate connection kinds. A client
 * authenticates either with a user JWT (`handshake.auth.token`) or with
 * device credentials (`handshake.auth.deviceId` / `handshake.auth.deviceKey`)
 * — never both, and each kind can only reach its own message handlers
 * (enforced per-handler below, not just by what the client happens to try),
 * so a device socket can never subscribe to another machine's room and a
 * user socket can never inject telemetry.
 *
 * Authentication itself (a bcrypt compare / DB lookup for devices, a JWT
 * verify for users) is asynchronous, but a client is free to emit its first
 * message the instant its own `'connect'` event fires — which happens
 * before an async `handleConnection` has necessarily finished. To avoid a
 * race where an early message reads `client.data` before it's been set,
 * `handleConnection` synchronously stashes a *promise* on `client.data` in
 * its very first tick (before any `await`), and every handler awaits that
 * same promise rather than reading a plain value.
 */
@WebSocketGateway({ namespace: '/live', cors: { origin: true, credentials: true } })
export class LiveMonitoringGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(LiveMonitoringGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly documentAccessService: DocumentAccessService,
    private readonly deviceAuthService: DeviceAuthService,
    private readonly telemetryIngestionService: TelemetryIngestionService,
  ) {}

  handleConnection(client: Socket): void {
    const ready = this.authenticate(client);
    // A client that disconnects (or never sends a message) before this
    // settles means nothing else ever attaches a rejection handler to
    // `ready` — without this no-op `.catch`, that would surface as an
    // unhandled promise rejection. `resolveSocketData()` below attaches its
    // own independent `.catch` when a handler actually needs the result.
    ready.catch(() => undefined);
    client.data = { ready } satisfies SocketAuthState;
  }

  handleDisconnect(): void {
    // No per-connection server-side state to clean up beyond socket.io's
    // own room bookkeeping, which it already handles on disconnect.
  }

  private async authenticate(client: Socket): Promise<SocketData> {
    const auth = (client.handshake.auth ?? {}) as Record<string, unknown>;

    try {
      if (typeof auth.deviceId === 'string' && typeof auth.deviceKey === 'string') {
        const device = await this.deviceAuthService.verifyCredentials(
          auth.deviceId,
          auth.deviceKey,
        );
        const data: DeviceSocketData = {
          kind: 'device',
          deviceMongoId: String(device._id),
          deviceId: device.device_id,
          machineId: String(device.machine_id),
        };
        return data;
      }

      if (typeof auth.token === 'string') {
        const secret = resolveJwtSecret(this.configService);
        const payload = this.jwtService.verify<{ sub: string; role: string }>(auth.token, {
          secret,
        });
        const data: UserSocketData = { kind: 'user', userId: payload.sub, role: payload.role };
        return data;
      }

      throw new Error('No credentials provided');
    } catch (error) {
      this.logger.warn(`Rejected WebSocket connection: ${String(error)}`);
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
      return { ok: false, error: 'forbidden' };
    }
    if (!payload?.machineId) {
      return { ok: false, error: 'machineId is required' };
    }

    try {
      await this.documentAccessService.assertCanAccessMachine(
        { userId: data.userId, role: data.role },
        payload.machineId,
      );
    } catch {
      return { ok: false, error: 'forbidden' };
    }

    await client.join(machineRoom(payload.machineId));
    return { ok: true };
  }

  @SubscribeMessage('unsubscribe:machine')
  async handleUnsubscribeMachine(
    client: Socket,
    payload: { machineId?: string },
  ): Promise<{ ok: boolean }> {
    if (payload?.machineId) {
      await client.leave(machineRoom(payload.machineId));
    }
    return { ok: true };
  }

  @SubscribeMessage('device:heartbeat')
  async handleDeviceHeartbeat(client: Socket): Promise<{ ok: boolean }> {
    const device = await this.requireDeviceSocket(client);
    if (!device) return { ok: false };

    try {
      const record = await this.deviceAuthService.getDeviceOrThrow(device.deviceMongoId);
      const { cameOnline } = await this.telemetryIngestionService.recordHeartbeat(record);
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
    if (!device) return { ok: false, error: 'forbidden' };

    try {
      const record = await this.deviceAuthService.getDeviceOrThrow(device.deviceMongoId);
      const { record: telemetry, cameOnline } =
        await this.telemetryIngestionService.recordTelemetry(record, {
          metrics: payload?.metrics ?? {},
          recordedAt: payload?.recorded_at ? new Date(payload.recorded_at) : undefined,
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
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'ingestion failed' };
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
    if (!device) return { ok: false, error: 'forbidden' };

    try {
      const record = await this.deviceAuthService.getDeviceOrThrow(device.deviceMongoId);
      const { record: faultEvent, cameOnline } =
        await this.telemetryIngestionService.recordFault(record, {
          codePanne: payload?.code_panne ?? '',
          severity: payload?.severity,
          message: payload?.message,
          raisedAt: payload?.raised_at ? new Date(payload.raised_at) : undefined,
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
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'ingestion failed' };
    }
  }

  // Every emitted payload carries `machineId` even though the room itself
  // is already machine-scoped — a dashboard client subscribes to several
  // machines' rooms at once, and without `machineId` in the payload it
  // would have no way to tell which machine a given event belongs to.
  emitTelemetry(machineId: string, payload: Record<string, unknown>): void {
    this.server?.to(machineRoom(machineId)).emit('telemetry', { machineId, ...payload });
  }

  emitFault(machineId: string, payload: Record<string, unknown>): void {
    this.server?.to(machineRoom(machineId)).emit('fault', { machineId, ...payload });
  }

  emitStatusChange(machineId: string, payload: Record<string, unknown>): void {
    this.server?.to(machineRoom(machineId)).emit('status', { machineId, ...payload });
  }

  private async resolveSocketData(client: Socket): Promise<SocketData | null> {
    const state = client.data as SocketAuthState | undefined;
    if (!state?.ready) return null;
    return state.ready.catch(() => null);
  }

  private async requireDeviceSocket(client: Socket): Promise<DeviceSocketData | null> {
    const data = await this.resolveSocketData(client);
    return data?.kind === 'device' ? data : null;
  }
}
