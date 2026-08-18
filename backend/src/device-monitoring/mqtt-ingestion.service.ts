import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mqtt from 'mqtt';
import { DeviceAuthService } from './device-auth.service';
import { TelemetryIngestionService } from './telemetry-ingestion.service';
import { LiveMonitoringGateway } from './live-monitoring.gateway';
import {
  DeviceConnectionStatus,
  DeviceDocument,
} from '../schemas/device.schema';

const TELEMETRY_TOPIC = 'devices/+/telemetry';
const HEARTBEAT_TOPIC = 'devices/+/heartbeat';
const FAULT_TOPIC = 'devices/+/fault';

interface ParsedMqttMessage {
  deviceId: string;
  kind: string;
  body: Record<string, unknown>;
}

/**
 * Bridges an external MQTT broker (a real broker an OpenPLC gateway or
 * simulator publishes to, e.g. Mosquitto) into the same
 * `TelemetryIngestionService` used by the REST and WebSocket device
 * transports. Topics are `devices/{deviceId}/{heartbeat|telemetry|fault}`;
 * every message must carry the device's credentials in its JSON body
 * (`api_key`) because MQTT topic subscription alone proves nothing about
 * who published a message — the same `DeviceAuthService.verifyCredentials`
 * used by the REST guard and the WebSocket gateway is the actual security
 * boundary here too.
 *
 * Entirely optional infrastructure: with no `MQTT_BROKER_URL` configured
 * the service simply never connects, so the app runs identically with or
 * without a broker available (dev/test never need one running).
 */
@Injectable()
export class MqttIngestionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttIngestionService.name);
  private client?: mqtt.MqttClient;

  constructor(
    private readonly configService: ConfigService,
    private readonly deviceAuthService: DeviceAuthService,
    private readonly telemetryIngestionService: TelemetryIngestionService,
    private readonly liveMonitoringGateway: LiveMonitoringGateway,
  ) {}

  onModuleInit(): void {
    const brokerUrl = this.configService.get<string>('MQTT_BROKER_URL')?.trim();
    if (!brokerUrl) {
      this.logger.log(
        'MQTT ingestion disabled (no MQTT_BROKER_URL configured)',
      );
      return;
    }
    this.connect(brokerUrl);
  }

  onModuleDestroy(): void {
    this.client?.end(true);
  }

  private connect(brokerUrl: string): void {
    this.client = mqtt.connect(brokerUrl, {
      reconnectPeriod: 5000,
      connectTimeout: 10000,
    });

    this.client.on('connect', () => {
      this.logger.log(`Connected to MQTT broker at ${brokerUrl}`);
      this.client?.subscribe(
        [TELEMETRY_TOPIC, HEARTBEAT_TOPIC, FAULT_TOPIC],
        (err) => {
          if (err)
            this.logger.error(
              `Failed to subscribe to device topics: ${err.message}`,
            );
        },
      );
    });

    this.client.on('message', (topic, payload) => {
      void this.handleMessage(topic, payload);
    });

    this.client.on('error', (error) => {
      this.logger.warn(`MQTT client error: ${error.message}`);
    });
  }

  /**
   * Exposed as a standalone async method (rather than only living inside
   * the `'message'` event handler) so it can be exercised directly —
   * against a real embedded broker in integration tests, or with a
   * hand-built topic/payload in unit tests — without needing a live
   * network connection either way.
   */
  async handleMessage(topic: string, payloadBuffer: Buffer): Promise<void> {
    const parsed = this.parseMessage(topic, payloadBuffer);
    if (!parsed) return;

    const device = await this.authenticateDevice(parsed);
    if (!device) return;

    await this.dispatchMessage(parsed.kind, parsed.body, device, topic);
  }

  private parseMessage(
    topic: string,
    payloadBuffer: Buffer,
  ): ParsedMqttMessage | null {
    const segments = topic.split('/');
    if (segments.length !== 3 || segments[0] !== 'devices') {
      this.logger.warn(`Ignoring message on unrecognized topic: ${topic}`);
      return null;
    }
    const [, deviceId, kind] = segments;

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(payloadBuffer.toString('utf8')) as Record<
        string,
        unknown
      >;
    } catch {
      this.logger.warn(`Malformed JSON payload on topic ${topic}`);
      return null;
    }

    return { deviceId, kind, body };
  }

  private async authenticateDevice(
    message: ParsedMqttMessage,
  ): Promise<DeviceDocument | null> {
    const apiKey =
      typeof message.body.api_key === 'string'
        ? message.body.api_key
        : undefined;
    if (!apiKey) {
      this.logger.warn(
        `Message from device "${message.deviceId}" is missing api_key`,
      );
      return null;
    }

    const device = await this.deviceAuthService
      .verifyCredentials(message.deviceId, apiKey)
      .catch(() => null);
    if (!device) {
      this.logger.warn(
        `Rejected MQTT message from unauthenticated device "${message.deviceId}"`,
      );
      return null;
    }

    return device;
  }

  private async dispatchMessage(
    kind: string,
    body: Record<string, unknown>,
    device: DeviceDocument,
    topic: string,
  ): Promise<void> {
    if (kind === 'heartbeat') {
      await this.handleHeartbeat(device);
      return;
    }
    if (kind === 'telemetry') {
      await this.handleTelemetry(device, body);
      return;
    }
    if (kind === 'fault') {
      await this.handleFault(device, body);
      return;
    }

    this.logger.warn(`Unrecognized topic kind "${kind}" on topic ${topic}`);
  }

  private async handleHeartbeat(device: DeviceDocument): Promise<void> {
    const { cameOnline } =
      await this.telemetryIngestionService.recordHeartbeat(device);
    this.emitOnlineStatusIfNeeded(device, cameOnline);
  }

  private async handleTelemetry(
    device: DeviceDocument,
    body: Record<string, unknown>,
  ): Promise<void> {
    const metrics = (body.metrics ?? {}) as Record<string, number>;
    const { record, cameOnline } =
      await this.telemetryIngestionService.recordTelemetry(device, {
        metrics,
        recordedAt: optionalDate(body.recorded_at),
      });
    const machineId = String(device.machine_id);
    this.liveMonitoringGateway.emitTelemetry(machineId, {
      deviceId: device.device_id,
      metrics: record.metrics,
      recordedAt: record.recorded_at.toISOString(),
    });
    this.emitOnlineStatusIfNeeded(device, cameOnline);
  }

  private async handleFault(
    device: DeviceDocument,
    body: Record<string, unknown>,
  ): Promise<void> {
    const { record, cameOnline } =
      await this.telemetryIngestionService.recordFault(device, {
        codePanne: typeof body.code_panne === 'string' ? body.code_panne : '',
        severity: body.severity as never,
        message: typeof body.message === 'string' ? body.message : undefined,
        raisedAt: optionalDate(body.raised_at),
      });
    const machineId = String(device.machine_id);
    this.liveMonitoringGateway.emitFault(machineId, {
      id: String(record._id),
      deviceId: device.device_id,
      codePanne: record.code_panne,
      severity: record.severity,
      message: record.message,
      raisedAt: record.raised_at.toISOString(),
    });
    this.emitOnlineStatusIfNeeded(device, cameOnline);
  }

  private emitOnlineStatusIfNeeded(
    device: DeviceDocument,
    cameOnline: boolean,
  ): void {
    if (!cameOnline) return;

    this.liveMonitoringGateway.emitStatusChange(String(device.machine_id), {
      deviceId: device.device_id,
      status: DeviceConnectionStatus.ONLINE,
      lastSeenAt: new Date().toISOString(),
    });
  }
}

function optionalDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  return new Date(value);
}
