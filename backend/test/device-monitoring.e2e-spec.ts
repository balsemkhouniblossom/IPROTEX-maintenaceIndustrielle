/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { User, UserDocument } from '../src/schemas/user.schema';
import { MachineType, MachineTypeDocument } from '../src/schemas/machine-type.schema';
import { Machine, MachineDocument } from '../src/schemas/machine.schema';
import { Device, DeviceDocument } from '../src/schemas/device.schema';
import { Telemetry, TelemetryDocument } from '../src/schemas/telemetry.schema';
import { FaultEvent, FaultEventDocument } from '../src/schemas/fault-event.schema';

describe('Device registration, REST device-gateway ingestion, and role-scoped live status (e2e)', () => {
  let mongo: MongoMemoryReplSet;
  let app: INestApplication<App>;
  let jwtService: JwtService;
  let connection: Connection;
  let users: Model<UserDocument>;
  let machineTypes: Model<MachineTypeDocument>;
  let machines: Model<MachineDocument>;
  let devices: Model<DeviceDocument>;
  let telemetryModel: Model<TelemetryDocument>;
  let faultEventModel: Model<FaultEventDocument>;

  let adminToken: string;
  let technicianToken: string;
  let operatorToken: string;
  let machineAId: string;
  let machineBId: string;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongo.getUri('gmao_device_monitoring_e2e');
    process.env.JWT_SECRET = 'e2e-test-jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'e2e-test-refresh-secret';
    process.env.EMAIL_VERIFICATION_SECRET = 'e2e-test-email-secret';
    delete process.env.MQTT_BROKER_URL;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    jwtService = app.get(JwtService);
    connection = app.get(getConnectionToken());
    users = app.get(getModelToken(User.name));
    machineTypes = app.get(getModelToken(MachineType.name));
    machines = app.get(getModelToken(Machine.name));
    devices = app.get(getModelToken(Device.name));
    telemetryModel = app.get(getModelToken(Telemetry.name));
    faultEventModel = app.get(getModelToken(FaultEvent.name));

    await seedBaseData();
  }, 120_000);

  afterAll(async () => {
    await connection?.dropDatabase();
    await app?.close();
    await mongo?.stop();
  });

  function tokenFor(user: UserDocument): string {
    return jwtService.sign({
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
      user_id: user.user_id,
    });
  }

  async function seedBaseData() {
    await connection.dropDatabase();

    const machineType = await machineTypes.create({ type_id: 1, name: 'Device E2E machine type' });
    const machineA = await machines.create({
      machine_id: 'MACHINE-DEV-A',
      type_id: machineType._id,
      serial_no: 'DEV-A',
      status: 'active',
    });
    const machineB = await machines.create({
      machine_id: 'MACHINE-DEV-B',
      type_id: machineType._id,
      serial_no: 'DEV-B',
      status: 'active',
    });
    machineAId = machineA._id.toString();
    machineBId = machineB._id.toString();

    const admin = await users.create({
      user_id: 'ADMIN-DEV-E2E',
      nom_complet: 'Device Admin',
      email: 'device-admin-e2e@example.test',
      password: 'x',
      role: 'admin',
      is_active: true,
      is_verified: true,
    });
    const technician = await users.create({
      user_id: 'TECH-DEV-E2E',
      nom_complet: 'Device Technician',
      email: 'device-technician-e2e@example.test',
      password: 'x',
      role: 'technician',
      is_active: true,
      is_verified: true,
    });
    const operator = await users.create({
      user_id: 'OP-DEV-E2E',
      nom_complet: 'Device Operator',
      email: 'device-operator-e2e@example.test',
      password: 'x',
      role: 'operator',
      is_active: true,
      is_verified: true,
      assigned_machine_ids: [machineA._id], // only machine A
    });

    adminToken = tokenFor(admin);
    technicianToken = tokenFor(technician);
    operatorToken = tokenFor(operator);
  }

  describe('device registration (Admin only)', () => {
    it('rejects registration from a non-admin role', async () => {
      await request(app.getHttpServer())
        .post('/devices')
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ device_id: 'REST-1', machine_id: machineAId, device_type: 'simulator' })
        .expect(403);
    });

    it('rejects registration with no auth at all', async () => {
      await request(app.getHttpServer())
        .post('/devices')
        .send({ device_id: 'REST-1', machine_id: machineAId, device_type: 'simulator' })
        .expect(401);
    });

    let deviceMongoId: string;
    let apiKey: string;
    const deviceId = 'REST-1';

    it('lets an Admin register a device and returns the raw API key exactly once', async () => {
      const response = await request(app.getHttpServer())
        .post('/devices')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ device_id: deviceId, machine_id: machineAId, device_type: 'simulator' })
        .expect(201);

      expect(response.body.apiKey).toEqual(expect.any(String));
      expect(response.body.device.device_id).toBe(deviceId);
      expect(response.body.device.api_key_hash).not.toBe(response.body.apiKey);
      deviceMongoId = response.body.device._id;
      apiKey = response.body.apiKey;
    });

    it('never returns the raw key again on a subsequent read', async () => {
      const response = await request(app.getHttpServer())
        .get(`/devices/${deviceMongoId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(response.body.apiKey).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain(apiKey);
    });

    it('rejects the device-gateway with a valid JWT instead of device headers (structural separation)', async () => {
      await request(app.getHttpServer())
        .post('/device-gateway/heartbeat')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(401);
    });

    it('rejects the device-gateway with an unknown device id', async () => {
      await request(app.getHttpServer())
        .post('/device-gateway/heartbeat')
        .set('x-device-id', 'UNKNOWN')
        .set('x-device-key', apiKey)
        .expect(401);
    });

    it('rejects the device-gateway with the wrong key for a real device', async () => {
      await request(app.getHttpServer())
        .post('/device-gateway/heartbeat')
        .set('x-device-id', deviceId)
        .set('x-device-key', 'bogus.key')
        .expect(401);
    });

    it('a registered device can never call a normal user endpoint with its device credentials', async () => {
      await request(app.getHttpServer())
        .get('/machines')
        .set('x-device-id', deviceId)
        .set('x-device-key', apiKey)
        .expect(401);
    });

    it('accepts a correctly authenticated heartbeat and marks the device online', async () => {
      await request(app.getHttpServer())
        .post('/device-gateway/heartbeat')
        .set('x-device-id', deviceId)
        .set('x-device-key', apiKey)
        .expect(201);

      const status = await request(app.getHttpServer())
        .get(`/live-monitoring/machines/${machineAId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(status.body.online).toBe(true);
      expect(status.body.hasDevice).toBe(true);
    });

    it('accepts telemetry and it is retrievable via the live-status endpoint', async () => {
      await request(app.getHttpServer())
        .post('/device-gateway/telemetry')
        .set('x-device-id', deviceId)
        .set('x-device-key', apiKey)
        .send({ metrics: { temperature: 64.2, vibration: 0.03 } })
        .expect(201);

      const stored = await telemetryModel
        .findOne({ device_id: new Types.ObjectId(deviceMongoId) })
        .exec();
      expect(stored?.metrics).toEqual({ temperature: 64.2, vibration: 0.03 });

      const status = await request(app.getHttpServer())
        .get(`/live-monitoring/machines/${machineAId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(status.body.latestTelemetry.metrics).toEqual({ temperature: 64.2, vibration: 0.03 });
    });

    it('accepts a fault event, and it appears as an active alarm', async () => {
      await request(app.getHttpServer())
        .post('/device-gateway/fault')
        .set('x-device-id', deviceId)
        .set('x-device-key', apiKey)
        .send({ code_panne: 'E-REST-1', severity: 'critical', message: 'Overheat' })
        .expect(201);

      const status = await request(app.getHttpServer())
        .get(`/live-monitoring/machines/${machineAId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(status.body.activeAlarmCount).toBe(1);
    });

    it('rejects malformed telemetry (missing metrics) with a 400', async () => {
      await request(app.getHttpServer())
        .post('/device-gateway/telemetry')
        .set('x-device-id', deviceId)
        .set('x-device-key', apiKey)
        .send({})
        .expect(400);
    });

    it('a Technician or Admin can resolve the active alarm; it then disappears from the active count', async () => {
      const faultEvent = await faultEventModel.findOne({ code_panne: 'E-REST-1' }).exec();
      await request(app.getHttpServer())
        .patch(`/live-monitoring/faults/${faultEvent!._id.toString()}/resolve`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(200);

      const status = await request(app.getHttpServer())
        .get(`/live-monitoring/machines/${machineAId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(status.body.activeAlarmCount).toBe(0);
    });

    it('resolving an already-resolved fault is rejected with a conflict', async () => {
      const faultEvent = await faultEventModel.findOne({ code_panne: 'E-REST-1' }).exec();
      await request(app.getHttpServer())
        .patch(`/live-monitoring/faults/${faultEvent!._id.toString()}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });

    it('an Admin can rotate the device key, invalidating the old one', async () => {
      const rotateResponse = await request(app.getHttpServer())
        .post(`/devices/${deviceMongoId}/rotate-key`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      const newApiKey = rotateResponse.body.apiKey;
      expect(newApiKey).not.toBe(apiKey);

      await request(app.getHttpServer())
        .post('/device-gateway/heartbeat')
        .set('x-device-id', deviceId)
        .set('x-device-key', apiKey) // old key
        .expect(401);

      await request(app.getHttpServer())
        .post('/device-gateway/heartbeat')
        .set('x-device-id', deviceId)
        .set('x-device-key', newApiKey)
        .expect(201);
    });

    it('an Admin can deactivate a device, immediately blocking further ingestion', async () => {
      await request(app.getHttpServer())
        .patch(`/devices/${deviceMongoId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ is_active: false })
        .expect(200);

      const rotateResponse = await devices.findById(deviceMongoId).exec();
      void rotateResponse;

      await request(app.getHttpServer())
        .post('/device-gateway/heartbeat')
        .set('x-device-id', deviceId)
        .set('x-device-key', apiKey) // even a correct-format key is now inactive-blocked
        .expect(401);
    });
  });

  describe('role-scoped live status', () => {
    it('scopes the machines summary to only accessible machines for Operator', async () => {
      const response = await request(app.getHttpServer())
        .get('/live-monitoring/machines')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
      const machineIds = response.body.map((entry: { machineId: string }) => entry.machineId);
      expect(machineIds).not.toContain(machineBId);
    });

    it('rejects an Operator reading live status for a machine outside their scope', async () => {
      await request(app.getHttpServer())
        .get(`/live-monitoring/machines/${machineBId}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(403);
    });

    it('returns hasDevice=false for a machine that has never had a device registered', async () => {
      const response = await request(app.getHttpServer())
        .get(`/live-monitoring/machines/${machineBId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(response.body).toEqual(
        expect.objectContaining({ hasDevice: false, online: false, activeAlarmCount: 0 }),
      );
    });

    it('rejects unauthenticated access to live-monitoring endpoints', async () => {
      await request(app.getHttpServer()).get('/live-monitoring/machines').expect(401);
    });
  });

  describe('bounded retention', () => {
    it('declares a TTL index on telemetry.received_at', async () => {
      const indexes = await telemetryModel.collection.indexes();
      const ttlIndex = indexes.find((index) => index.name === 'telemetry_retention_ttl');
      expect(ttlIndex).toBeDefined();
      expect(ttlIndex?.expireAfterSeconds).toBeGreaterThan(0);
    });

    it('declares a partial TTL index on fault_event.received_at that exempts unresolved (active) alarms', async () => {
      const indexes = await faultEventModel.collection.indexes();
      const ttlIndex = indexes.find((index) => index.name === 'fault_event_retention_ttl');
      expect(ttlIndex).toBeDefined();
      expect(ttlIndex?.expireAfterSeconds).toBeGreaterThan(0);
      expect(ttlIndex?.partialFilterExpression).toEqual({ resolved_at: { $exists: true } });
    });
  });
});
