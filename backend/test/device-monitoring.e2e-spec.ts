import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { io, Socket } from 'socket.io-client';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ApprovalStatus, User, UserDocument } from '../src/schemas/user.schema';
import {
  MachineType,
  MachineTypeDocument,
} from '../src/schemas/machine-type.schema';
import { Machine, MachineDocument } from '../src/schemas/machine.schema';
import { Telemetry, TelemetryDocument } from '../src/schemas/telemetry.schema';
import {
  FaultEvent,
  FaultEventDocument,
  FaultEventSeverity,
} from '../src/schemas/fault-event.schema';
import { WorkOrder, WorkOrderDocument } from '../src/schemas/work-order.schema';
import { SecureSocketIoAdapter } from '../src/config/secure-socket-io.adapter';
import { LiveMonitoringGateway } from '../src/device-monitoring/live-monitoring.gateway';

function subscribeMachine(
  socket: Socket,
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    socket
      .timeout(1000)
      .emit(
        'subscribe:machine',
        { machineId: id },
        (error: Error | null, response?: { ok: boolean; error?: string }) => {
          if (error) resolve({ ok: false, error: 'timeout' });
          else resolve(response ?? { ok: false });
        },
      );
  });
}

function waitForNoEvent(socket: Socket, eventName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, onEvent);
      resolve();
    }, 150);
    const onEvent = () => {
      clearTimeout(timer);
      reject(new Error(`unexpected ${eventName} event`));
    };
    socket.once(eventName, onEvent);
  });
}

describe('Device registration, REST device-gateway ingestion, and role-scoped live status (e2e)', () => {
  let mongo: MongoMemoryReplSet;
  let app: INestApplication<App>;
  let jwtService: JwtService;
  let connection: Connection;
  let users: Model<UserDocument>;
  let machineTypes: Model<MachineTypeDocument>;
  let machines: Model<MachineDocument>;
  let telemetryModel: Model<TelemetryDocument>;
  let faultEventModel: Model<FaultEventDocument>;
  let workOrders: Model<WorkOrderDocument>;
  let gateway: LiveMonitoringGateway;
  let httpUrl: string;

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
    process.env.CORS_ORIGINS = 'http://allowed.example';
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
    app.useWebSocketAdapter(
      new SecureSocketIoAdapter(app, {
        allowedOrigins: ['http://allowed.example'],
        nodeEnv: 'test',
      }),
    );
    await app.listen(0);
    httpUrl = await app.getUrl();

    jwtService = app.get(JwtService);
    gateway = app.get(LiveMonitoringGateway);
    connection = app.get(getConnectionToken());
    users = app.get(getModelToken(User.name));
    machineTypes = app.get(getModelToken(MachineType.name));
    machines = app.get(getModelToken(Machine.name));
    telemetryModel = app.get(getModelToken(Telemetry.name));
    faultEventModel = app.get(getModelToken(FaultEvent.name));
    workOrders = app.get(getModelToken(WorkOrder.name));
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
    await Promise.all([
      telemetryModel.syncIndexes(),
      faultEventModel.syncIndexes(),
    ]);

    const machineType = await machineTypes.create({
      type_id: 1,
      name: 'Device E2E machine type',
    });
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
      assigned_machine_ids: [machineA._id],
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

    await workOrders.create({
      ot_id: 'LIVE-TECH-A',
      machine_id: machineA._id,
      status: 'open',
      date_created: new Date(),
    });

    adminToken = tokenFor(admin);
    technicianToken = tokenFor(technician);
    operatorToken = tokenFor(operator);
  }

  function connectLiveSocket(
    token: string,
    origin = 'http://allowed.example',
  ): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(`${httpUrl}/live`, {
        transports: ['websocket'],
        auth: { token },
        extraHeaders: { Origin: origin },
        reconnection: false,
        forceNew: true,
      });
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  }

  function expectConnectError(
    token: string,
    origin = 'http://allowed.example',
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = io(`${httpUrl}/live`, {
        transports: ['websocket'],
        auth: { token },
        extraHeaders: { Origin: origin },
        reconnection: false,
        forceNew: true,
        timeout: 1000,
      });
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.disconnect();
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(() => {
        finish(new Error('socket rejection timed out'));
      }, 1000);
      socket.once('connect', () => {
        socket.once('socket:error', () => finish());
        socket.once('disconnect', () => finish());
      });
      socket.once('connect_error', () => finish());
    });
  }

  async function createFaultEvent(
    machineId: string,
    codePanne: string,
  ): Promise<FaultEventDocument> {
    return faultEventModel.create({
      device_id: new Types.ObjectId(),
      machine_id: new Types.ObjectId(machineId),
      code_panne: codePanne,
      severity: FaultEventSeverity.CRITICAL,
      message: 'Synthetic e2e fault',
      raised_at: new Date(),
    });
  }

  describe('device registration (Admin only)', () => {
    it('rejects registration from a non-admin role', async () => {
      await request(app.getHttpServer())
        .post('/devices')
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({
          device_id: 'REST-1',
          machine_id: machineAId,
          device_type: 'simulator',
        })
        .expect(403);
    });

    it('rejects registration with no auth at all', async () => {
      await request(app.getHttpServer())
        .post('/devices')
        .send({
          device_id: 'REST-1',
          machine_id: machineAId,
          device_type: 'simulator',
        })
        .expect(401);
    });

    let deviceMongoId: string;
    let apiKey: string;
    const deviceId = 'REST-1';

    it('lets an Admin register a device and returns the raw API key exactly once', async () => {
      const response = await request(app.getHttpServer())
        .post('/devices')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          device_id: deviceId,
          machine_id: machineAId,
          device_type: 'simulator',
        })
        .expect(201);

      expect(response.body.apiKey).toEqual(expect.any(String));
      expect(response.body.device.device_id).toBe(deviceId);
      // api_key_hash is never serialized at all (Device schema's toJSON
      // transform strips it) — nothing to compare against the raw key.
      expect(response.body.device.api_key_hash).toBeUndefined();
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
      expect(status.body.latestTelemetry.metrics).toEqual({
        temperature: 64.2,
        vibration: 0.03,
      });
    });

    it('accepts a fault event, and it appears as an active alarm', async () => {
      await request(app.getHttpServer())
        .post('/device-gateway/fault')
        .set('x-device-id', deviceId)
        .set('x-device-key', apiKey)
        .send({
          code_panne: 'E-REST-1',
          severity: 'critical',
          message: 'Overheat',
        })
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
      const faultEvent = await faultEventModel
        .findOne({ code_panne: 'E-REST-1' })
        .exec();
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
      const faultEvent = await faultEventModel
        .findOne({ code_panne: 'E-REST-1' })
        .exec();
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
      const machineIds = response.body.map(
        (entry: { machineId: string }) => entry.machineId,
      );
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
        expect.objectContaining({
          hasDevice: false,
          online: false,
          activeAlarmCount: 0,
        }),
      );
    });

    it('rejects unauthenticated access to live-monitoring endpoints', async () => {
      await request(app.getHttpServer())
        .get('/live-monitoring/machines')
        .expect(401);
    });
  });

  describe('role-scoped fault resolution', () => {
    it('rejects malformed fault identifiers without exposing fault details', async () => {
      const response = await request(app.getHttpServer())
        .patch('/live-monitoring/faults/not-an-object-id/resolve')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);

      expect(JSON.stringify(response.body)).not.toContain(machineAId);
      expect(JSON.stringify(response.body)).not.toContain(machineBId);
    });

    it('rejects forged resolution body fields through DTO validation', async () => {
      const fault = await createFaultEvent(machineAId, 'E-FORGED-BODY');

      await request(app.getHttpServer())
        .patch(`/live-monitoring/faults/${fault._id.toString()}/resolve`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          machine_id: machineBId,
          resolved_by: new Types.ObjectId().toHexString(),
          resolved_at: new Date().toISOString(),
          status: 'resolved',
        })
        .expect(400);

      const stored = await faultEventModel.findById(fault._id).exec();
      expect(stored?.resolved_at).toBeUndefined();
      expect(stored?.resolved_by).toBeUndefined();
    });

    it('lets an Operator resolve a fault only on an assigned machine', async () => {
      const accessibleFault = await createFaultEvent(
        machineAId,
        'E-OP-ACCESSIBLE',
      );
      const inaccessibleFault = await createFaultEvent(
        machineBId,
        'E-OP-INACCESSIBLE',
      );
      const machineBSubscriber = await connectLiveSocket(adminToken);
      await subscribeMachine(machineBSubscriber, machineBId);
      const noDeniedResolutionEvent = waitForNoEvent(
        machineBSubscriber,
        'fault:resolved',
      );

      const resolvedResponse = await request(app.getHttpServer())
        .patch(
          `/live-monitoring/faults/${accessibleFault._id.toString()}/resolve`,
        )
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      expect(resolvedResponse.body.machine_id).toBe(machineAId);
      expect(resolvedResponse.body.resolved_at).toEqual(expect.any(String));
      expect(resolvedResponse.body.resolved_by).toEqual(expect.any(String));

      const deniedResponse = await request(app.getHttpServer())
        .patch(
          `/live-monitoring/faults/${inaccessibleFault._id.toString()}/resolve`,
        )
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(403);

      expect(JSON.stringify(deniedResponse.body)).not.toContain(machineBId);
      expect(deniedResponse.body.message).not.toContain(machineBId);
      expect(deniedResponse.body.message).not.toContain(
        inaccessibleFault._id.toString(),
      );
      await expect(noDeniedResolutionEvent).resolves.toBeUndefined();
      machineBSubscriber.disconnect();

      const storedDeniedFault = await faultEventModel
        .findById(inaccessibleFault._id)
        .exec();
      expect(storedDeniedFault?.resolved_at).toBeUndefined();
      expect(storedDeniedFault?.resolved_by).toBeUndefined();
    });

    it('rejects disabled, pending, rejected, and unverified users before mutating a fault', async () => {
      const restrictedUsers = await users.create([
        {
          user_id: 'OP-DISABLED-FAULT',
          nom_complet: 'Disabled Fault Operator',
          email: 'fault-disabled@example.test',
          password: 'x',
          role: 'operator',
          is_active: false,
          is_verified: true,
          approval_status: ApprovalStatus.APPROVED,
          assigned_machine_ids: [new Types.ObjectId(machineAId)],
        },
        {
          user_id: 'OP-PENDING-FAULT',
          nom_complet: 'Pending Fault Operator',
          email: 'fault-pending@example.test',
          password: 'x',
          role: 'operator',
          is_active: true,
          is_verified: true,
          approval_status: ApprovalStatus.PENDING,
          assigned_machine_ids: [new Types.ObjectId(machineAId)],
        },
        {
          user_id: 'OP-REJECTED-FAULT',
          nom_complet: 'Rejected Fault Operator',
          email: 'fault-rejected@example.test',
          password: 'x',
          role: 'operator',
          is_active: true,
          is_verified: true,
          approval_status: ApprovalStatus.REJECTED,
          assigned_machine_ids: [new Types.ObjectId(machineAId)],
        },
        {
          user_id: 'OP-UNVERIFIED-FAULT',
          nom_complet: 'Unverified Fault Operator',
          email: 'fault-unverified@example.test',
          password: 'x',
          role: 'operator',
          is_active: true,
          is_verified: false,
          approval_status: ApprovalStatus.APPROVED,
          assigned_machine_ids: [new Types.ObjectId(machineAId)],
        },
      ]);
      const fault = await createFaultEvent(machineAId, 'E-ACCOUNT-STATE');

      for (const user of restrictedUsers) {
        await request(app.getHttpServer())
          .patch(`/live-monitoring/faults/${fault._id.toString()}/resolve`)
          .set('Authorization', `Bearer ${tokenFor(user)}`)
          .expect(403);
      }

      const stored = await faultEventModel.findById(fault._id).exec();
      expect(stored?.resolved_at).toBeUndefined();
      expect(stored?.resolved_by).toBeUndefined();
    });

    it('permits exactly one winner when two authorized callers resolve concurrently', async () => {
      const fault = await createFaultEvent(machineAId, 'E-CONCURRENT');
      const machineASubscriber = await connectLiveSocket(adminToken);
      await subscribeMachine(machineASubscriber, machineAId);
      const resolvedEvents: Array<Record<string, unknown>> = [];
      machineASubscriber.on('fault:resolved', (payload) => {
        resolvedEvents.push(payload as Record<string, unknown>);
      });

      const [adminResult, technicianResult] = await Promise.all([
        request(app.getHttpServer())
          .patch(`/live-monitoring/faults/${fault._id.toString()}/resolve`)
          .set('Authorization', `Bearer ${adminToken}`),
        request(app.getHttpServer())
          .patch(`/live-monitoring/faults/${fault._id.toString()}/resolve`)
          .set('Authorization', `Bearer ${technicianToken}`),
      ]);

      const statuses = [adminResult.status, technicianResult.status].sort(
        (a, b) => a - b,
      );
      expect(statuses).toEqual([200, 409]);

      const stored = await faultEventModel.findById(fault._id).exec();
      expect(stored?.resolved_at).toBeInstanceOf(Date);
      expect(stored?.resolved_by).toBeDefined();
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(resolvedEvents).toHaveLength(1);
      expect(resolvedEvents[0]).toEqual(
        expect.objectContaining({
          id: fault._id.toString(),
          machineId: machineAId,
          resolvedAt: expect.any(String),
        }),
      );
      machineASubscriber.disconnect();
    });
  });

  describe('live WebSocket origin, authentication, and room isolation', () => {
    it('accepts the configured origin and rejects an untrusted origin', async () => {
      const socket = await connectLiveSocket(adminToken);
      socket.disconnect();

      await expect(
        expectConnectError(adminToken, 'https://attacker.example'),
      ).resolves.toBeUndefined();
    });

    it('rejects missing, malformed, and expired user access tokens', async () => {
      await expect(expectConnectError('')).resolves.toBeUndefined();
      await expect(expectConnectError('not-a-jwt')).resolves.toBeUndefined();

      const expired = jwtService.sign(
        { sub: new Types.ObjectId().toString(), role: 'operator' },
        { expiresIn: '-1s' },
      );
      await expect(expectConnectError(expired)).resolves.toBeUndefined();
    });

    it('allows operator, technician, and admin sockets to subscribe only through canonical machine access', async () => {
      const operator = await connectLiveSocket(operatorToken);
      const technician = await connectLiveSocket(technicianToken);
      const admin = await connectLiveSocket(adminToken);

      await expect(subscribeMachine(operator, machineAId)).resolves.toEqual({
        ok: true,
      });
      await expect(subscribeMachine(operator, machineBId)).resolves.toEqual({
        ok: false,
        error: 'SOCKET_ACCESS_DENIED',
      });
      await expect(subscribeMachine(technician, machineAId)).resolves.toEqual({
        ok: true,
      });
      await expect(subscribeMachine(technician, machineBId)).resolves.toEqual({
        ok: false,
        error: 'SOCKET_ACCESS_DENIED',
      });
      await expect(subscribeMachine(admin, machineBId)).resolves.toEqual({
        ok: true,
      });

      operator.disconnect();
      technician.disconnect();
      admin.disconnect();
    });

    it('delivers machine-specific events only to subscribers of that generated machine room', async () => {
      const machineASubscriber = await connectLiveSocket(operatorToken);
      const machineBSubscriber = await connectLiveSocket(adminToken);
      await subscribeMachine(machineASubscriber, machineAId);
      await subscribeMachine(machineBSubscriber, machineBId);

      const received = new Promise<Record<string, unknown>>((resolve) => {
        machineASubscriber.once('telemetry', resolve);
      });
      const noLeak = waitForNoEvent(machineBSubscriber, 'telemetry');

      gateway.emitTelemetry(machineAId, {
        deviceId: 'DEV-A',
        metrics: { temperature: 42 },
      });

      await expect(received).resolves.toEqual(
        expect.objectContaining({
          machineId: machineAId,
          metrics: { temperature: 42 },
        }),
      );
      await expect(noLeak).resolves.toBeUndefined();

      machineASubscriber.disconnect();
      machineBSubscriber.disconnect();
    });
  });

  describe('bounded retention', () => {
    it('declares a TTL index on telemetry.received_at', async () => {
      const indexes = await telemetryModel.collection.indexes();
      const ttlIndex = indexes.find(
        (index) => index.name === 'telemetry_retention_ttl',
      );
      expect(ttlIndex).toBeDefined();
      expect(ttlIndex?.expireAfterSeconds).toBeGreaterThan(0);
    });

    it('declares a partial TTL index on fault_event.received_at that exempts unresolved (active) alarms', async () => {
      const indexes = await faultEventModel.collection.indexes();
      const ttlIndex = indexes.find(
        (index) => index.name === 'fault_event_retention_ttl',
      );
      expect(ttlIndex).toBeDefined();
      expect(ttlIndex?.expireAfterSeconds).toBeGreaterThan(0);
      expect(ttlIndex?.partialFilterExpression).toEqual({
        resolved_at: { $exists: true },
      });
    });
  });
});
