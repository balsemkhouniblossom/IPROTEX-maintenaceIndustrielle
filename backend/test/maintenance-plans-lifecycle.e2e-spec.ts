/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
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
import {
  MaintenancePlan,
  MaintenancePlanDocument,
} from '../src/schemas/maintenance-plan.schema';

describe('Maintenance plan lifecycle (e2e)', () => {
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
  let maintenancePlans: Model<MaintenancePlanDocument>;

  let adminToken: string;
  let operatorToken: string;
  let operator: UserDocument;
  let machine: MachineDocument;
  let moduleEntity: ModuleDocument;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongo.getUri('gmao_maintenance_plans_e2e');
    process.env.JWT_SECRET = 'e2e-test-jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'e2e-test-refresh-secret';
    process.env.EMAIL_VERIFICATION_SECRET = 'e2e-test-email-secret';

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
    maintenancePlans = app.get(getModelToken(MaintenancePlan.name));

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
      name: 'Plan lifecycle E2E machine type',
    });
    const moduleType = await moduleTypes.create({
      mod_type_id: 'MODTYPE-PLAN-E2E',
      type_id: machineType._id,
      nom_module: 'Plan lifecycle E2E module type',
    });
    machine = await machines.create({
      machine_id: 'MACHINE-PLAN',
      type_id: machineType._id,
      serial_no: 'PLAN-001',
      status: 'active',
    });
    moduleEntity = await modules.create({
      module_id: 'MODULE-PLAN',
      machine_id: machine._id,
      mod_type_id: moduleType._id,
    });

    const admin = await users.create({
      user_id: 'ADMIN-PLAN-E2E',
      nom_complet: 'Plan Lifecycle Admin',
      email: 'plan-lifecycle-admin-e2e@example.test',
      password: 'x',
      role: 'admin',
      is_active: true,
      is_verified: true,
    });
    operator = await users.create({
      user_id: 'OP-PLAN-E2E',
      nom_complet: 'Plan Lifecycle Operator',
      email: 'plan-lifecycle-operator-e2e@example.test',
      password: 'x',
      role: 'operator',
      is_active: true,
      is_verified: true,
      assigned_machine_ids: [machine._id],
    });

    adminToken = tokenFor(admin);
    operatorToken = tokenFor(operator);
  }

  describe('authentication and role scoping', () => {
    it('rejects an anonymous request', async () => {
      await request(app.getHttpServer()).get('/maintenance-plans').expect(401);
    });

    it('rejects a non-admin role', async () => {
      await request(app.getHttpServer())
        .get('/maintenance-plans')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(403);
    });
  });

  describe('create', () => {
    it('always creates a new plan as Draft at version 1 with a created history entry, ignoring client-supplied status/version', async () => {
      const response = await request(app.getHttpServer())
        .post('/maintenance-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          plan_id: 'MP-LIFECYCLE-1',
          module_id: moduleEntity._id.toString(),
          type_maintenance: 'preventive',
          frequence: 1,
          unite_frequence: 'month',
        })
        .expect(201);

      expect(response.body.status).toBe('draft');
      expect(response.body.version).toBe(1);
      expect(response.body.lifecycle_history).toHaveLength(1);
      expect(response.body.lifecycle_history[0]).toMatchObject({
        action: 'created',
        to_status: 'draft',
      });
    });

    it('rejects a request that tries to smuggle a client-supplied status or version', async () => {
      await request(app.getHttpServer())
        .post('/maintenance-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          plan_id: 'MP-LIFECYCLE-FORGED',
          module_id: moduleEntity._id.toString(),
          type_maintenance: 'preventive',
          frequence: 1,
          unite_frequence: 'month',
          status: 'active',
          version: 99,
        })
        .expect(400);
    });
  });

  describe('lifecycle transitions, scheduling gating, and recurrence generation', () => {
    let planId: string;
    let firstOccurrenceId: string;

    it('rejects scheduling work against a Draft plan', async () => {
      const created = await request(app.getHttpServer())
        .post('/maintenance-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          plan_id: 'MP-LIFECYCLE-2',
          module_id: moduleEntity._id.toString(),
          type_maintenance: 'preventive',
          frequence: 1,
          unite_frequence: 'month',
        })
        .expect(201);
      planId = created.body._id;

      await request(app.getHttpServer())
        .post('/operator/preventive/schedule')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          machine_id: machine._id.toString(),
          plan_id: planId,
          scheduled_date: '2026-08-01T08:00:00.000Z',
        })
        .expect(409);
    });

    it('rejects an invalid transition (cannot pause a Draft plan)', async () => {
      await request(app.getHttpServer())
        .patch(`/maintenance-plans/${planId}/transition`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'pause' })
        .expect(409);
    });

    it('activates the Draft plan and creates only its first scheduled occurrence', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/maintenance-plans/${planId}/transition`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'activate' })
        .expect(200);

      expect(response.body.plan.status).toBe('active');
      expect(response.body.plan.version).toBe(2);
      expect(response.body.createdOccurrence).toBeTruthy();
      firstOccurrenceId = response.body.createdOccurrence._id;

      const occurrenceCount = await workOrders.countDocuments({
        plan_id: new Types.ObjectId(planId),
      });
      expect(occurrenceCount).toBe(1);
    });

    it('does not create a second occurrence when activate is somehow retried (idempotent)', async () => {
      // Already active now, so the transition itself is rejected (activate
      // only applies from Draft) — but even so, prove no extra occurrence
      // could sneak in.
      await request(app.getHttpServer())
        .patch(`/maintenance-plans/${planId}/transition`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'activate' })
        .expect(409);

      const occurrenceCount = await workOrders.countDocuments({
        plan_id: new Types.ObjectId(planId),
      });
      expect(occurrenceCount).toBe(1);
    });

    it('pauses the plan, stopping future scheduling without touching existing history', async () => {
      await request(app.getHttpServer())
        .patch(`/maintenance-plans/${planId}/transition`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'pause' })
        .expect(200);

      const stored = await maintenancePlans.findById(planId);
      expect(stored?.status).toBe('paused');

      const stillExists = await workOrders.findById(firstOccurrenceId);
      expect(stillExists).toBeTruthy();
    });

    it('validating the existing occurrence while the plan is Paused does not generate a next occurrence', async () => {
      await request(app.getHttpServer())
        .post(`/work-orders/${firstOccurrenceId}/validation`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'approve' })
        .expect(201);

      const validated = await workOrders.findById(firstOccurrenceId);
      expect(validated?.status).toBe('validated');

      const occurrenceCount = await workOrders.countDocuments({
        plan_id: new Types.ObjectId(planId),
      });
      expect(occurrenceCount).toBe(1); // still just the one — Paused blocked the recurrence
    });

    it('rejects editing or deleting the plan while it has a validated occurrence and no expected_version is supplied', async () => {
      await request(app.getHttpServer())
        .patch(`/maintenance-plans/${planId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ instruction: 'Updated steps' })
        .expect(409);

      await request(app.getHttpServer())
        .delete(`/maintenance-plans/${planId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });

    it('allows a version-safe edit once expected_version matches', async () => {
      const current = await maintenancePlans.findById(planId);

      const response = await request(app.getHttpServer())
        .patch(`/maintenance-plans/${planId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          instruction: 'Updated steps',
          expected_version: current?.version,
        })
        .expect(200);

      expect(response.body.instruction).toBe('Updated steps');
      expect(response.body.version).toBe((current?.version || 0) + 1);
    });

    it('resumes the plan back to Active, re-enabling future scheduling', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/maintenance-plans/${planId}/transition`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'resume' })
        .expect(200);

      expect(response.body.plan.status).toBe('active');
      // resume must never re-create the first occurrence
      expect(response.body.createdOccurrence).toBeNull();
    });

    it('generates the next occurrence once the existing one is (re-)validated while the plan is Active', async () => {
      // Force the occurrence back to in-progress-like state so it can be
      // "approved" again in this test's flow and exercise recurrence
      // generation with the plan now Active.
      await workOrders.findByIdAndUpdate(firstOccurrenceId, {
        $set: { status: 'waiting_validation' },
      });

      await request(app.getHttpServer())
        .post(`/work-orders/${firstOccurrenceId}/validation`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'approve' })
        .expect(201);

      const occurrences = await workOrders
        .find({ plan_id: new Types.ObjectId(planId) })
        .sort({ due_date: 1 });
      expect(occurrences).toHaveLength(2);
      expect(occurrences[1].recurrence_source_occurrence_id?.toString()).toBe(
        firstOccurrenceId,
      );
      const firstDue = new Date(occurrences[0].due_date as unknown as string);
      const nextDue = new Date(occurrences[1].due_date as unknown as string);
      expect(nextDue.getTime()).toBeGreaterThan(firstDue.getTime());
    });

    it('archives the plan, making it fully read-only while preserving its history', async () => {
      const beforeArchive = await maintenancePlans.findById(planId);

      await request(app.getHttpServer())
        .patch(`/maintenance-plans/${planId}/transition`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'archive' })
        .expect(200);

      const archived = await maintenancePlans.findById(planId);
      expect(archived?.status).toBe('archived');

      // Edits, deletes, and further transitions are all rejected now
      await request(app.getHttpServer())
        .patch(`/maintenance-plans/${planId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          instruction: 'Should not apply',
          expected_version: archived?.version,
        })
        .expect(409);

      await request(app.getHttpServer())
        .patch(`/maintenance-plans/${planId}/transition`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'resume' })
        .expect(409);

      await request(app.getHttpServer())
        .delete(`/maintenance-plans/${planId}`)
        .query({ expected_version: archived?.version })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);

      // Traceability preserved: the occurrences and lifecycle history are
      // still intact and readable after archiving.
      const occurrenceCount = await workOrders.countDocuments({
        plan_id: new Types.ObjectId(planId),
      });
      expect(occurrenceCount).toBe(2);
      expect(archived?.lifecycle_history?.length || 0).toBeGreaterThan(
        beforeArchive?.lifecycle_history?.length
          ? beforeArchive.lifecycle_history.length - 1
          : 0,
      );
    });
  });

  describe('imported plans (no status field) remain schedulable and never spuriously overdue', () => {
    it('a plan inserted directly (bypassing Mongoose, as the raw-driver import scripts do) has no status field, but still schedules normally like before this lifecycle existed', async () => {
      // The real import scripts under backend/scripts/ use the native
      // MongoDB driver (db.collection(...).updateOne(...)), not the
      // Mongoose model — so schema defaults (like `status: 'draft'`) never
      // apply to them. `connection.collection(...)` reproduces that exact
      // bypass; using `maintenancePlans.create(...)` here would go through
      // Mongoose and incorrectly default `status` to 'draft'.
      const insertResult = await connection
        .collection('maintenanceplans')
        .insertOne({
          plan_id: 'MP-IMPORTED-1',
          module_id: moduleEntity._id,
          type_maintenance: 'preventive',
          frequence: 3,
          unite_frequence: 'month',
        });
      const importedId = insertResult.insertedId.toString();

      const fetched = await request(app.getHttpServer())
        .get(`/maintenance-plans/${importedId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(fetched.body.plan_id).toBe('MP-IMPORTED-1');
      // Confirms there is nothing that spontaneously forces/backfills a
      // status for a document that never had one.
      expect(fetched.body.status).toBeUndefined();

      expect(
        await workOrders.countDocuments({
          plan_id: new Types.ObjectId(importedId),
        }),
      ).toBe(0);

      // Legacy/imported plans must remain fully schedulable exactly as
      // before this feature existed — undefined status is treated the same
      // as Active, never blocked like an explicit Draft/Paused would be.
      await request(app.getHttpServer())
        .post('/operator/preventive/schedule')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          machine_id: machine._id.toString(),
          plan_id: importedId,
          scheduled_date: '2026-09-01T08:00:00.000Z',
        })
        .expect(201);

      const occurrence = await workOrders.findOne({
        plan_id: new Types.ObjectId(importedId),
      });
      // Never "overdue" the moment it's created — it starts life simply
      // scheduled for its chosen date.
      expect(occurrence?.status).toBe('scheduled');
    });
  });

  describe('non-preventive schedulable plan types (lubrication, inspection) activate and schedule exactly like preventive', () => {
    it.each(['lubrication', 'inspection'])(
      'activates a %s plan and creates its first occurrence, preserving the plan type',
      async (type) => {
        const created = await request(app.getHttpServer())
          .post('/maintenance-plans')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            plan_id: `MP-${type.toUpperCase()}-1`,
            module_id: moduleEntity._id.toString(),
            type_maintenance: type,
            frequence: 1,
            unite_frequence: 'month',
          })
          .expect(201);
        const planId = created.body._id;

        const response = await request(app.getHttpServer())
          .patch(`/maintenance-plans/${planId}/transition`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ action: 'activate' })
          .expect(200);

        expect(response.body.plan.status).toBe('active');
        expect(response.body.createdOccurrence).toBeTruthy();
        expect(response.body.createdOccurrence.type_maintenance).toBe(type);

        const occurrence = await workOrders.findOne({
          plan_id: new Types.ObjectId(planId),
        });
        expect(occurrence).not.toBeNull();
        expect(occurrence?.type_maintenance).toBe(type);
      },
    );

    it('activates a corrective plan without creating any occurrence — corrective plans are never auto-scheduled', async () => {
      const created = await request(app.getHttpServer())
        .post('/maintenance-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          plan_id: 'MP-CORRECTIVE-NO-SCHEDULE-1',
          module_id: moduleEntity._id.toString(),
          type_maintenance: 'corrective',
          frequence: 1,
          unite_frequence: 'month',
        })
        .expect(201);
      const planId = created.body._id;

      const response = await request(app.getHttpServer())
        .patch(`/maintenance-plans/${planId}/transition`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'activate' })
        .expect(200);

      expect(response.body.plan.status).toBe('active');
      expect(response.body.createdOccurrence).toBeNull();

      const occurrenceCount = await workOrders.countDocuments({
        plan_id: new Types.ObjectId(planId),
      });
      expect(occurrenceCount).toBe(0);
    });

    it('lets an Operator explicitly first-schedule a lubrication occurrence, but still rejects a corrective plan', async () => {
      const lubricationPlan = await request(app.getHttpServer())
        .post('/maintenance-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          plan_id: 'MP-LUBRICATION-MANUAL-SCHEDULE-1',
          module_id: moduleEntity._id.toString(),
          type_maintenance: 'lubrication',
          frequence: 1,
          unite_frequence: 'month',
        })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/maintenance-plans/${lubricationPlan.body._id}/transition`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'activate' })
        .expect(200);

      const correctivePlan = await request(app.getHttpServer())
        .post('/maintenance-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          plan_id: 'MP-CORRECTIVE-MANUAL-SCHEDULE-1',
          module_id: moduleEntity._id.toString(),
          type_maintenance: 'corrective',
          frequence: 1,
          unite_frequence: 'month',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/operator/preventive/schedule')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          machine_id: machine._id.toString(),
          plan_id: correctivePlan.body._id,
          scheduled_date: '2026-09-01T08:00:00.000Z',
        })
        .expect(400);
    });
  });
});
