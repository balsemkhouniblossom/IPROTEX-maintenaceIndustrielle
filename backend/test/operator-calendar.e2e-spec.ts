import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { User, UserDocument } from '../src/schemas/user.schema';
import {
  MachineType,
  MachineTypeDocument,
} from '../src/schemas/machine-type.schema';
import { Machine, MachineDocument } from '../src/schemas/machine.schema';
import {
  ModuleType,
  ModuleTypeDocument,
} from '../src/schemas/module-type.schema';
import {
  Module as ModuleEntity,
  ModuleDocument,
} from '../src/schemas/module.schema';
import { WorkOrder, WorkOrderDocument } from '../src/schemas/work-order.schema';

describe('Operator calendar (e2e)', () => {
  // A replica set is used here (matching the other Operator transactional
  // features) even though none of these calendar actions open a
  // multi-document transaction themselves; it keeps the fixture consistent
  // with the rest of the Operator e2e suite and costs nothing beyond a
  // slightly slower startup.
  let mongo: MongoMemoryReplSet;
  let app: INestApplication<App>;
  let jwtService: JwtService;
  let connection: Connection;
  let users: Model<UserDocument>;
  let machineTypes: Model<MachineTypeDocument>;
  let machines: Model<MachineDocument>;
  let moduleTypes: Model<ModuleTypeDocument>;
  let modules: Model<ModuleDocument>;
  let workOrders: Model<WorkOrderDocument>;

  let operatorToken: string;
  let otherOperatorToken: string;
  let technicianToken: string;
  let operator: UserDocument;
  let otherOperator: UserDocument;
  let machine: MachineDocument;
  let moduleEntity: ModuleDocument;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongo.getUri('gmao_calendar_e2e');
    process.env.JWT_SECRET = 'e2e-test-jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'e2e-test-refresh-secret';
    process.env.EMAIL_VERIFICATION_SECRET = 'e2e-test-email-secret';
    process.env.BUSINESS_TIMEZONE = 'Africa/Tunis';

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
    moduleTypes = app.get(getModelToken(ModuleType.name));
    modules = app.get(getModelToken(ModuleEntity.name));
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

    const machineType = await machineTypes.create({
      type_id: 1,
      name: 'Calendar E2E machine type',
    });
    const moduleType = await moduleTypes.create({
      mod_type_id: 'MODTYPE-CAL-E2E',
      type_id: machineType._id,
      nom_module: 'Calendar E2E module type',
    });
    machine = await machines.create({
      machine_id: 'MACHINE-CAL',
      type_id: machineType._id,
      serial_no: 'CAL-001',
      status: 'active',
    });
    moduleEntity = await modules.create({
      module_id: 'MODULE-CAL',
      machine_id: machine._id,
      mod_type_id: moduleType._id,
    });

    operator = await users.create({
      user_id: 'OP-CAL-E2E',
      nom_complet: 'Calendar Operator',
      email: 'calendar-operator-e2e@example.test',
      password: 'x',
      role: 'operator',
      is_active: true,
      is_verified: true,
      assigned_machine_ids: [machine._id],
    });
    otherOperator = await users.create({
      user_id: 'OP-CAL-OTHER-E2E',
      nom_complet: 'Other Calendar Operator',
      email: 'calendar-other-operator-e2e@example.test',
      password: 'x',
      role: 'operator',
      is_active: true,
      is_verified: true,
      assigned_machine_ids: [machine._id],
    });
    const technician = await users.create({
      user_id: 'TECH-CAL-E2E',
      nom_complet: 'Calendar Technician',
      email: 'calendar-technician-e2e@example.test',
      password: 'x',
      role: 'technician',
      is_active: true,
      is_verified: true,
    });

    operatorToken = tokenFor(operator);
    otherOperatorToken = tokenFor(otherOperator);
    technicianToken = tokenFor(technician);
  }

  async function createWorkOrderFor(
    ownerId: string | Types.ObjectId,
    overrides: Record<string, unknown> = {},
  ) {
    return workOrders.create({
      ot_id: `WO-CAL-${Date.now()}-${randomUUID()}`,
      machine_id: machine._id,
      module_id: moduleEntity._id,
      technician_id: new Types.ObjectId(ownerId),
      description: 'Calendar E2E task',
      type_maintenance: 'corrective',
      status: 'scheduled',
      priorite: 'medium',
      date_created: new Date(),
      due_date: new Date(),
      ...overrides,
    });
  }

  describe('authentication and role scoping', () => {
    it('rejects an anonymous request for the personal widget', async () => {
      await request(app.getHttpServer())
        .get('/operator/calendar/widget')
        .expect(401);
    });

    it('rejects a technician (Operator-only endpoint)', async () => {
      await request(app.getHttpServer())
        .get('/operator/calendar/widget')
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(403);
    });
  });

  describe('personal widget, notifications, and timeline scoping', () => {
    it('only counts work orders assigned to the authenticated Operator', async () => {
      await createWorkOrderFor(operator._id, {
        due_date: new Date(),
        status: 'scheduled',
      });
      await createWorkOrderFor(otherOperator._id, {
        due_date: new Date(),
        status: 'scheduled',
      });

      const widgetResponse = await request(app.getHttpServer())
        .get('/operator/calendar/widget')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      const otherWidgetResponse = await request(app.getHttpServer())
        .get('/operator/calendar/widget')
        .set('Authorization', `Bearer ${otherOperatorToken}`)
        .expect(200);

      expect(widgetResponse.body.counts.today).toBeGreaterThanOrEqual(1);
      expect(otherWidgetResponse.body.counts.today).toBeGreaterThanOrEqual(1);

      const ownWorkOrderIds = widgetResponse.body.today.map(
        (row: { workOrderId: string }) => row.workOrderId,
      );
      const otherWorkOrderIds = otherWidgetResponse.body.today.map(
        (row: { workOrderId: string }) => row.workOrderId,
      );
      expect(
        ownWorkOrderIds.some((id: string) => otherWorkOrderIds.includes(id)),
      ).toBe(false);
    });

    it('returns notification cards without error for the authenticated Operator', async () => {
      const response = await request(app.getHttpServer())
        .get('/operator/calendar/notifications')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('denies a timeline request filtered by a machine not assigned to the Operator', async () => {
      const unassignedMachine = await machines.create({
        machine_id: `MACHINE-CAL-UNASSIGNED-${Date.now()}`,
        type_id: machine.type_id,
        serial_no: `CAL-UNASSIGNED-${Date.now()}`,
        status: 'active',
      });

      await request(app.getHttpServer())
        .get('/operator/calendar/timeline')
        .query({ machineId: unassignedMachine._id.toString() })
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(403);
    });

    it('returns a scoped timeline for the authenticated Operator', async () => {
      const response = await request(app.getHttpServer())
        .get('/operator/calendar/timeline')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('today');
    });
  });

  describe('event details ownership', () => {
    it('returns 404 for a work order that does not exist', async () => {
      await request(app.getHttpServer())
        .get('/operator/calendar/events/000000000000000000000000')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(404);
    });

    it('returns 403 for a work order assigned to a different operator', async () => {
      const workOrder = await createWorkOrderFor(otherOperator._id);

      await request(app.getHttpServer())
        .get(`/operator/calendar/events/${workOrder._id.toString()}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(403);
    });

    it('returns event details for a work order assigned to the authenticated Operator', async () => {
      const workOrder = await createWorkOrderFor(operator._id);

      const response = await request(app.getHttpServer())
        .get(`/operator/calendar/events/${workOrder._id.toString()}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      expect(response.body.id).toBe(workOrder._id.toString());
    });
  });

  describe('start action', () => {
    it('rejects starting a work order assigned to a different operator', async () => {
      const workOrder = await createWorkOrderFor(otherOperator._id, {
        status: 'scheduled',
      });

      await request(app.getHttpServer())
        .post(`/operator/calendar/events/${workOrder._id.toString()}/start`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(403);
    });

    it('transitions a scheduled work order to in_progress', async () => {
      const workOrder = await createWorkOrderFor(operator._id, {
        status: 'scheduled',
      });

      const response = await request(app.getHttpServer())
        .post(`/operator/calendar/events/${workOrder._id.toString()}/start`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(201);

      expect(response.body.status).toBe('in_progress');
      const stored = await workOrders.findById(workOrder._id);
      expect(stored?.status).toBe('in_progress');
      expect(stored?.date_start).toBeTruthy();
    });

    it('rejects starting a work order that is already in progress (invalid transition)', async () => {
      const workOrder = await createWorkOrderFor(operator._id, {
        status: 'in_progress',
      });

      await request(app.getHttpServer())
        .post(`/operator/calendar/events/${workOrder._id.toString()}/start`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(409);
    });

    it('returns 404 when starting a work order that does not exist', async () => {
      await request(app.getHttpServer())
        .post('/operator/calendar/events/000000000000000000000000/start')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(404);
    });
  });

  describe('complete action', () => {
    it('rejects completing a preventive occurrence, directing it to the dedicated submission endpoint', async () => {
      const workOrder = await createWorkOrderFor(operator._id, {
        type_maintenance: 'preventive',
        status: 'in_progress',
      });

      await request(app.getHttpServer())
        .post(`/operator/calendar/events/${workOrder._id.toString()}/complete`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(409);

      const stored = await workOrders.findById(workOrder._id);
      expect(stored?.status).toBe('in_progress');
    });

    it('rejects completing a corrective work order that has not been started', async () => {
      const workOrder = await createWorkOrderFor(operator._id, {
        status: 'scheduled',
      });

      await request(app.getHttpServer())
        .post(`/operator/calendar/events/${workOrder._id.toString()}/complete`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(409);
    });

    it('rejects completing a work order assigned to a different operator', async () => {
      const workOrder = await createWorkOrderFor(otherOperator._id, {
        status: 'in_progress',
      });

      await request(app.getHttpServer())
        .post(`/operator/calendar/events/${workOrder._id.toString()}/complete`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(403);
    });

    it('moves a started corrective work order to waiting_validation, never straight to completed', async () => {
      const workOrder = await createWorkOrderFor(operator._id, {
        status: 'in_progress',
      });

      const response = await request(app.getHttpServer())
        .post(`/operator/calendar/events/${workOrder._id.toString()}/complete`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(201);

      expect(response.body.status).toBe('waiting_validation');
      const stored = await workOrders.findById(workOrder._id);
      expect(stored?.status).toBe('waiting_validation');
      expect(stored?.date_end).toBeTruthy();
      expect(stored?.execution_date).toBeTruthy();
    });
  });

  describe('reschedule action', () => {
    it('rejects rescheduling a work order assigned to a different operator', async () => {
      const workOrder = await createWorkOrderFor(otherOperator._id, {
        type_maintenance: 'preventive',
        status: 'scheduled',
      });

      await request(app.getHttpServer())
        .patch(
          `/operator/calendar/events/${workOrder._id.toString()}/reschedule`,
        )
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          new_due_date: '2026-09-01T08:00:00.000Z',
          reason: 'Machine unavailable',
        })
        .expect(403);
    });

    it('rejects a request that tries to smuggle a client-supplied identity or status field', async () => {
      const workOrder = await createWorkOrderFor(operator._id, {
        type_maintenance: 'preventive',
        status: 'scheduled',
      });

      await request(app.getHttpServer())
        .patch(
          `/operator/calendar/events/${workOrder._id.toString()}/reschedule`,
        )
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          new_due_date: '2026-09-01T08:00:00.000Z',
          reason: 'Machine unavailable',
          status: 'validated',
          rescheduled_by: '000000000000000000000000',
        })
        .expect(400);

      const stored = await workOrders.findById(workOrder._id);
      expect(stored?.status).toBe('scheduled');
    });

    it('rejects rescheduling a non-preventive occurrence', async () => {
      const workOrder = await createWorkOrderFor(operator._id, {
        type_maintenance: 'corrective',
        status: 'scheduled',
      });

      await request(app.getHttpServer())
        .patch(
          `/operator/calendar/events/${workOrder._id.toString()}/reschedule`,
        )
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          new_due_date: '2026-09-01T08:00:00.000Z',
          reason: 'Machine unavailable',
        })
        .expect(400);
    });

    it('reschedules an assigned preventive occurrence, recording who rescheduled it and why', async () => {
      const workOrder = await createWorkOrderFor(operator._id, {
        type_maintenance: 'preventive',
        status: 'overdue',
        due_date: new Date('2026-07-01T08:00:00.000Z'),
      });

      const response = await request(app.getHttpServer())
        .patch(
          `/operator/calendar/events/${workOrder._id.toString()}/reschedule`,
        )
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          new_due_date: '2026-09-01T08:00:00.000Z',
          reason: 'Machine unavailable',
        })
        .expect(200);

      expect(response.body.occurrence.status).toBe('scheduled');
      const stored = await workOrders.findById(workOrder._id);
      expect(stored?.status).toBe('scheduled');
      expect(new Date(stored!.due_date!).toISOString()).toBe(
        '2026-09-01T08:00:00.000Z',
      );
      expect(stored?.reschedule_reason).toBe('Machine unavailable');
      expect(stored?.rescheduled_by?.toString()).toBe(operator._id.toString());
    });

    it('returns 404 when rescheduling a work order that does not exist', async () => {
      await request(app.getHttpServer())
        .patch('/operator/calendar/events/000000000000000000000000/reschedule')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          new_due_date: '2026-09-01T08:00:00.000Z',
          reason: 'Machine unavailable',
        })
        .expect(404);
    });
  });
});
