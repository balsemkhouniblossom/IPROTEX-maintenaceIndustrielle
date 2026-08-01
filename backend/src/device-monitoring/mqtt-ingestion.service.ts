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
import { DeviceConnectionStatus } from '../schemas/device.schema';

const TELEMETRY_TOPIC = 'devices/+/telemetry';
const HEARTBEAT_TOPIC = 'devices/+/heartbeat';
const FAULT_TOPIC = 'devices/+/fault';

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
    const segments = topic.split('/');
    if (segments.length !== 3 || segments[0] !== 'devices') {
      this.logger.warn(`Ignoring message on unrecognized topic: ${topic}`);
      return;
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
      return;
    }

    const apiKey = typeof body.api_key === 'string' ? body.api_key : undefined;
    if (!apiKey) {
      this.logger.warn(`Message on topic ${topic} is missing api_key`);
      return;
    }

    const device = await this.deviceAuthService
      .verifyCredentials(deviceId, apiKey)
      .catch(() => null);
    if (!device) {
      this.logger.warn(
        `Rejected MQTT message from unauthenticated device "${deviceId}"`,
      );
      return;
    }

    const machineId = String(device.machine_id);

    if (kind === 'heartbeat') {
      const { cameOnline } =
        await this.telemetryIngestionService.recordHeartbeat(device);
      if (cameOnline) {
        this.liveMonitoringGateway.emitStatusChange(machineId, {
          deviceId: device.device_id,
          status: DeviceConnectionStatus.ONLINE,
          lastSeenAt: new Date().toISOString(),
        });
      }
      return;
    }

    if (kind === 'telemetry') {
      const metrics = (body.metrics ?? {}) as Record<string, number>;
      const { record, cameOnline } =
        await this.telemetryIngestionService.recordTelemetry(device, {
          metrics,
          recordedAt:
            typeof body.recorded_at === 'string'
              ? new Date(body.recorded_at)
              : undefined,
        });
      this.liveMonitoringGateway.emitTelemetry(machineId, {
        deviceId: device.device_id,
        metrics: record.metrics,
        recordedAt: record.recorded_at.toISOString(),
      });
      if (cameOnline) {
        this.liveMonitoringGateway.emitStatusChange(machineId, {
          deviceId: device.device_id,
          status: DeviceConnectionStatus.ONLINE,
          lastSeenAt: new Date().toISOString(),
        });
      }
      return;
    }

    if (kind === 'fault') {
      const { record, cameOnline } =
        await this.telemetryIngestionService.recordFault(device, {
          codePanne: typeof body.code_panne === 'string' ? body.code_panne : '',
          severity: body.severity as never,
          message: typeof body.message === 'string' ? body.message : undefined,
          raisedAt:
            typeof body.raised_at === 'string'
              ? new Date(body.raised_at)
              : undefined,
        });
      this.liveMonitoringGateway.emitFault(machineId, {
        id: String(record._id),
        deviceId: device.device_id,
        codePanne: record.code_panne,
        severity: record.severity,
        message: record.message,
        raisedAt: record.raised_at.toISOString(),
      });
      if (cameOnline) {
        this.liveMonitoringGateway.emitStatusChange(machineId, {
          deviceId: device.device_id,
          status: DeviceConnectionStatus.ONLINE,
          lastSeenAt: new Date().toISOString(),
        });
      }
      return;
    }

    this.logger.warn(`Unrecognized topic kind "${kind}" on topic ${topic}`);
  }
}
