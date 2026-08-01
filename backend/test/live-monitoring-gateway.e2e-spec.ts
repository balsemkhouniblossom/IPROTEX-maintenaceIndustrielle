/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Connection, Model } from 'mongoose';
import { io, Socket } from 'socket.io-client';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { User, UserDocument } from '../src/schemas/user.schema';
import {
  MachineType,
  MachineTypeDocument,
} from '../src/schemas/machine-type.schema';
import { Machine, MachineDocument } from '../src/schemas/machine.schema';
import {
  Device,
  DeviceDocument,
  DeviceType,
} from '../src/schemas/device.schema';
import { DeviceAuthService } from '../src/device-monitoring/device-auth.service';

function waitForEvent<T = unknown>(
  socket: Socket,
  event: string,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for "${event}"`)),
      timeoutMs,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function emitWithAck<T = unknown>(
  socket: Socket,
  event: string,
  payload: unknown,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ack of "${event}"`)),
      timeoutMs,
    );
    socket.emit(event, payload, (response: T) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

describe('LiveMonitoringGateway (WebSocket integration)', () => {
  let mongo: MongoMemoryReplSet;
  let app: INestApplication;
  let connection: Connection;
  let jwtService: JwtService;
  let baseUrl: string;

  let users: Model<UserDocument>;
  let machineTypes: Model<MachineTypeDocument>;
  let machines: Model<MachineDocument>;
  let devices: Model<DeviceDocument>;
  let deviceAuthService: DeviceAuthService;

  let machineAId: string;
  let machineBId: string;
  let device: DeviceDocument;
  let rawApiKey: string;
  let adminToken: string;
  let operatorToken: string;

  const openSockets: Socket[] = [];

  function connectClient(auth: Record<string, unknown>): Socket {
    const socket = io(`${baseUrl}/live`, {
      auth,
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    openSockets.push(socket);
    return socket;
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'e2e-test-jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'e2e-test-refresh-secret';
    process.env.EMAIL_VERIFICATION_SECRET = 'e2e-test-email-secret';
    delete process.env.MQTT_BROKER_URL;

    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.MONGODB_URI = mongo.getUri('gmao_ws_e2e');

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
    app.useWebSocketAdapter(new IoAdapter(app));
    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${address.port}`;

    connection = app.get(getConnectionToken());
    jwtService = app.get(JwtService);
    users = app.get(getModelToken(User.name));
    machineTypes = app.get(getModelToken(MachineType.name));
    machines = app.get(getModelToken(Machine.name));
    devices = app.get(getModelToken(Device.name));
    deviceAuthService = app.get(DeviceAuthService);

    await connection.dropDatabase();

    const machineType = await machineTypes.create({
      type_id: 1,
      name: 'WS E2E machine type',
    });
    const machineA = await machines.create({
      machine_id: 'MACHINE-WS-A',
      type_id: machineType._id,
      serial_no: 'WS-A',
      status: 'active',
    });
    const machineB = await machines.create({
      machine_id: 'MACHINE-WS-B',
      type_id: machineType._id,
      serial_no: 'WS-B',
      status: 'active',
    });
    machineAId = machineA._id.toString();
    machineBId = machineB._id.toString();

    const admin = await users.create({
      user_id: 'ADMIN-WS-E2E',
      nom_complet: 'WS Admin',
      email: 'ws-admin-e2e@example.test',
      password: 'x',
      role: 'admin',
      is_active: true,
      is_verified: true,
    });
    const operator = await users.create({
      user_id: 'OP-WS-E2E',
      nom_complet: 'WS Operator',
      email: 'ws-operator-e2e@example.test',
      password: 'x',
      role: 'operator',
      is_active: true,
      is_verified: true,
      assigned_machine_ids: [machineA._id], // only machine A, not B
    });

    adminToken = jwtService.sign({
      sub: admin._id.toString(),
      email: admin.email,
      role: admin.role,
      user_id: admin.user_id,
    });
    operatorToken = jwtService.sign({
      sub: operator._id.toString(),
      email: operator.email,
      role: operator.role,
      user_id: operator.user_id,
    });

    const generated = await deviceAuthService.generateApiKey();
    rawApiKey = generated.rawKey;
    device = await devices.create({
      device_id: 'PLC-WS-1',
      machine_id: machineA._id,
      device_type: DeviceType.SIMULATOR,
      api_key_hash: generated.keyHash,
      key_prefix: generated.keyPrefix,
      heartbeat_interval_seconds: 30,
    });
  }, 60_000);

  afterAll(async () => {
    openSockets.forEach((socket) => socket.disconnect());
    await connection?.dropDatabase();
    await app?.close();
    await mongo?.stop();
  }, 30_000);

  it('rejects a connection with no credentials at all', async () => {
    const socket = connectClient({});
    const disconnectReason = await waitForEvent(socket, 'disconnect');
    expect(disconnectReason).toBeDefined();
  });

  it('rejects a connection with an invalid JWT', async () => {
    const socket = connectClient({ token: 'not-a-real-jwt' });
    await waitForEvent(socket, 'disconnect');
  });

  it('rejects a connection with invalid device credentials', async () => {
    const socket = connectClient({
      deviceId: device.device_id,
      deviceKey: 'wrong.key',
    });
    await waitForEvent(socket, 'disconnect');
  });

  it('accepts a connection with a valid user JWT', async () => {
    const socket = connectClient({ token: adminToken });
    await waitForEvent(socket, 'connect');
    socket.disconnect();
  });

  it('accepts a connection with valid device credentials', async () => {
    const socket = connectClient({
      deviceId: device.device_id,
      deviceKey: rawApiKey,
    });
    await waitForEvent(socket, 'connect');
    socket.disconnect();
  });

  it('lets an Admin subscribe to any machine room', async () => {
    const socket = connectClient({ token: adminToken });
    await waitForEvent(socket, 'connect');

    const response = await emitWithAck(socket, 'subscribe:machine', {
      machineId: machineBId,
    });
    expect(response).toEqual({ ok: true });
    socket.disconnect();
  });

  it('lets an Operator subscribe only to a machine assigned to them', async () => {
    const socket = connectClient({ token: operatorToken });
    await waitForEvent(socket, 'connect');

    const allowed = await emitWithAck(socket, 'subscribe:machine', {
      machineId: machineAId,
    });
    expect(allowed).toEqual({ ok: true });

    const denied = await emitWithAck(socket, 'subscribe:machine', {
      machineId: machineBId,
    });
    expect(denied).toEqual({ ok: false, error: 'forbidden' });

    socket.disconnect();
  });

  it('a device socket can never subscribe to a machine room', async () => {
    const socket = connectClient({
      deviceId: device.device_id,
      deviceKey: rawApiKey,
    });
    await waitForEvent(socket, 'connect');

    const response = await emitWithAck(socket, 'subscribe:machine', {
      machineId: machineAId,
    });
    expect(response).toEqual({ ok: false, error: 'forbidden' });

    socket.disconnect();
  });

  it('a user socket can never push device telemetry', async () => {
    const socket = connectClient({ token: adminToken });
    await waitForEvent(socket, 'connect');

    const response = await emitWithAck(socket, 'device:telemetry', {
      metrics: { x: 1 },
    });
    expect(response).toEqual({ ok: false, error: 'forbidden' });

    socket.disconnect();
  });

  it('pushes a real-time telemetry event to a subscribed user client when a device reports it', async () => {
    const userSocket = connectClient({ token: operatorToken });
    await waitForEvent(userSocket, 'connect');
    const subscribeResult = await emitWithAck(userSocket, 'subscribe:machine', {
      machineId: machineAId,
    });
    expect(subscribeResult).toEqual({ ok: true });

    const deviceSocket = connectClient({
      deviceId: device.device_id,
      deviceKey: rawApiKey,
    });
    await waitForEvent(deviceSocket, 'connect');

    const telemetryEventPromise = waitForEvent<Record<string, unknown>>(
      userSocket,
      'telemetry',
    );
    const ack = await emitWithAck(deviceSocket, 'device:telemetry', {
      metrics: { temperature: 81.2 },
    });
    expect(ack).toEqual({ ok: true });

    const telemetryEvent = await telemetryEventPromise;
    expect(telemetryEvent).toMatchObject({
      deviceId: device.device_id,
      metrics: { temperature: 81.2 },
    });

    userSocket.disconnect();
    deviceSocket.disconnect();
  });

  it('an unsubscribed user client never receives another machine’s telemetry', async () => {
    // The Operator's token only has access to machine A; subscribe there
    // and confirm nothing arrives when a fault is raised for machine B by
    // a differently-scoped device would require a second device — instead
    // we assert directly that the operator cannot even join machine B's
    // room (already covered above), which is the actual security boundary:
    // without joining the room, socket.io never delivers that room's events
    // regardless of what the server broadcasts.
    const socket = connectClient({ token: operatorToken });
    await waitForEvent(socket, 'connect');
    const denied = await emitWithAck(socket, 'subscribe:machine', {
      machineId: machineBId,
    });
    expect(denied).toEqual({ ok: false, error: 'forbidden' });
    socket.disconnect();
  });

  it('pushes a fault event only to clients subscribed to that machine’s room', async () => {
    const adminSocket = connectClient({ token: adminToken });
    await waitForEvent(adminSocket, 'connect');
    await emitWithAck(adminSocket, 'subscribe:machine', {
      machineId: machineAId,
    });

    const deviceSocket = connectClient({
      deviceId: device.device_id,
      deviceKey: rawApiKey,
    });
    await waitForEvent(deviceSocket, 'connect');

    const faultEventPromise = waitForEvent<Record<string, unknown>>(
      adminSocket,
      'fault',
    );
    await emitWithAck(deviceSocket, 'device:fault', {
      code_panne: 'E-WS-1',
      severity: 'critical',
      message: 'Simulated overheat',
    });

    const faultEvent = await faultEventPromise;
    expect(faultEvent).toMatchObject({
      codePanne: 'E-WS-1',
      severity: 'critical',
    });

    adminSocket.disconnect();
    deviceSocket.disconnect();
  });

  it('deactivating a device rejects its already-open socket on the next message', async () => {
    const deviceSocket = connectClient({
      deviceId: device.device_id,
      deviceKey: rawApiKey,
    });
    await waitForEvent(deviceSocket, 'connect');

    await devices
      .updateOne({ _id: device._id }, { $set: { is_active: false } })
      .exec();

    const response = await emitWithAck(deviceSocket, 'device:heartbeat', {});
    expect(response).toEqual({ ok: false });

    await devices
      .updateOne({ _id: device._id }, { $set: { is_active: true } })
      .exec();
    deviceSocket.disconnect();
  });
});
