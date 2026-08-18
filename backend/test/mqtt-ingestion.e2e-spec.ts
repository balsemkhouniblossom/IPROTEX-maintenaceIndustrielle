import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { AddressInfo, createServer, Server as NetServer } from 'node:net';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import Aedes from 'aedes';
import * as mqtt from 'mqtt';
import { AppModule } from './../src/app.module';
import {
  MachineType,
  MachineTypeDocument,
} from '../src/schemas/machine-type.schema';
import { Machine, MachineDocument } from '../src/schemas/machine.schema';
import {
  Device,
  DeviceDocument,
  DeviceType,
  DeviceConnectionStatus,
} from '../src/schemas/device.schema';
import { Telemetry, TelemetryDocument } from '../src/schemas/telemetry.schema';
import {
  FaultEvent,
  FaultEventDocument,
} from '../src/schemas/fault-event.schema';
import { DeviceAuthService } from '../src/device-monitoring/device-auth.service';

async function waitUntil(
  check: () => Promise<boolean>,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for condition');
}

describe('MQTT device ingestion (integration)', () => {
  // This suite spins up a real, embedded MQTT broker (aedes) and connects
  // the application's actual MqttIngestionService to it — no mocking of
  // the MQTT transport itself. A second, independent `mqtt` client plays
  // the role of the physical device/simulator, publishing exactly the way
  // a real OpenPLC bridge or simulator would.
  let broker: Aedes;
  let brokerNetServer: NetServer;
  let brokerPort: number;
  let mongo: MongoMemoryReplSet;
  let app: INestApplication;
  let connection: Connection;
  let machineTypes: Model<MachineTypeDocument>;
  let machines: Model<MachineDocument>;
  let devices: Model<DeviceDocument>;
  let telemetryModel: Model<TelemetryDocument>;
  let faultEventModel: Model<FaultEventDocument>;
  let deviceAuthService: DeviceAuthService;

  let machineId: string;
  let device: DeviceDocument;
  let rawApiKey: string;
  let simulatorClient: mqtt.MqttClient;

  beforeAll(async () => {
    // 1. Start the embedded broker first so its port is known before the
    // app boots — MqttIngestionService reads MQTT_BROKER_URL exactly once,
    // at module-init time.
    broker = new Aedes();
    brokerNetServer = createServer(broker.handle);
    await new Promise<void>((resolve) =>
      brokerNetServer.listen(0, '127.0.0.1', resolve),
    );
    brokerPort = (brokerNetServer.address() as AddressInfo).port;

    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'e2e-test-jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'e2e-test-refresh-secret';
    process.env.EMAIL_VERIFICATION_SECRET = 'e2e-test-email-secret';
    process.env.MQTT_BROKER_URL = `mqtt://127.0.0.1:${brokerPort}`;

    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.MONGODB_URI = mongo.getUri('gmao_mqtt_e2e');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    connection = app.get(getConnectionToken());
    machineTypes = app.get(getModelToken(MachineType.name));
    machines = app.get(getModelToken(Machine.name));
    devices = app.get(getModelToken(Device.name));
    telemetryModel = app.get(getModelToken(Telemetry.name));
    faultEventModel = app.get(getModelToken(FaultEvent.name));
    deviceAuthService = app.get(DeviceAuthService);

    await connection.dropDatabase();

    const machineType = await machineTypes.create({
      type_id: 1,
      name: 'MQTT E2E machine type',
    });
    const machine = await machines.create({
      machine_id: 'MACHINE-MQTT',
      type_id: machineType._id,
      serial_no: 'MQTT-001',
      status: 'active',
    });
    machineId = machine._id.toString();

    const generated = await deviceAuthService.generateApiKey();
    rawApiKey = generated.rawKey;
    device = await devices.create({
      device_id: 'PLC-MQTT-1',
      machine_id: machine._id,
      device_type: DeviceType.SIMULATOR,
      api_key_hash: generated.keyHash,
      key_prefix: generated.keyPrefix,
      heartbeat_interval_seconds: 30,
    });

    // Give the app's own MqttIngestionService time to connect + subscribe
    // to the broker before the simulator starts publishing (mqtt.connect()
    // in onModuleInit() is fire-and-forget, not awaited by app.init()).
    await waitUntil(async () => broker.connectedClients >= 1, 5000);
    await new Promise((resolve) => setTimeout(resolve, 500));

    simulatorClient = mqtt.connect(`mqtt://127.0.0.1:${brokerPort}`, {
      clientId: 'device-simulator',
    });
    await new Promise<void>((resolve, reject) => {
      simulatorClient.once('connect', () => resolve());
      simulatorClient.once('error', reject);
    });
  }, 60_000);

  afterAll(async () => {
    if (simulatorClient) {
      await new Promise<void>((resolve) =>
        simulatorClient.end(true, {}, () => resolve()),
      );
    }
    await connection?.dropDatabase();
    await app?.close();
    await new Promise<void>((resolve) =>
      brokerNetServer.close(() => resolve()),
    );
    // Closing the net.Server alone leaves aedes's own internal timers/state
    // alive (that's what made the very first version of this suite hang at
    // process exit) — the broker instance itself must be closed too.
    await new Promise<void>((resolve) => broker.close(() => resolve()));
    await mongo?.stop();
  }, 30_000);

  function publish(
    topic: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      simulatorClient.publish(
        topic,
        JSON.stringify(body),
        { qos: 1 },
        (error) => {
          if (error) reject(error);
          else resolve();
        },
      );
    });
  }

  it('rejects a heartbeat published with no api_key: the device never comes online', async () => {
    await publish(`devices/${device.device_id}/heartbeat`, {});
    await new Promise((resolve) => setTimeout(resolve, 500));

    const fresh = await devices.findById(device._id).exec();
    expect(fresh?.last_seen_at).toBeUndefined();
  });

  it('rejects a heartbeat published with the wrong api_key', async () => {
    await publish(`devices/${device.device_id}/heartbeat`, {
      api_key: 'wrong.key',
    });
    await new Promise((resolve) => setTimeout(resolve, 500));

    const fresh = await devices.findById(device._id).exec();
    expect(fresh?.last_seen_at).toBeUndefined();
  });

  it('marks the device online after a correctly authenticated heartbeat over MQTT', async () => {
    await publish(`devices/${device.device_id}/heartbeat`, {
      api_key: rawApiKey,
    });

    await waitUntil(async () => {
      const fresh = await devices.findById(device._id).exec();
      return fresh?.last_known_status === DeviceConnectionStatus.ONLINE;
    });

    const fresh = await devices.findById(device._id).exec();
    expect(fresh?.last_seen_at).toBeInstanceOf(Date);
  });

  it('persists a telemetry sample published over MQTT, scoped to the device and its machine', async () => {
    await publish(`devices/${device.device_id}/telemetry`, {
      api_key: rawApiKey,
      metrics: { temperature: 78.5, rpm: 1500 },
    });

    await waitUntil(async () => {
      const count = await telemetryModel
        .countDocuments({ device_id: device._id })
        .exec();
      return count > 0;
    });

    const stored = await telemetryModel
      .findOne({ device_id: device._id })
      .exec();
    expect(stored?.machine_id.toString()).toBe(machineId);
    expect(stored?.metrics).toEqual({ temperature: 78.5, rpm: 1500 });
  });

  it('persists a fault event published over MQTT as an active alarm', async () => {
    await publish(`devices/${device.device_id}/fault`, {
      api_key: rawApiKey,
      code_panne: 'E-MQTT-1',
      severity: 'critical',
      message: 'Overheat detected',
    });

    await waitUntil(async () => {
      const count = await faultEventModel
        .countDocuments({ code_panne: 'E-MQTT-1' })
        .exec();
      return count > 0;
    });

    const stored = await faultEventModel
      .findOne({ code_panne: 'E-MQTT-1' })
      .exec();
    expect(stored?.resolved_at).toBeUndefined();
    expect(stored?.severity).toBe('critical');
    expect(stored?.machine_id.toString()).toBe(machineId);
  });

  it('drops a message on a topic for a device that does not exist, without throwing', async () => {
    await publish('devices/NONEXISTENT-DEVICE/heartbeat', {
      api_key: rawApiKey,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    // No assertion needed beyond "the app is still responsive" — proven by
    // the next test still being able to talk to it.
    const fresh = await devices.findById(device._id).exec();
    expect(fresh).not.toBeNull();
  });
});
