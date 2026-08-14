import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as express from 'express';
import { join } from 'node:path';
import { AppModule } from './../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { EmailVerificationTokenService } from '../src/auth/email-verification-token.service';
import { UsersService } from '../src/users/users.service';
import { EmailService } from '../src/email/email.service';
import {
  GoogleLoginExchange,
  GoogleLoginExchangeDocument,
} from '../src/auth/schemas/google-login-exchange.schema';
import { GoogleLoginExchangeService } from '../src/auth/google-login-exchange.service';
import {
  ApprovalStatus,
  Role,
  User,
  UserDocument,
} from '../src/schemas/user.schema';
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
import {
  MaintenancePlan,
  MaintenancePlanDocument,
} from '../src/schemas/maintenance-plan.schema';
import { WorkOrder, WorkOrderDocument } from '../src/schemas/work-order.schema';
import {
  InterventionReport,
  InterventionReportDocument,
} from '../src/schemas/intervention-report.schema';
import {
  DocumentEntity,
  DocumentDocument,
} from '../src/schemas/document.schema';
import { Panne, PanneDocument } from '../src/schemas/panne.schema';
import {
  PanneSolution,
  PanneSolutionDocument,
} from '../src/schemas/panne-solution.schema';

describe('Preventive scheduling lifecycle (e2e)', () => {
  let mongo: MongoMemoryReplSet;
  let app: INestApplication<App>;
  let jwtService: JwtService;
  let authService: AuthService;
  let googleLoginExchangeService: GoogleLoginExchangeService;
  let emailService: EmailService;
  let connection: Connection;
  let users: Model<UserDocument>;
  let machineTypes: Model<MachineTypeDocument>;
  let machines: Model<MachineDocument>;
  let moduleTypes: Model<ModuleTypeDocument>;
  let modules: Model<ModuleDocument>;
  let plans: Model<MaintenancePlanDocument>;
  let workOrders: Model<WorkOrderDocument>;
  let reports: Model<InterventionReportDocument>;
  let documents: Model<DocumentDocument>;
  let pannes: Model<PanneDocument>;
  let panneSolutions: Model<PanneSolutionDocument>;
  let googleLoginExchanges: Model<GoogleLoginExchangeDocument>;
  let operatorToken: string;
  let technicianToken: string;
  let adminToken: string;
  let admin: UserDocument;
  let operator: UserDocument;
  let technician: UserDocument;
  let machineA: MachineDocument;
  let machineB: MachineDocument;
  let moduleA: ModuleDocument;
  let moduleB: ModuleDocument;
  let w1: MaintenancePlanDocument;
  let w2: MaintenancePlanDocument;
  let w7: MaintenancePlanDocument;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongo.getUri('gmao_e2e');
    process.env.JWT_SECRET = 'e2e-test-jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'e2e-test-refresh-secret';
    process.env.EMAIL_VERIFICATION_SECRET = 'e2e-test-email-secret';
    process.env.FILE_STORAGE_DRIVER = 'local';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(
      '/files/uploads/avatars',
      express.static(join(process.cwd(), 'uploads', 'avatars')),
    );
    await app.init();

    jwtService = app.get(JwtService);
    authService = app.get(AuthService);
    googleLoginExchangeService = app.get(GoogleLoginExchangeService);
    emailService = app.get(EmailService);
    connection = app.get(getConnectionToken());
    users = app.get(getModelToken(User.name));
    machineTypes = app.get(getModelToken(MachineType.name));
    machines = app.get(getModelToken(Machine.name));
    moduleTypes = app.get(getModelToken(ModuleType.name));
    modules = app.get(getModelToken(ModuleEntity.name));
    plans = app.get(getModelToken(MaintenancePlan.name));
    workOrders = app.get(getModelToken(WorkOrder.name));
    reports = app.get(getModelToken(InterventionReport.name));
    documents = app.get(getModelToken(DocumentEntity.name));
    pannes = app.get(getModelToken(Panne.name));
    panneSolutions = app.get(getModelToken(PanneSolution.name));
    googleLoginExchanges = app.get(getModelToken(GoogleLoginExchange.name));

    await seedBaseData();
  }, 120_000);

  afterAll(async () => {
    await connection?.dropDatabase();
    await app?.close();
    await mongo?.stop();
  });

  async function seedBaseData() {
    await connection.dropDatabase();
    operator = await users.create({
      user_id: 'OP-E2E',
      nom_complet: 'Operator E2E',
      email: 'operator-e2e@example.test',
      password: 'x',
      role: 'operator',
      is_active: true,
      is_verified: true,
    });
    technician = await users.create({
      user_id: 'TECH-E2E',
      nom_complet: 'Technician E2E',
      email: 'technician-e2e@example.test',
      password: 'x',
      role: 'technician',
      is_active: true,
      is_verified: true,
    });
    admin = await users.create({
      user_id: 'ADMIN-E2E',
      nom_complet: 'Admin E2E',
      email: 'admin-e2e@example.test',
      password: 'x',
      role: 'admin',
      is_active: true,
      is_verified: true,
    });
    operatorToken = jwtService.sign({
      sub: operator._id.toString(),
      email: operator.email,
      role: operator.role,
      user_id: operator.user_id,
    });
    technicianToken = jwtService.sign({
      sub: technician._id.toString(),
      email: technician.email,
      role: technician.role,
      user_id: technician.user_id,
    });
    adminToken = jwtService.sign({
      sub: admin._id.toString(),
      email: admin.email,
      role: admin.role,
      user_id: admin.user_id,
    });
    const machineType = await machineTypes.create({
      type_id: 1,
      name: 'E2E machine type',
    });
    const moduleType = await moduleTypes.create({
      mod_type_id: 'MODTYPE-E2E',
      type_id: machineType._id,
      nom_module: 'E2E module type',
    });
    machineA = await machines.create({
      machine_id: 'MACHINE-A',
      type_id: machineType._id,
      serial_no: 'A-001',
      status: 'active',
    });
    machineB = await machines.create({
      machine_id: 'MACHINE-B',
      type_id: machineType._id,
      serial_no: 'B-001',
      status: 'active',
    });
    await users.findByIdAndUpdate(operator._id, {
      assigned_machine_ids: [machineA._id, machineB._id],
    });
    await users.findByIdAndUpdate(technician._id, {
      assigned_machine_ids: [machineA._id],
    });
    operator = (await users.findById(operator._id)) ?? operator;
    technician = (await users.findById(technician._id)) ?? technician;
    moduleA = await modules.create({
      module_id: 'MODULE-A',
      machine_id: machineA._id,
      mod_type_id: moduleType._id,
    });
    moduleB = await modules.create({
      module_id: 'MODULE-B',
      machine_id: machineB._id,
      mod_type_id: moduleType._id,
    });
    w1 = await plans.create({
      plan_id: 'PLAN-W1-A',
      module_id: moduleA._id,
      type_maintenance: 'preventive',
      frequence: 1,
      unite_frequence: 'monthly',
      maintenance_code: 'W1',
      instruction: 'Check W1 task',
    });
    w2 = await plans.create({
      plan_id: 'PLAN-W2-A',
      module_id: moduleA._id,
      type_maintenance: 'preventive',
      frequence: 1,
      unite_frequence: 'monthly',
      maintenance_code: 'W2',
      instruction: 'Check W2 task',
    });
    w7 = await plans.create({
      plan_id: 'PLAN-W7-A',
      module_id: moduleA._id,
      type_maintenance: 'preventive',
      frequence: 1,
      unite_frequence: 'yearly',
      maintenance_code: 'W7',
      instruction: 'Check W7 task',
    });
    await plans.create({
      plan_id: 'PLAN-W1-B',
      module_id: moduleB._id,
      type_maintenance: 'preventive',
      frequence: 1,
      unite_frequence: 'monthly',
      maintenance_code: 'W1',
      instruction: 'Check W1 task',
    });
  }

  async function performPreventive(
    plan: MaintenancePlanDocument,
    machine: MachineDocument,
    moduleEntity: ModuleDocument,
    executionDate: string,
  ) {
    const orderResponse = await request(app.getHttpServer())
      .post('/work-orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ot_id: `WO-${plan.plan_id}-${executionDate.slice(0, 10)}`,
        machine_id: machine._id.toString(),
        module_id: moduleEntity._id.toString(),
        technician_id: operator._id.toString(),
        plan_id: plan._id.toString(),
        description: plan.instruction,
        type_maintenance: 'preventive',
        status: 'waiting_validation',
        priorite: 'medium',
        date_created: `${executionDate}T12:00:00.000Z`,
        date_start: `${executionDate}T08:00:00.000Z`,
        scheduled_date: `${executionDate}T08:00:00.000Z`,
        due_date: `${executionDate}T08:00:00.000Z`,
        execution_date: `${executionDate}T08:00:00.000Z`,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/intervention-reports')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        report_id: `REP-${plan.plan_id}-${executionDate.slice(0, 10)}`,
        ot_id: orderResponse.body._id,
        technician_id: operator._id.toString(),
        date_debut: `${executionDate}T08:00:00.000Z`,
        date_fin: `${executionDate}T12:00:00.000Z`,
        description_action: plan.instruction,
        etat_final: 'good',
        validation_responsable: 'waiting_validation',
      })
      .expect(201);

    return orderResponse.body as { _id: string };
  }

  it('A: exposes unscheduled W plans without false overdue state', async () => {
    const response = await request(app.getHttpServer())
      .get(`/operator/preventive/states?machineId=${machineA._id.toString()}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);

    const w1State = response.body.sections.preventivePlan.find(
      (item: { plan: { maintenance_code?: string } }) =>
        item.plan.maintenance_code === 'W1',
    );
    expect(w1State.currentState).toBe('not_scheduled');
    expect(response.body.sections.overdue).toHaveLength(0);
    expect(response.body.sections.dueToday).toHaveLength(0);
  });

  it('B: schedules the first intervention without creating a report', async () => {
    await request(app.getHttpServer())
      .post('/operator/preventive/schedule')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        machine_id: machineA._id.toString(),
        plan_id: w1._id.toString(),
        scheduled_date: '2026-08-14T08:00:00.000Z',
      })
      .expect(201);

    const orders = await workOrders.find({
      machine_id: machineA._id,
      plan_id: w1._id,
    });
    expect(orders).toHaveLength(1);
    expect(orders[0].due_date?.toISOString()).toBe('2026-08-14T08:00:00.000Z');
    expect(await reports.countDocuments({ ot_id: orders[0]._id })).toBe(0);

    const calendar = await request(app.getHttpServer())
      .get('/operator/calendar/my?view=month&date=2026-08-01')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    expect(
      calendar.body.items.some(
        (event: { workOrderId: string; dueDate: string }) =>
          event.workOrderId === orders[0]._id.toString() &&
          event.dueDate === '2026-08-14T08:00:00.000Z',
      ),
    ).toBe(true);
  });

  it('G: reschedules without creating a duplicate occurrence', async () => {
    const order = await workOrders.findOne({
      machine_id: machineA._id,
      plan_id: w1._id,
    });
    await request(app.getHttpServer())
      .patch(`/work-orders/${order?._id.toString()}/reschedule`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        new_due_date: '2026-08-20T08:00:00.000Z',
        reason: 'Machine unavailable',
      })
      .expect(200);

    const updated = await workOrders.findById(order?._id);
    expect(updated?.original_due_date?.toISOString()).toBe(
      '2026-08-14T08:00:00.000Z',
    );
    expect(updated?.due_date?.toISOString()).toBe('2026-08-20T08:00:00.000Z');
    expect(updated?.reschedule_reason).toBe('Machine unavailable');
    expect(
      await workOrders.countDocuments({
        machine_id: machineA._id,
        plan_id: w1._id,
      }),
    ).toBe(1);

    const calendar = await request(app.getHttpServer())
      .get('/operator/calendar/my?view=month&date=2026-08-01')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    const event = calendar.body.items.find(
      (item: { workOrderId: string }) =>
        item.workOrderId === order?._id.toString(),
    );
    expect(event.dueDate).toBe('2026-08-20T08:00:00.000Z');
  });

  it('C/D/E: performs today, approves once, and duplicate approval creates one next occurrence', async () => {
    await workOrders.deleteMany({ machine_id: machineA._id, plan_id: w1._id });
    const performed = await performPreventive(
      w1,
      machineA,
      moduleA,
      '2026-07-14',
    );
    expect(
      await workOrders.countDocuments({
        recurrence_source_occurrence_id: performed._id,
      }),
    ).toBe(0);

    await request(app.getHttpServer())
      .post(`/work-orders/${performed._id}/validation`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'approve', technician_id: technician._id.toString() })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/work-orders/${performed._id}/validation`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'approve', technician_id: technician._id.toString() })
      .expect(201);

    const next = await workOrders.find({
      recurrence_source_occurrence_id: new Types.ObjectId(performed._id),
    });
    expect(next).toHaveLength(1);
    expect(next[0].due_date?.toISOString()).toBe('2026-08-14T08:00:00.000Z');

    const julyCalendar = await request(app.getHttpServer())
      .get('/work-orders/calendar/events?view=month&date=2026-07-01')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const augustCalendar = await request(app.getHttpServer())
      .get('/work-orders/calendar/events?view=month&date=2026-08-01')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(
      julyCalendar.body.items.some(
        (event: { workOrderId: string }) => event.workOrderId === performed._id,
      ),
    ).toBe(true);
    expect(
      augustCalendar.body.items.some(
        (event: { workOrderId: string }) =>
          event.workOrderId === next[0]._id.toString(),
      ),
    ).toBe(true);

    const widget = await request(app.getHttpServer())
      .get('/work-orders/calendar/widget')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(widget.body.counts.waitingValidation).toBe(0);
  });

  it('F/H/I: keeps yearly, machine, and W-plan recurrence independent', async () => {
    const w7Order = await performPreventive(
      w7,
      machineA,
      moduleA,
      '2026-07-14',
    );
    const w2Order = await performPreventive(
      w2,
      machineA,
      moduleA,
      '2026-07-18',
    );
    const w1b = await plans.findOne({ plan_id: 'PLAN-W1-B' });
    if (!w1b) throw new Error('Missing W1 plan for machine B');
    const w1bOrder = await performPreventive(
      w1b,
      machineB,
      moduleB,
      '2026-07-20',
    );

    for (const order of [w7Order, w2Order, w1bOrder]) {
      await request(app.getHttpServer())
        .post(`/work-orders/${order._id}/validation`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'approve', technician_id: technician._id.toString() })
        .expect(201);
    }

    const w7Next = await workOrders.findOne({
      recurrence_source_occurrence_id: new Types.ObjectId(w7Order._id),
    });
    const w2Next = await workOrders.findOne({
      recurrence_source_occurrence_id: new Types.ObjectId(w2Order._id),
    });
    const w1bNext = await workOrders.findOne({
      recurrence_source_occurrence_id: new Types.ObjectId(w1bOrder._id),
    });
    expect(w7Next?.due_date?.toISOString()).toBe('2027-07-14T08:00:00.000Z');
    expect(w2Next?.due_date?.toISOString()).toBe('2026-08-18T08:00:00.000Z');
    expect(w1bNext?.due_date?.toISOString()).toBe('2026-08-20T08:00:00.000Z');
  });

  it('J: corrective completion does not create recurrence', async () => {
    const corrective = await request(app.getHttpServer())
      .post('/work-orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ot_id: 'WO-COR-E2E',
        machine_id: machineA._id.toString(),
        technician_id: operator._id.toString(),
        description: 'Corrective fault',
        type_maintenance: 'corrective',
        status: 'completed',
        priorite: 'medium',
        date_created: '2026-07-14T08:00:00.000Z',
        date_end: '2026-07-14T10:00:00.000Z',
        date_closed: '2026-07-14T10:00:00.000Z',
      })
      .expect(201);

    expect(
      await workOrders.countDocuments({
        recurrence_source_occurrence_id: corrective.body._id,
      }),
    ).toBe(0);
  });

  it('J0b: operator corrective report rejects missing required fields and empty actions', async () => {
    await request(app.getHttpServer())
      .post('/operator/report-problem')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        machine_id: machineA._id.toString(),
        code_panne: `COR-E2E-${Date.now()}`,
        actions: ['   ', ''],
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/operator/report-problem')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        machine_id: machineA._id.toString(),
        actions: ['Solved'],
      })
      .expect(400);
  });

  it('J1: blocks operators and technicians from generic operational mutations', async () => {
    const blockedMutations: Array<{
      token: string;
      request: () => request.Test;
    }> = [
      {
        token: operatorToken,
        request: () =>
          request(app.getHttpServer()).post('/work-orders').send({}),
      },
      {
        token: operatorToken,
        request: () => request(app.getHttpServer()).get('/work-orders'),
      },
      {
        token: technicianToken,
        request: () =>
          request(app.getHttpServer()).get('/work-orders/statistics'),
      },
      {
        token: operatorToken,
        request: () =>
          request(app.getHttpServer()).get('/work-orders/calendar/events'),
      },
      {
        token: technicianToken,
        request: () =>
          request(app.getHttpServer()).get(
            `/work-orders/${new Types.ObjectId()}`,
          ),
      },
      {
        token: operatorToken,
        request: () =>
          request(app.getHttpServer()).get('/intervention-reports'),
      },
      {
        token: technicianToken,
        request: () =>
          request(app.getHttpServer()).get(
            `/intervention-reports/${new Types.ObjectId()}`,
          ),
      },
      {
        token: operatorToken,
        request: () => request(app.getHttpServer()).get('/machines'),
      },
      {
        token: technicianToken,
        request: () =>
          request(app.getHttpServer()).get(
            `/machines/${machineA._id.toString()}`,
          ),
      },
      {
        token: operatorToken,
        request: () => request(app.getHttpServer()).get('/preventive-tasks'),
      },
      {
        token: technicianToken,
        request: () => request(app.getHttpServer()).get('/kpis'),
      },
      {
        token: operatorToken,
        request: () => request(app.getHttpServer()).get('/catalogues'),
      },
      {
        token: technicianToken,
        request: () => request(app.getHttpServer()).get('/stocks'),
      },
      {
        token: operatorToken,
        request: () => request(app.getHttpServer()).get('/maintenance-plans'),
      },
      {
        token: technicianToken,
        request: () => request(app.getHttpServer()).get('/machine-types'),
      },
      {
        token: technicianToken,
        request: () =>
          request(app.getHttpServer()).post('/work-orders').send({}),
      },
      {
        token: operatorToken,
        request: () =>
          request(app.getHttpServer())
            .patch(`/work-orders/${new Types.ObjectId()}`)
            .send({
              technician_id: technician._id.toString(),
              status: 'completed',
            }),
      },
      {
        token: technicianToken,
        request: () =>
          request(app.getHttpServer()).delete(
            `/work-orders/${new Types.ObjectId()}`,
          ),
      },
      {
        token: operatorToken,
        request: () =>
          request(app.getHttpServer()).post(
            `/work-orders/${new Types.ObjectId()}/complete`,
          ),
      },
      {
        token: technicianToken,
        request: () =>
          request(app.getHttpServer()).post(
            `/work-orders/${new Types.ObjectId()}/validation`,
          ),
      },
      {
        token: operatorToken,
        request: () =>
          request(app.getHttpServer()).post('/intervention-reports').send({}),
      },
      {
        token: technicianToken,
        request: () =>
          request(app.getHttpServer())
            .patch(`/intervention-reports/${new Types.ObjectId()}`)
            .send({}),
      },
      {
        token: operatorToken,
        request: () => request(app.getHttpServer()).post('/ot-pieces').send({}),
      },
      {
        token: technicianToken,
        request: () =>
          request(app.getHttpServer()).post('/lubrification-logs').send({}),
      },
      {
        token: operatorToken,
        request: () =>
          request(app.getHttpServer()).post('/maintenance-plans').send({}),
      },
      {
        token: technicianToken,
        request: () =>
          request(app.getHttpServer()).post('/preventive-tasks/sync-plans'),
      },
    ];

    for (const mutation of blockedMutations) {
      const response = await mutation
        .request()
        .set('Authorization', `Bearer ${mutation.token}`)
        .expect(403);
      expect(response.body.code).toBe('ROLE_ACCESS_DENIED');
    }
  });

  it('J2: derives generic validation actor from the authenticated admin instead of forged body IDs', async () => {
    const order = await workOrders.create({
      ot_id: `WO-FORGED-${Date.now()}`,
      machine_id: machineA._id,
      technician_id: operator._id,
      description: 'Forged validator test',
      type_maintenance: 'preventive',
      status: 'waiting_validation',
      priorite: 'medium',
      date_created: new Date('2026-07-14T08:00:00.000Z'),
    });
    const report = await reports.create({
      report_id: `REP-FORGED-${Date.now()}`,
      ot_id: order._id,
      technician_id: operator._id,
      date_debut: new Date('2026-07-14T08:00:00.000Z'),
      date_fin: new Date('2026-07-14T10:00:00.000Z'),
      description_action: 'Done',
      etat_final: 'good',
      validation_responsable: 'waiting_validation',
    });

    await request(app.getHttpServer())
      .post(`/work-orders/${order._id.toString()}/validation`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        action: 'approve',
        technician_id: technician._id.toString(),
      })
      .expect(201);

    const storedReport = await reports.findById(report._id);
    expect(storedReport?.validation_responsable).toBe('validated');
    // The validator's identity is derived from the authenticated admin (not
    // the forged `technician_id` in the request body) and recorded as
    // `validated_by` — it must never overwrite `technician_id`, which keeps
    // recording who actually performed the work (the operator).
    expect(storedReport?.validated_by?.toString()).toBe(admin._id.toString());
    expect(storedReport?.validated_by?.toString()).not.toBe(
      technician._id.toString(),
    );
    expect(storedReport?.technician_id?.toString()).toBe(
      operator._id.toString(),
    );
  });

  it('J3: preserves valid scoped operator and technician workflows', async () => {
    const operatorPlan = await plans.create({
      plan_id: `PLAN-OP-${Date.now()}`,
      module_id: moduleB._id,
      type_maintenance: 'preventive',
      frequence: 1,
      unite_frequence: 'monthly',
      maintenance_code: `OP-${Date.now()}`,
      instruction: 'Operator scoped scheduling test',
    });

    await request(app.getHttpServer())
      .post('/operator/preventive/schedule')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        machine_id: machineB._id.toString(),
        plan_id: operatorPlan._id.toString(),
        scheduled_date: '2026-09-14T08:00:00.000Z',
        technician_id: technician._id.toString(),
      })
      .expect(201);

    const operatorScheduled = await workOrders.findOne({
      machine_id: machineB._id,
      plan_id: operatorPlan._id,
      scheduled_date: new Date('2026-09-14T08:00:00.000Z'),
    });
    expect(operatorScheduled?.technician_id?.toString()).toBe(
      operator._id.toString(),
    );
    expect(operatorScheduled?.technician_id?.toString()).not.toBe(
      technician._id.toString(),
    );

    const claimable = await workOrders.create({
      ot_id: `WO-CLAIM-${Date.now()}`,
      machine_id: machineA._id,
      description: 'Technician claim test',
      type_maintenance: 'corrective',
      status: 'technician_required',
      priorite: 'urgent',
      date_created: new Date('2026-07-14T08:00:00.000Z'),
    });

    await request(app.getHttpServer())
      .patch(`/technician/work-orders/${claimable._id.toString()}/claim`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .expect(200);

    const claimed = await workOrders.findById(claimable._id);
    expect(claimed?.technician_id?.toString()).toBe(technician._id.toString());

    await request(app.getHttpServer())
      .patch(`/technician/work-orders/${claimable._id.toString()}/start`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(403);
  });

  it('J4: scopes Operator machine, manual, fault, calendar, and preventive access to assigned machines', async () => {
    const unassignedMachine = await machines.create({
      machine_id: `MACHINE-UNASSIGNED-${Date.now()}`,
      type_id: machineA.type_id,
      serial_no: `UNASSIGNED-${Date.now()}`,
      status: 'active',
    });
    const unassignedModule = await modules.create({
      module_id: `MODULE-UNASSIGNED-${Date.now()}`,
      machine_id: unassignedMachine._id,
      mod_type_id: moduleA.mod_type_id,
    });
    const unassignedPlan = await plans.create({
      plan_id: `PLAN-UNASSIGNED-${Date.now()}`,
      module_id: unassignedModule._id,
      type_maintenance: 'preventive',
      frequence: 1,
      unite_frequence: 'monthly',
      maintenance_code: `UNASSIGNED-${Date.now()}`,
      instruction: 'Unassigned preventive test',
    });
    await documents.create({
      document_id: `DOC-UNASSIGNED-${Date.now()}`,
      machine_id: unassignedMachine._id,
      type_document: 'manual',
      file_path: '/uploads/unassigned.pdf',
      file_name: 'unassigned.pdf',
      uploaded_by: admin._id.toString(),
    });
    await documents.create({
      document_id: `DOC-ASSIGNED-${Date.now()}`,
      machine_id: machineA._id,
      type_document: 'manual',
      file_path: '/uploads/assigned.pdf',
      file_name: 'assigned.pdf',
      uploaded_by: admin._id.toString(),
    });
    const assignedFault = await pannes.create({
      panne_id: `PAN-ASSIGNED-${Date.now()}`,
      code_panne: `ASSIGNED-${Date.now()}`,
      description: 'Assigned machine fault',
    });
    const unassignedFault = await pannes.create({
      panne_id: `PAN-UNASSIGNED-${Date.now()}`,
      code_panne: `UNASSIGNED-${Date.now()}`,
      description: 'Unassigned machine fault',
    });
    await panneSolutions.create({
      solution_id: `SOL-ASSIGNED-${Date.now()}`,
      panne_id: assignedFault._id,
      cause_probable: 'Assigned cause',
      solution_recommandee: 'Assigned solution',
    });
    await panneSolutions.create({
      solution_id: `SOL-UNASSIGNED-${Date.now()}`,
      panne_id: unassignedFault._id,
      cause_probable: 'Unassigned cause',
      solution_recommandee: 'Unassigned solution',
    });
    await workOrders.create({
      ot_id: `WO-ASSIGNED-FAULT-${Date.now()}`,
      machine_id: machineA._id,
      technician_id: operator._id,
      description: 'Assigned fault order',
      code_panne: assignedFault.code_panne,
      type_maintenance: 'corrective',
      status: 'scheduled',
      priorite: 'medium',
      due_date: new Date('2026-09-10T08:00:00.000Z'),
      date_created: new Date('2026-09-01T08:00:00.000Z'),
    });
    await workOrders.create({
      ot_id: `WO-UNASSIGNED-FAULT-${Date.now()}`,
      machine_id: unassignedMachine._id,
      description: 'Unassigned fault order',
      code_panne: unassignedFault.code_panne,
      type_maintenance: 'corrective',
      status: 'scheduled',
      priorite: 'medium',
      due_date: new Date('2026-09-10T08:00:00.000Z'),
      date_created: new Date('2026-09-01T08:00:00.000Z'),
    });

    const machinesResponse = await request(app.getHttpServer())
      .get('/operator/machines/my')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    const visibleMachineIds = machinesResponse.body.items.map(
      (machine: { _id: string }) => machine._id,
    );
    expect(visibleMachineIds).toContain(machineA._id.toString());
    expect(visibleMachineIds).not.toContain(unassignedMachine._id.toString());

    await request(app.getHttpServer())
      .get('/operator/machine-types')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    const operatorModules = await request(app.getHttpServer())
      .get('/operator/modules')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    expect(
      operatorModules.body.items.some(
        (module: { machine_id: { _id?: string } | string }) =>
          (typeof module.machine_id === 'string'
            ? module.machine_id
            : module.machine_id?._id) === unassignedMachine._id.toString(),
      ),
    ).toBe(false);
    await request(app.getHttpServer())
      .get('/operator/maintenance-plans')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/operator/lubrifiants')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/operator/kpis')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/operator/catalogues')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/operator/stocks')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(
        `/operator/preventive/states?machineId=${unassignedMachine._id.toString()}`,
      )
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post('/operator/preventive/schedule')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        machine_id: unassignedMachine._id.toString(),
        plan_id: unassignedPlan._id.toString(),
        scheduled_date: '2026-10-10T08:00:00.000Z',
      })
      .expect(403);
    await request(app.getHttpServer())
      .post('/operator/preventive/schedule')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        machine_id: '../not-a-machine',
        plan_id: unassignedPlan._id.toString(),
        scheduled_date: '2026-10-10T08:00:00.000Z',
      })
      .expect(400);

    const manualsResponse = await request(app.getHttpServer())
      .get('/operator/manuals')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    const manualMachineIds = manualsResponse.body.items.map(
      (doc: { machine_id: { _id?: string } | string }) =>
        typeof doc.machine_id === 'string'
          ? doc.machine_id
          : doc.machine_id._id,
    );
    expect(manualMachineIds).toContain(machineA._id.toString());
    expect(manualMachineIds).not.toContain(unassignedMachine._id.toString());

    const faultsResponse = await request(app.getHttpServer())
      .get('/operator/faults')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    const faultCodes = faultsResponse.body.items.map(
      (fault: { code_panne: string }) => fault.code_panne,
    );
    expect(faultCodes).toContain(assignedFault.code_panne);
    expect(faultCodes).not.toContain(unassignedFault.code_panne);

    const solutionsResponse = await request(app.getHttpServer())
      .get('/operator/fault-solutions')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    const solutionPanneIds = solutionsResponse.body.items.map(
      (solution: { panne_id: { _id?: string } | string }) =>
        typeof solution.panne_id === 'string'
          ? solution.panne_id
          : solution.panne_id._id,
    );
    expect(solutionPanneIds).toContain(assignedFault._id.toString());
    expect(solutionPanneIds).not.toContain(unassignedFault._id.toString());

    await request(app.getHttpServer())
      .get(
        `/operator/calendar/my?machineId=${unassignedMachine._id.toString()}&date=2026-09-01`,
      )
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(403);
  });

  it('J5: prevents cross-operator records and supports reassignment-driven access', async () => {
    const reassignedMachine = await machines.create({
      machine_id: `MACHINE-REASSIGN-${Date.now()}`,
      type_id: machineA.type_id,
      serial_no: `REASSIGN-${Date.now()}`,
      status: 'active',
    });
    const otherOperator = await users.create({
      user_id: `OP-OTHER-${Date.now()}`,
      nom_complet: 'Other Operator',
      email: `other-operator-${Date.now()}@example.test`,
      password: 'x',
      role: Role.OPERATOR,
      is_active: true,
      is_verified: true,
      approval_status: ApprovalStatus.APPROVED,
      assigned_machine_ids: [reassignedMachine._id],
    });
    const otherToken = tokenFor(otherOperator);
    const otherOrder = await workOrders.create({
      ot_id: `WO-OTHER-${Date.now()}`,
      machine_id: reassignedMachine._id,
      technician_id: otherOperator._id,
      description: 'Other operator order',
      type_maintenance: 'corrective',
      status: 'scheduled',
      priorite: 'medium',
      due_date: new Date('2026-09-15T08:00:00.000Z'),
      date_created: new Date('2026-09-01T08:00:00.000Z'),
    });

    let myOrders = await request(app.getHttpServer())
      .get('/operator/work-orders/my')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    expect(
      myOrders.body.items.some(
        (order: { _id: string }) => order._id === otherOrder._id.toString(),
      ),
    ).toBe(false);

    await request(app.getHttpServer())
      .get(
        `/operator/preventive/states?machineId=${reassignedMachine._id.toString()}`,
      )
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(403);

    await users.findByIdAndUpdate(operator._id, {
      $addToSet: { assigned_machine_ids: reassignedMachine._id },
    });

    await request(app.getHttpServer())
      .get(
        `/operator/preventive/states?machineId=${reassignedMachine._id.toString()}`,
      )
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);

    myOrders = await request(app.getHttpServer())
      .get('/operator/work-orders/my')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    expect(
      myOrders.body.items.some(
        (order: { _id: string }) => order._id === otherOrder._id.toString(),
      ),
    ).toBe(false);

    const otherMachines = await request(app.getHttpServer())
      .get('/operator/machines/my')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(
      otherMachines.body.items.map((machine: { _id: string }) => machine._id),
    ).toContain(reassignedMachine._id.toString());
  });

  it('J6: scopes Technician work orders and manuals to assigned/history and explicit claimable machines', async () => {
    const assignedTechMachine = await machines.create({
      machine_id: `MACHINE-TECH-ASSIGNED-${Date.now()}`,
      type_id: machineA.type_id,
      serial_no: `TECH-ASSIGNED-${Date.now()}`,
      status: 'active',
    });
    const unrelatedTechMachine = await machines.create({
      machine_id: `MACHINE-TECH-UNRELATED-${Date.now()}`,
      type_id: machineA.type_id,
      serial_no: `TECH-UNRELATED-${Date.now()}`,
      status: 'active',
    });
    await users.findByIdAndUpdate(technician._id, {
      $addToSet: { assigned_machine_ids: assignedTechMachine._id },
    });
    const otherTechnician = await users.create({
      user_id: `TECH-OTHER-${Date.now()}`,
      nom_complet: 'Other Technician',
      email: `other-technician-${Date.now()}@example.test`,
      password: 'x',
      role: Role.TECHNICIAN,
      is_active: true,
      is_verified: true,
      approval_status: ApprovalStatus.APPROVED,
      assigned_machine_ids: [unrelatedTechMachine._id],
    });
    const ownCompleted = await workOrders.create({
      ot_id: `WO-OWN-COMPLETED-${Date.now()}`,
      machine_id: assignedTechMachine._id,
      technician_id: technician._id,
      description: 'Own completed order',
      type_maintenance: 'corrective',
      status: 'completed',
      priorite: 'medium',
      date_created: new Date('2026-10-01T08:00:00.000Z'),
      date_end: new Date('2026-10-01T10:00:00.000Z'),
      date_closed: new Date('2026-10-01T10:00:00.000Z'),
    });
    const otherCompleted = await workOrders.create({
      ot_id: `WO-OTHER-COMPLETED-${Date.now()}`,
      machine_id: unrelatedTechMachine._id,
      technician_id: otherTechnician._id,
      description: 'Other technician completed order',
      type_maintenance: 'corrective',
      status: 'completed',
      priorite: 'medium',
      date_created: new Date('2026-10-02T08:00:00.000Z'),
      date_end: new Date('2026-10-02T10:00:00.000Z'),
      date_closed: new Date('2026-10-02T10:00:00.000Z'),
    });
    const claimable = await workOrders.create({
      ot_id: `WO-CLAIMABLE-SCOPED-${Date.now()}`,
      machine_id: assignedTechMachine._id,
      description: 'Assigned machine claimable order',
      type_maintenance: 'corrective',
      status: 'technician_required',
      priorite: 'urgent',
      date_created: new Date('2026-10-03T08:00:00.000Z'),
    });
    const unrelatedUnassigned = await workOrders.create({
      ot_id: `WO-UNRELATED-UNASSIGNED-${Date.now()}`,
      machine_id: unrelatedTechMachine._id,
      description: 'Unrelated unassigned order',
      type_maintenance: 'corrective',
      status: 'technician_required',
      priorite: 'urgent',
      date_created: new Date('2026-10-04T08:00:00.000Z'),
    });
    const assignedManual = await documents.create({
      document_id: `DOC-TECH-ASSIGNED-${Date.now()}`,
      machine_id: assignedTechMachine._id,
      type_document: 'manual',
      file_path: '/uploads/tech-assigned.pdf',
      file_name: 'tech-assigned.pdf',
      uploaded_by: admin._id.toString(),
    });
    const unrelatedManual = await documents.create({
      document_id: `DOC-TECH-UNRELATED-${Date.now()}`,
      machine_id: unrelatedTechMachine._id,
      type_document: 'manual',
      file_path: '/uploads/tech-unrelated.pdf',
      file_name: 'tech-unrelated.pdf',
      uploaded_by: admin._id.toString(),
    });

    const ordersResponse = await request(app.getHttpServer())
      .get('/technician/work-orders?limit=200')
      .set('Authorization', `Bearer ${technicianToken}`)
      .expect(200);
    const orderIds = ordersResponse.body.items.map(
      (order: { _id: string }) => order._id,
    );
    expect(orderIds).toContain(ownCompleted._id.toString());
    expect(orderIds).toContain(claimable._id.toString());
    expect(orderIds).not.toContain(otherCompleted._id.toString());
    expect(orderIds).not.toContain(unrelatedUnassigned._id.toString());

    await request(app.getHttpServer())
      .get(`/technician/work-orders/${otherCompleted._id.toString()}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/technician/work-orders/${unrelatedUnassigned._id.toString()}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .patch(
        `/technician/work-orders/${unrelatedUnassigned._id.toString()}/claim`,
      )
      .set('Authorization', `Bearer ${technicianToken}`)
      .expect(409);

    const detail = await request(app.getHttpServer())
      .get(`/technician/work-orders/${claimable._id.toString()}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .expect(200);
    const detailManualIds = detail.body.manuals.map(
      (doc: { _id: string }) => doc._id,
    );
    expect(detailManualIds).toContain(assignedManual._id.toString());
    expect(detailManualIds).not.toContain(unrelatedManual._id.toString());

    await request(app.getHttpServer())
      .get(
        `/technician/manuals?machineId=${unrelatedTechMachine._id.toString()}`,
      )
      .set('Authorization', `Bearer ${technicianToken}`)
      .expect(403);
    const manualsResponse = await request(app.getHttpServer())
      .get('/technician/manuals?limit=200')
      .set('Authorization', `Bearer ${technicianToken}`)
      .expect(200);
    const manualIds = manualsResponse.body.items.map(
      (doc: { _id: string }) => doc._id,
    );
    expect(manualIds).toContain(assignedManual._id.toString());
    expect(manualIds).not.toContain(unrelatedManual._id.toString());

    const dashboardResponse = await request(app.getHttpServer())
      .get('/technician/dashboard')
      .set('Authorization', `Bearer ${technicianToken}`)
      .expect(200);
    const dashboardManualIds = dashboardResponse.body.manuals.map(
      (doc: { _id: string }) => doc._id,
    );
    expect(dashboardManualIds).toContain(assignedManual._id.toString());
    expect(dashboardManualIds).not.toContain(unrelatedManual._id.toString());

    await request(app.getHttpServer())
      .patch(`/technician/work-orders/${claimable._id.toString()}/claim`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/technician/work-orders/${claimable._id.toString()}/start`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .expect(200);
  });

  it('K0: rejects anonymous requests across operational APIs while health and public auth stay open', async () => {
    const healthResponse = await request(app.getHttpServer())
      .get('/health')
      .expect(200);
    expect(JSON.stringify(healthResponse.body)).not.toContain('smtp');
    expect(JSON.stringify(healthResponse.body)).not.toContain('brevoApi');
    expect(JSON.stringify(healthResponse.body)).not.toContain('errorCode');
    const livenessResponse = await request(app.getHttpServer())
      .get('/health/live')
      .expect(200);
    expect(livenessResponse.body).toMatchObject({ status: 'ok' });
    await request(app.getHttpServer()).get('/health/db').expect(401);
    await request(app.getHttpServer()).get('/health/email').expect(401);
    await request(app.getHttpServer())
      .get('/health/db')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/health/db')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app.getHttpServer()).get('/health/metrics').expect(401);
    const metricsResponse = await request(app.getHttpServer())
      .get('/health/metrics')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(metricsResponse.headers['content-type']).toContain('text/plain');
    expect(metricsResponse.text).toContain(
      '# TYPE http_requests_total counter',
    );
    expect(metricsResponse.text).toContain(
      'http_requests_total{method="GET",route="/health",status="200"}',
    );

    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', '203.0.113.210')
      .send({ email: 'anonymous-public-auth@example.test' })
      .expect(201);

    const protectedRequests: Array<() => request.Test> = [
      () => request(app.getHttpServer()).get('/machines'),
      () => request(app.getHttpServer()).get('/machine-types'),
      () => request(app.getHttpServer()).get('/modules'),
      () => request(app.getHttpServer()).get('/module-types'),
      () => request(app.getHttpServer()).get('/work-orders'),
      () => request(app.getHttpServer()).get('/work-orders/statistics'),
      () => request(app.getHttpServer()).post('/work-orders').send({}),
      () => request(app.getHttpServer()).post('/work-orders/invalid/complete'),
      () =>
        request(app.getHttpServer()).post('/work-orders/invalid/validation'),
      () => request(app.getHttpServer()).get('/intervention-reports'),
      () => request(app.getHttpServer()).post('/intervention-reports').send({}),
      () => request(app.getHttpServer()).get('/catalogues'),
      () => request(app.getHttpServer()).get('/stocks'),
      () => request(app.getHttpServer()).get('/ot-pieces'),
      () => request(app.getHttpServer()).get('/lubrifiants'),
      () => request(app.getHttpServer()).get('/lubrification-logs'),
      () => request(app.getHttpServer()).get('/maintenance-plans'),
      () => request(app.getHttpServer()).get('/preventive-tasks'),
      () => request(app.getHttpServer()).post('/preventive-tasks/sync-plans'),
      () => request(app.getHttpServer()).get('/capteurs'),
      () => request(app.getHttpServer()).get('/mesures'),
      () => request(app.getHttpServer()).get('/kpis'),
      () => request(app.getHttpServer()).get('/pannes'),
      () => request(app.getHttpServer()).get('/panne-solutions'),
      () => request(app.getHttpServer()).get('/documents'),
      () => request(app.getHttpServer()).post('/documents/upload'),
      () => request(app.getHttpServer()).get('/operator/work-orders/my'),
      () => request(app.getHttpServer()).get('/technician/dashboard'),
    ];

    for (const buildRequest of protectedRequests) {
      await buildRequest().expect(401);
    }
  });

  it('K1: serves managed document files only to authenticated document readers', async () => {
    const fileName = `e2e-protected-${Date.now()}.txt`;
    const unassignedFileName = `e2e-protected-unassigned-${Date.now()}.txt`;
    const uploadDir = join(process.cwd(), 'uploads');
    const filePath = join(uploadDir, fileName);
    const unassignedFilePath = join(uploadDir, unassignedFileName);
    await fs.mkdir(uploadDir, { recursive: true });
    await fs.writeFile(filePath, 'protected document');
    await fs.writeFile(unassignedFilePath, 'unassigned document');

    try {
      const unassignedMachine = await machines.create({
        machine_id: `MACHINE-DOC-UNASSIGNED-${Date.now()}`,
        type_id: machineA.type_id,
        serial_no: `DOC-UNASSIGNED-${Date.now()}`,
        status: 'active',
      });
      const doc = await documents.create({
        document_id: `DOC-PROTECTED-${Date.now()}`,
        machine_id: machineA._id,
        type_document: 'manual',
        file_path: `/uploads/${fileName}`,
        storage_path: `/uploads/${fileName}`,
        file_name: fileName,
        uploaded_by: admin._id.toString(),
      });
      const unassignedDoc = await documents.create({
        document_id: `DOC-PROTECTED-UNASSIGNED-${Date.now()}`,
        machine_id: unassignedMachine._id,
        type_document: 'manual',
        file_path: `/uploads/${unassignedFileName}`,
        storage_path: `/uploads/${unassignedFileName}`,
        file_name: unassignedFileName,
        uploaded_by: admin._id.toString(),
      });
      await workOrders.create({
        ot_id: `WO-DOC-TECH-${Date.now()}`,
        machine_id: machineA._id,
        technician_id: technician._id,
        description: 'Technician document authorization',
        type_maintenance: 'corrective',
        status: 'assigned',
        priorite: 'medium',
        date_created: new Date(),
      });

      const listed = await request(app.getHttpServer())
        .get('/documents')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
      const listedDoc = listed.body.items.find(
        (item: { _id: string }) => item._id === doc._id.toString(),
      );
      expect(listedDoc.file_url).toBe(`/documents/${doc._id.toString()}/file`);
      expect(listedDoc.file_url).not.toContain('/uploads/');
      expect(
        listed.body.items.some(
          (item: { _id: string }) => item._id === unassignedDoc._id.toString(),
        ),
      ).toBe(false);

      await request(app.getHttpServer())
        .get(`/documents/${doc._id.toString()}/file`)
        .expect(401);

      await request(app.getHttpServer())
        .get(`/documents/${unassignedDoc._id.toString()}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .get(`/documents/machine/${unassignedMachine._id.toString()}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .get(`/documents/${unassignedDoc._id.toString()}/file`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .get(`/documents/${unassignedDoc._id.toString()}/file`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(403);

      const response = await request(app.getHttpServer())
        .get(`/documents/${doc._id.toString()}/file`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.text).toBe('protected document');

      const technicianResponse = await request(app.getHttpServer())
        .get(`/documents/${doc._id.toString()}/file`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(200);
      expect(technicianResponse.text).toBe('protected document');

      const adminResponse = await request(app.getHttpServer())
        .get(`/documents/${unassignedDoc._id.toString()}/file`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(adminResponse.text).toBe('unassigned document');

      await request(app.getHttpServer())
        .post('/documents/upload')
        .set('Authorization', `Bearer ${operatorToken}`)
        .field('document_id', `DOC-FORGED-UPLOAD-${Date.now()}`)
        .field('machine_id', unassignedMachine._id.toString())
        .field('type_document', 'manual')
        .attach('file', Buffer.from('%PDF-1.7'), 'manual.pdf')
        .expect(403);

      await request(app.getHttpServer())
        .post('/documents/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('document_id', `DOC-ADMIN-UPLOAD-${Date.now()}`)
        .field('machine_id', unassignedMachine._id.toString())
        .field('type_document', 'manual')
        .attach('file', Buffer.from('%PDF-1.7'), 'manual.pdf')
        .expect(201);

      await request(app.getHttpServer())
        .post('/documents/upload')
        .set('Authorization', `Bearer ${technicianToken}`)
        .field('document_id', `DOC-TECH-UPLOAD-${Date.now()}`)
        .field('machine_id', machineA._id.toString())
        .field('type_document', 'manual')
        .attach('file', Buffer.from('%PDF-1.7'), 'manual.pdf')
        .expect(201);
    } finally {
      await fs.unlink(filePath).catch(() => undefined);
      await fs.unlink(unassignedFilePath).catch(() => undefined);
    }
  });

  it('K2: rejects missing, deleted, external, and path-traversal document file references', async () => {
    const missing = await documents.create({
      document_id: `DOC-MISSING-${Date.now()}`,
      machine_id: machineA._id,
      type_document: 'manual',
      file_path: '/uploads/e2e-missing.pdf',
      storage_path: '/uploads/e2e-missing.pdf',
      file_name: 'e2e-missing.pdf',
      uploaded_by: admin._id.toString(),
    });
    const external = await documents.create({
      document_id: `DOC-EXTERNAL-${Date.now()}`,
      machine_id: machineA._id,
      type_document: 'manual',
      file_path: 'https://example.com/manual.pdf',
      file_name: 'manual.pdf',
      uploaded_by: admin._id.toString(),
    });
    const traversal = await documents.create({
      document_id: `DOC-TRAVERSAL-${Date.now()}`,
      machine_id: machineA._id,
      type_document: 'manual',
      file_path: '/uploads/../secret.txt',
      storage_path: '/uploads/../secret.txt',
      file_name: 'secret.txt',
      uploaded_by: admin._id.toString(),
    });

    await request(app.getHttpServer())
      .get(`/documents/${missing._id.toString()}/file`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/documents/${external._id.toString()}/file`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/documents/${traversal._id.toString()}/file`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('K2b: serves approved public avatar assets anonymously and returns 404 after deletion', async () => {
    const avatarFileName = `avatar-e2e-public-${Date.now()}.webp`;
    const avatarDir = join(process.cwd(), 'uploads', 'avatars');
    const avatarPath = join(avatarDir, avatarFileName);
    await fs.mkdir(avatarDir, { recursive: true });
    await fs.writeFile(avatarPath, 'public-avatar');

    try {
      const response = await request(app.getHttpServer())
        .get(`/files/uploads/avatars/${avatarFileName}`)
        .expect(200);
      expect(Buffer.from(response.body).toString()).toBe('public-avatar');
    } finally {
      await fs.unlink(avatarPath).catch(() => undefined);
    }

    await request(app.getHttpServer())
      .get(`/files/uploads/avatars/${avatarFileName}`)
      .expect(404);
  });

  it('K3: secures the Admin email diagnostic endpoint behind auth, role, and feature flag checks', async () => {
    const previousEnabled = process.env.ENABLE_EMAIL_DIAGNOSTIC_TEST;
    const previousRecipient = process.env.EMAIL_DIAGNOSTIC_RECIPIENT;
    const sendSpy = jest
      .spyOn(emailService, 'sendMail')
      .mockResolvedValue(undefined);

    try {
      delete process.env.ENABLE_EMAIL_DIAGNOSTIC_TEST;
      delete process.env.EMAIL_DIAGNOSTIC_RECIPIENT;

      await request(app.getHttpServer()).get('/email/test').expect(401);

      process.env.ENABLE_EMAIL_DIAGNOSTIC_TEST = 'true';
      process.env.EMAIL_DIAGNOSTIC_RECIPIENT = 'diagnostic-e2e@example.test';

      await request(app.getHttpServer())
        .get('/email/test')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .get('/email/test')
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(403);

      process.env.ENABLE_EMAIL_DIAGNOSTIC_TEST = 'false';
      await request(app.getHttpServer())
        .get('/email/test')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      process.env.ENABLE_EMAIL_DIAGNOSTIC_TEST = 'true';
      const response = await request(app.getHttpServer())
        .get('/email/test')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toEqual(
        expect.objectContaining({
          status: 'sent',
          diagnostic: 'email',
        }),
      );
      expect(response.body).not.toHaveProperty('previewUrl');
      expect(response.body).not.toHaveProperty('smtp');
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'diagnostic-e2e@example.test',
          subject: 'Iprotex email diagnostic',
        }),
      );
    } finally {
      sendSpy.mockRestore();
      if (previousEnabled === undefined) {
        delete process.env.ENABLE_EMAIL_DIAGNOSTIC_TEST;
      } else {
        process.env.ENABLE_EMAIL_DIAGNOSTIC_TEST = previousEnabled;
      }
      if (previousRecipient === undefined) {
        delete process.env.EMAIL_DIAGNOSTIC_RECIPIENT;
      } else {
        process.env.EMAIL_DIAGNOSTIC_RECIPIENT = previousRecipient;
      }
    }
  });

  it('K4: throttles repeated Admin email diagnostic attempts', async () => {
    const previousEnabled = process.env.ENABLE_EMAIL_DIAGNOSTIC_TEST;
    const previousRecipient = process.env.EMAIL_DIAGNOSTIC_RECIPIENT;
    const sendSpy = jest
      .spyOn(emailService, 'sendMail')
      .mockResolvedValue(undefined);
    const throttleAdmin = await users.create({
      user_id: 'ADMIN-EMAIL-THROTTLE-E2E',
      nom_complet: 'Email Throttle Admin',
      email: 'email-throttle-admin-e2e@example.test',
      password: 'x',
      role: Role.ADMIN,
      is_active: true,
      is_verified: true,
      approval_status: ApprovalStatus.APPROVED,
    });
    const throttleToken = tokenFor(throttleAdmin);

    try {
      process.env.ENABLE_EMAIL_DIAGNOSTIC_TEST = 'true';
      process.env.EMAIL_DIAGNOSTIC_RECIPIENT = 'diagnostic-e2e@example.test';

      for (let i = 0; i < 3; i += 1) {
        await request(app.getHttpServer())
          .get('/email/test')
          .set('Authorization', `Bearer ${throttleToken}`)
          .set('X-Forwarded-For', '203.0.113.220')
          .expect(200);
      }

      const throttled = await request(app.getHttpServer())
        .get('/email/test')
        .set('Authorization', `Bearer ${throttleToken}`)
        .set('X-Forwarded-For', '203.0.113.220')
        .expect(429);

      expect(throttled.body.code).toBe('AUTH_TOO_MANY_ATTEMPTS');
      expect(sendSpy).toHaveBeenCalledTimes(3);
    } finally {
      sendSpy.mockRestore();
      if (previousEnabled === undefined) {
        delete process.env.ENABLE_EMAIL_DIAGNOSTIC_TEST;
      } else {
        process.env.ENABLE_EMAIL_DIAGNOSTIC_TEST = previousEnabled;
      }
      if (previousRecipient === undefined) {
        delete process.env.EMAIL_DIAGNOSTIC_RECIPIENT;
      } else {
        process.env.EMAIL_DIAGNOSTIC_RECIPIENT = previousRecipient;
      }
    }
  });

  async function createApprovalUser(
    overrides: Partial<User> & { email: string; role: Role },
  ) {
    return users.create({
      user_id: `APP-${new Types.ObjectId().toString()}`,
      nom_complet: 'Approval User',
      password: await bcrypt.hash('P@ssword123!', 10),
      is_active: false,
      is_verified: false,
      approval_status: ApprovalStatus.PENDING,
      created_at: new Date(),
      ...overrides,
    });
  }

  function tokenFor(user: UserDocument, payloadRole?: Role) {
    return jwtService.sign({
      sub: user._id.toString(),
      email: user.email,
      role: payloadRole ?? user.role,
      user_id: user.user_id,
    });
  }

  function getSetCookies(response: request.Response): string[] {
    const cookies = response.headers['set-cookie'];
    return Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
  }

  function getCookieValueFromSetCookie(
    response: request.Response,
    name: string,
  ): string {
    const cookie = getSetCookies(response).find((entry) =>
      entry.startsWith(`${name}=`),
    );
    expect(cookie).toBeTruthy();
    return decodeURIComponent(
      String(cookie)
        .split(';')[0]
        .slice(name.length + 1),
    );
  }

  function getAuthCookieHeader(response: request.Response): string {
    const refreshToken = getCookieValueFromSetCookie(response, 'refresh_token');
    const csrfToken = getCookieValueFromSetCookie(response, 'csrf_token');
    return `refresh_token=${encodeURIComponent(refreshToken)}; csrf_token=${encodeURIComponent(csrfToken)}`;
  }

  function expectRefreshCookie(response: request.Response) {
    const cookies = getSetCookies(response);
    expect(cookies.some((cookie) => /^refresh_token=/.test(cookie))).toBe(true);
    expect(
      cookies.some(
        (cookie) => /^refresh_token=/.test(cookie) && /HttpOnly/i.test(cookie),
      ),
    ).toBe(true);
    expect(
      cookies.some(
        (cookie) => /^refresh_token=/.test(cookie) && /Path=\//i.test(cookie),
      ),
    ).toBe(true);
    expect(cookies.some((cookie) => /^csrf_token=/.test(cookie))).toBe(true);
    expect(
      cookies.some(
        (cookie) => /^csrf_token=/.test(cookie) && /HttpOnly/i.test(cookie),
      ),
    ).toBe(false);
  }

  async function createApprovedAdmin(
    overrides: Partial<User> = {},
    payloadRole?: Role,
  ) {
    const admin = await createApprovalUser({
      email: `admin-${new Types.ObjectId().toString()}@example.test`,
      role: Role.ADMIN,
      is_active: true,
      is_verified: true,
      approval_status: ApprovalStatus.APPROVED,
      ...overrides,
    });

    return {
      admin,
      token: tokenFor(admin, payloadRole),
    };
  }

  it('K: unauthenticated callers cannot access pending approvals', async () => {
    await request(app.getHttpServer())
      .get('/users/pending-approvals')
      .expect(401);
  });

  it('L: operator and technician tokens cannot access pending approvals', async () => {
    const operatorUser = await createApprovalUser({
      email: 'approval-operator-auth@example.test',
      role: Role.OPERATOR,
      is_active: true,
      is_verified: true,
      approval_status: ApprovalStatus.APPROVED,
    });
    const technicianUser = await createApprovalUser({
      email: 'approval-tech-auth@example.test',
      role: Role.TECHNICIAN,
      is_active: true,
      is_verified: true,
      approval_status: ApprovalStatus.APPROVED,
    });

    await request(app.getHttpServer())
      .get('/users/pending-approvals')
      .set('Authorization', `Bearer ${tokenFor(operatorUser)}`)
      .expect(403);

    await request(app.getHttpServer())
      .get('/users/pending-approvals')
      .set('Authorization', `Bearer ${tokenFor(technicianUser)}`)
      .expect(403);
  });

  it('M: administrator access is validated against the current database user', async () => {
    const { token } = await createApprovedAdmin(
      {
        role: Role.OPERATOR,
      },
      Role.ADMIN,
    );

    const response = await request(app.getHttpServer())
      .get('/users/pending-approvals')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(response.body.code).toBe('ROLE_ACCESS_DENIED');

    const missingAdmin = await createApprovalUser({
      email: 'missing-admin@example.test',
      role: Role.ADMIN,
      is_active: true,
      is_verified: true,
      approval_status: ApprovalStatus.APPROVED,
    });
    const missingToken = tokenFor(missingAdmin);
    await users.findByIdAndDelete(missingAdmin._id);

    await request(app.getHttpServer())
      .get('/users/pending-approvals')
      .set('Authorization', `Bearer ${missingToken}`)
      .expect(401);
  });

  it('N: administrator can list and count explicit public pending users', async () => {
    const { token } = await createApprovedAdmin();
    const pending = await createApprovalUser({
      email: 'pending-visible@example.test',
      role: Role.OPERATOR,
      nom_complet: 'Visible Pending',
      is_verified: true,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
    });
    await createApprovalUser({
      email: 'pending-admin-hidden@example.test',
      role: Role.ADMIN,
      is_verified: true,
    });
    await createApprovalUser({
      email: 'legacy-hidden@example.test',
      role: Role.OPERATOR,
      is_verified: false,
      approval_status: undefined,
    });

    const response = await request(app.getHttpServer())
      .get(
        '/users/pending-approvals?search=pending-visible&emailVerified=verified&limit=200',
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.code).toBe('PENDING_APPROVALS_RETRIEVED');
    expect(response.body.limit).toBe(100);
    expect(
      response.body.items.some(
        (item: { email: string }) => item.email === pending.email,
      ),
    ).toBe(true);
    expect(
      response.body.items.some(
        (item: { role: string }) => item.role === 'admin',
      ),
    ).toBe(false);
    expect(response.body.items[0]).not.toHaveProperty('_id');
    expect(response.body.items[0]).not.toHaveProperty('user_id');
    expect(response.body.items[0]).not.toHaveProperty('password');

    const count = await request(app.getHttpServer())
      .get('/users/pending-approvals/count')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(count.body).toEqual(
      expect.objectContaining({
        code: 'PENDING_APPROVAL_COUNT_RETRIEVED',
      }),
    );
    expect(count.body).not.toHaveProperty('items');
  });

  it('O: administrator cannot approve an unverified account', async () => {
    const { token } = await createApprovedAdmin();
    const target = await createApprovalUser({
      email: 'unverified-approval@example.test',
      role: Role.OPERATOR,
      is_verified: false,
    });

    const response = await request(app.getHttpServer())
      .patch(`/users/${target._id.toString()}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);

    expect(response.body.code).toBe(
      'EMAIL_VERIFICATION_REQUIRED_BEFORE_APPROVAL',
    );
  });

  it('P: administrator approves a verified pending operator who can then log in', async () => {
    const { admin, token } = await createApprovedAdmin();
    const target = await createApprovalUser({
      email: 'approved-operator@example.test',
      role: Role.OPERATOR,
      is_verified: true,
      phone: '+21612345678',
      department: 'Maintenance',
      refresh_token_hash: 'old-refresh-hash',
      rejected_by: admin._id,
      rejected_at: new Date('2026-01-01T00:00:00.000Z'),
      rejection_reason: 'Old reason',
    });

    const response = await request(app.getHttpServer())
      .patch(`/users/${target._id.toString()}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.code).toBe('ACCOUNT_APPROVED');
    expect(response.body.user).toEqual(
      expect.objectContaining({
        email: 'approved-operator@example.test',
        role: Role.OPERATOR,
        is_active: true,
        is_verified: true,
        approval_status: ApprovalStatus.APPROVED,
        phone: '+21612345678',
        department: 'Maintenance',
      }),
    );
    expect(response.body.user).not.toHaveProperty('_id');
    expect(response.body.user).not.toHaveProperty('approved_by');
    expect(response.body).not.toHaveProperty('token');

    const stored = await users.findById(target._id);
    expect(stored?.approved_by?.toString()).toBe(admin._id.toString());
    expect(stored?.approved_at).toBeInstanceOf(Date);
    expect(stored?.rejection_reason).toBeUndefined();
    expect(stored?.refresh_token_hash).toBeUndefined();
    expect(stored?.login_history ?? []).toHaveLength(0);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'approved-operator@example.test',
        password: 'P@ssword123!',
      })
      .expect(200);
  });

  it('Q: administrator rejects a pending technician who cannot log in', async () => {
    const { token } = await createApprovedAdmin();
    const target = await createApprovalUser({
      email: 'rejected-technician@example.test',
      role: Role.TECHNICIAN,
      is_verified: true,
      refresh_token_hash: 'old-refresh-hash',
    });

    const response = await request(app.getHttpServer())
      .patch(`/users/${target._id.toString()}/reject`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: '  Not eligible now  ' })
      .expect(200);

    expect(response.body.code).toBe('ACCOUNT_REJECTED');
    expect(response.body.user).toEqual(
      expect.objectContaining({
        email: 'rejected-technician@example.test',
        role: Role.TECHNICIAN,
        is_active: false,
        is_verified: true,
        approval_status: ApprovalStatus.REJECTED,
        rejection_reason: 'Not eligible now',
      }),
    );

    const stored = await users.findById(target._id);
    expect(stored?.refresh_token_hash).toBeUndefined();

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'rejected-technician@example.test',
        password: 'P@ssword123!',
      })
      .expect(403);

    expect(loginResponse.body.code).toBe('ACCOUNT_REJECTED');
  });

  it('R: administrator cannot reject self', async () => {
    const { admin, token } = await createApprovedAdmin();

    const response = await request(app.getHttpServer())
      .patch(`/users/${admin._id.toString()}/reject`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Self rejection' })
      .expect(409);

    expect(response.body.code).toBe('CANNOT_REJECT_SELF');
  });

  it('S: administrator users list is guarded and supports approval filters', async () => {
    const { token } = await createApprovedAdmin();
    const approvedUser = await createApprovalUser({
      email: 'approved-list@example.test',
      role: Role.OPERATOR,
      is_active: true,
      is_verified: true,
      approval_status: ApprovalStatus.APPROVED,
    });
    await createApprovalUser({
      email: 'rejected-list@example.test',
      role: Role.TECHNICIAN,
      is_active: false,
      is_verified: true,
      approval_status: ApprovalStatus.REJECTED,
    });

    await request(app.getHttpServer()).get('/users').expect(401);

    await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(403);

    const response = await request(app.getHttpServer())
      .get(
        '/users?approvalStatus=approved&search=approved-list&page=1&limit=10',
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          email: approvedUser.email,
          approval_status: ApprovalStatus.APPROVED,
        }),
      ]),
    );
    expect(response.body.items[0]).not.toHaveProperty('password');
    expect(response.body.items[0]).not.toHaveProperty('refresh_token_hash');
    expect(response.body.totalItems).toBeGreaterThanOrEqual(1);

    const invalid = await request(app.getHttpServer())
      .get('/users?approvalStatus=admin')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    expect(invalid.body.code).toBe('INVALID_APPROVAL_STATUS_FILTER');
  });

  function createGoogleRedirectResponse() {
    return {
      redirect: jest.fn(),
      clearCookie: jest.fn(),
    };
  }

  it('T: Google account completes profile, stays pending, is approved, and can sign in again without duplicates', async () => {
    const res = createGoogleRedirectResponse();

    await authService.googleLogin(
      {
        provider: 'google',
        google_id: 'google-new-e2e',
        email: ' New.Google.E2E@Example.TEST ',
        name: 'New Google E2E',
        picture: 'https://lh3.googleusercontent.com/e2e.png',
        email_verified: true,
      },
      res as never,
      'en',
      'http://localhost:3000',
    );

    let stored = await users.findOne({ google_id: 'google-new-e2e' });
    expect(stored).toEqual(
      expect.objectContaining({
        email: 'new.google.e2e@example.test',
        role: Role.OPERATOR,
        is_verified: true,
        is_active: false,
        approval_status: ApprovalStatus.PENDING,
        profile_completed: false,
      }),
    );
    expect(stored?.password).toBeUndefined();
    expect(res.redirect.mock.calls[0][0]).toMatch(
      /^http:\/\/localhost:3000\/en\/auth\/google-result\?exchange=/,
    );
    expect(String(res.redirect.mock.calls[0][0])).not.toContain('token=');
    const firstExchangeCode = new URL(
      String(res.redirect.mock.calls[0][0]),
    ).searchParams.get('exchange');
    expect(firstExchangeCode).toBeTruthy();

    const firstExchange = await request(app.getHttpServer())
      .post('/auth/google/exchange')
      .send({ code: firstExchangeCode })
      .expect(200);
    expect(firstExchange.body.user.profile_completed).toBe(false);

    const incompleteApi = await request(app.getHttpServer())
      .get('/documents')
      .set('Authorization', `Bearer ${firstExchange.body.access_token}`)
      .expect(403);
    expect(incompleteApi.body.code).toBe('PROFILE_COMPLETION_REQUIRED');

    const completed = await request(app.getHttpServer())
      .post('/auth/complete-profile')
      .set('Authorization', `Bearer ${firstExchange.body.access_token}`)
      .send({
        phone: '+21612345678',
        role: Role.TECHNICIAN,
        department: 'Maintenance',
        language: 'fr',
      })
      .expect(200);
    expect(completed.body).toEqual(
      expect.objectContaining({
        code: 'GOOGLE_PROFILE_COMPLETED_PENDING_APPROVAL',
        mandatoryFields: [
          'nom_complet',
          'email',
          'phone',
          'role',
          'department',
          'language',
        ],
      }),
    );

    stored = await users.findOne({ google_id: 'google-new-e2e' });
    expect(stored).toEqual(
      expect.objectContaining({
        role: Role.TECHNICIAN,
        phone: '+21612345678',
        department: 'Maintenance',
        language: 'fr',
        profile_completed: true,
        is_active: false,
        approval_status: ApprovalStatus.PENDING,
      }),
    );

    const pendingApi = await request(app.getHttpServer())
      .get('/documents')
      .set('Authorization', `Bearer ${firstExchange.body.access_token}`)
      .expect(403);
    expect(pendingApi.body.code).toBe('ACCOUNT_PENDING_APPROVAL');

    const { token } = await createApprovedAdmin();
    await request(app.getHttpServer())
      .patch(`/users/${stored?._id.toString()}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    stored = await users.findOne({ google_id: 'google-new-e2e' });
    expect(stored).toEqual(
      expect.objectContaining({
        role: Role.TECHNICIAN,
        is_active: true,
        approval_status: ApprovalStatus.APPROVED,
      }),
    );

    const secondRes = createGoogleRedirectResponse();
    await authService.googleLogin(
      {
        provider: 'google',
        google_id: 'google-new-e2e',
        email: 'new.google.e2e@example.test',
        name: 'New Google E2E',
        email_verified: true,
      },
      secondRes as never,
      'fr',
      'http://localhost:3000',
    );

    expect(
      await users.countDocuments({ email: 'new.google.e2e@example.test' }),
    ).toBe(1);
    const secondExchangeCode = new URL(
      String(secondRes.redirect.mock.calls[0][0]),
    ).searchParams.get('exchange');
    const secondExchange = await request(app.getHttpServer())
      .post('/auth/google/exchange')
      .send({ code: secondExchangeCode })
      .expect(200);
    expect(secondExchange.body.user.role).toBe(Role.TECHNICIAN);

    await request(app.getHttpServer())
      .get('/technician/dashboard')
      .set('Authorization', `Bearer ${secondExchange.body.access_token}`)
      .expect(200);
  });

  it('T2: an incomplete Google profile can restore its session via refresh, but only reaches profile completion (never business APIs), and refresh reverts to blocked once pending approval starts', async () => {
    const incompleteGoogleUser = await createApprovalUser({
      email: 'refresh-restore-e2e@example.test',
      role: Role.OPERATOR,
      google_id: 'google-refresh-restore-e2e',
      is_active: false,
      is_verified: true,
      approval_status: ApprovalStatus.PENDING,
      profile_completed: false,
    });

    const loginResult = await authService.login(incompleteGoogleUser);
    const exchangeCode =
      await googleLoginExchangeService.createExchange(loginResult);

    const exchange = await request(app.getHttpServer())
      .post('/auth/google/exchange')
      .send({ code: exchangeCode })
      .expect(200);
    expect(exchange.body.user.profile_completed).toBe(false);
    expectRefreshCookie(exchange);
    const csrfToken = getCookieValueFromSetCookie(exchange, 'csrf_token');

    // This is the exact request AuthContext fires on every page load/refresh.
    // Before this fix it returned 403 ACCOUNT_PENDING_APPROVAL and wiped the
    // session; it must now succeed and keep reporting profile_completed:false.
    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', getAuthCookieHeader(exchange))
      .set('X-CSRF-Token', csrfToken)
      .expect(200);
    expect(refreshed.body.user).toEqual(
      expect.objectContaining({
        profile_completed: false,
        approval_status: ApprovalStatus.PENDING,
        is_active: false,
      }),
    );
    expectRefreshCookie(refreshed);

    // The restored session still cannot reach business endpoints - only
    // route-level authorization decides that, session restoration does not.
    const blocked = await request(app.getHttpServer())
      .get('/documents')
      .set('Authorization', `Bearer ${refreshed.body.access_token}`)
      .expect(403);
    expect(blocked.body.code).toBe('PROFILE_COMPLETION_REQUIRED');

    // ...but it can still complete the profile with the token obtained from
    // the restored (refreshed) session.
    await request(app.getHttpServer())
      .post('/auth/complete-profile')
      .set('Authorization', `Bearer ${refreshed.body.access_token}`)
      .send({
        phone: '+21612345678',
        role: Role.OPERATOR,
        department: 'Maintenance',
        language: 'en',
      })
      .expect(200);

    // Established behavior preserved: once the profile is complete, the
    // account is a normal "pending admin approval" account, and refresh is
    // blocked exactly like it always was for pending accounts.
    const refreshedCsrfToken = getCookieValueFromSetCookie(
      refreshed,
      'csrf_token',
    );
    const pendingRefresh = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', getAuthCookieHeader(refreshed))
      .set('X-CSRF-Token', refreshedCsrfToken)
      .expect(403);
    expect(pendingRefresh.body.code).toBe('ACCOUNT_PENDING_APPROVAL');
  });

  it('U: approved Google user receives one-time exchange only and the exchange cannot be reused', async () => {
    const approved = await createApprovalUser({
      email: 'approved-google-e2e@example.test',
      role: Role.OPERATOR,
      google_id: 'google-approved-e2e',
      is_active: true,
      is_verified: true,
      approval_status: ApprovalStatus.APPROVED,
      profile_completed: true,
      phone: '+21612345678',
      department: 'Maintenance',
      position: 'Operator',
      language: 'en',
    });
    const res = createGoogleRedirectResponse();

    await authService.googleLogin(
      {
        provider: 'google',
        google_id: 'google-approved-e2e',
        email: 'approved-google-e2e@example.test',
        name: 'Approved Google',
        email_verified: true,
      },
      res as never,
      'fr',
      'http://localhost:3000',
    );

    const redirectUrl = String(res.redirect.mock.calls[0][0]);
    expect(redirectUrl).toMatch(
      /^http:\/\/localhost:3000\/fr\/auth\/google-result\?exchange=/,
    );
    expect(redirectUrl).not.toContain('token=');
    expect(redirectUrl).not.toContain('refresh_token=');
    const exchangeCode = new URL(redirectUrl).searchParams.get('exchange');
    expect(exchangeCode).toBeTruthy();
    const exchangeRecord = await googleLoginExchanges.findOne({
      code_hash: crypto
        .createHash('sha256')
        .update(String(exchangeCode))
        .digest('hex'),
    });
    expect(exchangeRecord).toEqual(
      expect.objectContaining({
        encrypted_payload: expect.any(String),
        encryption_iv: expect.any(String),
        encryption_tag: expect.any(String),
        expires_at: expect.any(Date),
      }),
    );
    expect(JSON.stringify(exchangeRecord?.toObject())).not.toContain(
      'refresh_token',
    );
    expect(JSON.stringify(exchangeRecord?.toObject())).not.toContain(
      'access_token',
    );
    expect(exchangeRecord?.toObject()).not.toHaveProperty('session_payload');

    const exchangeResponse = await request(app.getHttpServer())
      .post('/auth/google/exchange')
      .send({ code: exchangeCode })
      .expect(200);

    expect(exchangeResponse.body.access_token).toEqual(expect.any(String));
    expect(exchangeResponse.body).not.toHaveProperty('refresh_token');
    expectRefreshCookie(exchangeResponse);
    expect(exchangeResponse.body.user).toEqual(
      expect.objectContaining({
        email: approved.email,
        role: Role.OPERATOR,
      }),
    );
    expect(exchangeResponse.body).not.toHaveProperty('token');
    expect(exchangeResponse.body.user).not.toHaveProperty('password');
    expect(exchangeResponse.body.user).not.toHaveProperty('refresh_token_hash');
    expect(exchangeResponse.body.user).not.toHaveProperty('google_id');
    expect(exchangeResponse.body.user).not.toHaveProperty('user_id');

    await request(app.getHttpServer())
      .post('/auth/google/exchange')
      .send({ code: exchangeCode })
      .expect(401);

    const stored = await users.findById(approved._id);
    expect(stored?.last_login).toBeInstanceOf(Date);
    expect(stored?.login_history ?? []).toHaveLength(1);
    expect(stored?.refresh_token_hash).toBeTruthy();
  });

  it('U2: expired Google exchange records are rejected until TTL cleanup removes them', async () => {
    const expiredCode = 'expired-google-exchange-e2e';
    await googleLoginExchanges.create({
      code_hash: crypto.createHash('sha256').update(expiredCode).digest('hex'),
      encrypted_payload: 'ciphertext',
      encryption_iv: 'iv',
      encryption_tag: 'tag',
      expires_at: new Date(Date.now() - 1000),
    });

    await request(app.getHttpServer())
      .post('/auth/google/exchange')
      .send({ code: expiredCode })
      .expect(401);

    const stillStored = await googleLoginExchanges.findOne({
      code_hash: crypto.createHash('sha256').update(expiredCode).digest('hex'),
    });
    expect(stillStored).toBeTruthy();
  });

  it('V: pending, rejected, and inactive Google users cannot obtain an exchange code', async () => {
    const cases = [
      {
        google_id: 'google-pending-e2e',
        email: 'pending-google-e2e@example.test',
        approval_status: ApprovalStatus.PENDING,
        is_active: false,
        profile_completed: true,
        phone: '+21612345678',
        department: 'Maintenance',
        position: 'Operator',
        language: 'en',
        expectedStatus: 'pending',
      },
      {
        google_id: 'google-rejected-e2e',
        email: 'rejected-google-e2e@example.test',
        approval_status: ApprovalStatus.REJECTED,
        is_active: false,
        profile_completed: true,
        phone: '+21612345679',
        department: 'Maintenance',
        position: 'Operator',
        language: 'en',
        expectedStatus: 'rejected',
      },
      {
        google_id: 'google-inactive-e2e',
        email: 'inactive-google-e2e@example.test',
        approval_status: ApprovalStatus.APPROVED,
        is_active: false,
        profile_completed: true,
        phone: '+21612345670',
        department: 'Maintenance',
        position: 'Operator',
        language: 'en',
        expectedStatus: 'inactive',
      },
    ] as const;

    for (const item of cases) {
      await createApprovalUser({
        email: item.email,
        role: Role.OPERATOR,
        google_id: item.google_id,
        is_verified: true,
        is_active: item.is_active,
        approval_status: item.approval_status,
        profile_completed: item.profile_completed,
        phone: item.phone,
        department: item.department,
        position: item.position,
        language: item.language,
      });
      const res = createGoogleRedirectResponse();

      await authService.googleLogin(
        {
          provider: 'google',
          google_id: item.google_id,
          email: item.email,
          name: 'Blocked Google',
          email_verified: true,
        },
        res as never,
        'en',
        'http://localhost:3000',
      );

      const redirectUrl = String(res.redirect.mock.calls[0][0]);
      expect(redirectUrl).toBe(
        `http://localhost:3000/en/auth/google-result?status=${item.expectedStatus}`,
      );
      expect(redirectUrl).not.toContain('exchange=');
      expect(redirectUrl).not.toContain('token=');
    }
  });

  it('W: existing approved local user links Google and succeeds', async () => {
    const localUser = await createApprovalUser({
      email: 'local-link-google-e2e@example.test',
      role: Role.TECHNICIAN,
      is_active: true,
      is_verified: true,
      approval_status: ApprovalStatus.APPROVED,
      google_id: undefined,
      photo: 'manual-photo.png',
      profile_completed: true,
      phone: '+21612345678',
      department: 'Maintenance',
      position: 'Technician',
      language: 'en',
    });
    const res = createGoogleRedirectResponse();

    await authService.googleLogin(
      {
        provider: 'google',
        google_id: 'google-local-link-e2e',
        email: ' LOCAL-LINK-GOOGLE-E2E@example.test ',
        name: 'Local Link Google',
        picture: 'https://lh3.googleusercontent.com/ignored.png',
        email_verified: true,
      },
      res as never,
      'de',
      'http://localhost:3000',
    );

    const stored = await users.findById(localUser._id);
    expect(stored?.google_id).toBe('google-local-link-e2e');
    expect(stored?.role).toBe(Role.TECHNICIAN);
    expect(stored?.is_active).toBe(true);
    expect(stored?.approval_status).toBe(ApprovalStatus.APPROVED);
    expect(stored?.password).toBeTruthy();
    expect(stored?.photo).toBe('manual-photo.png');
    expect(String(res.redirect.mock.calls[0][0])).toMatch(
      /^http:\/\/localhost:3000\/de\/auth\/google-result\?exchange=/,
    );
  });

  it('X: Google account conflict fails safely without revealing account details', async () => {
    await createApprovalUser({
      email: 'google-owner-e2e@example.test',
      role: Role.OPERATOR,
      google_id: 'google-conflict-e2e',
      is_active: true,
      is_verified: true,
      approval_status: ApprovalStatus.APPROVED,
    });
    await createApprovalUser({
      email: 'email-owner-e2e@example.test',
      role: Role.OPERATOR,
      is_active: true,
      is_verified: true,
      approval_status: ApprovalStatus.APPROVED,
    });
    const res = createGoogleRedirectResponse();

    await authService.googleLogin(
      {
        provider: 'google',
        google_id: 'google-conflict-e2e',
        email: 'email-owner-e2e@example.test',
        name: 'Conflict Google',
        email_verified: true,
      },
      res as never,
      'it',
      'http://localhost:3000',
    );

    expect(res.redirect).toHaveBeenCalledWith(
      'http://localhost:3000/it/auth/google-result?status=failed',
    );
    expect(String(res.redirect.mock.calls[0][0])).not.toContain(
      'email-owner-e2e',
    );
  });

  it('Y: administrators can unlink and relink Google auth while preserving password login and audit history', async () => {
    const { admin, token } = await createApprovedAdmin();
    const target = await createApprovalUser({
      email: 'google-admin-managed-e2e@example.test',
      role: Role.OPERATOR,
      google_id: 'google-admin-old-e2e',
      is_active: true,
      is_verified: true,
      approval_status: ApprovalStatus.APPROVED,
    });
    await createApprovalUser({
      email: 'google-admin-owner-e2e@example.test',
      role: Role.TECHNICIAN,
      google_id: 'google-admin-owned-e2e',
      is_active: true,
      is_verified: true,
      approval_status: ApprovalStatus.APPROVED,
    });

    await request(app.getHttpServer())
      .patch(`/users/${target._id.toString()}/google-auth`)
      .set('Authorization', `Bearer ${token}`)
      .send({ google_id: 'google-admin-new-e2e' })
      .expect(200);

    let stored = await users.findById(target._id);
    expect(stored?.google_id).toBe('google-admin-new-e2e');
    expect(stored?.password).toBeTruthy();
    expect(stored?.google_auth_history?.at(-1)).toEqual(
      expect.objectContaining({
        action: 'relinked',
        google_id: 'google-admin-new-e2e',
        previous_google_id: 'google-admin-old-e2e',
        actor_user_id: admin._id,
      }),
    );

    await request(app.getHttpServer())
      .patch(`/users/${target._id.toString()}/google-auth`)
      .set('Authorization', `Bearer ${token}`)
      .send({ google_id: 'google-admin-owned-e2e' })
      .expect(409);

    stored = await users.findById(target._id);
    expect(stored?.google_id).toBe('google-admin-new-e2e');

    await request(app.getHttpServer())
      .delete(`/users/${target._id.toString()}/google-auth`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/users/${target._id.toString()}/google-auth`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    stored = await users.findById(target._id);
    expect(stored?.google_id).toBeUndefined();
    expect(stored?.password).toBeTruthy();
    expect(stored?.google_auth_history?.at(-1)).toEqual(
      expect.objectContaining({
        action: 'unlinked',
        previous_google_id: 'google-admin-new-e2e',
        actor_user_id: admin._id,
      }),
    );

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'google-admin-managed-e2e@example.test',
        password: 'P@ssword123!',
      })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/users/${target._id.toString()}/google-auth`)
      .set('Authorization', `Bearer ${token}`)
      .send({ google_id: 'google-admin-relinked-e2e' })
      .expect(200);

    stored = await users.findById(target._id);
    expect(stored?.google_id).toBe('google-admin-relinked-e2e');
    expect(stored?.google_auth_history?.at(-1)).toEqual(
      expect.objectContaining({
        action: 'linked',
        google_id: 'google-admin-relinked-e2e',
        actor_user_id: admin._id,
      }),
    );
  });

  it('Z: approved users refresh successfully with a stable refresh token', async () => {
    const user = await createApprovalUser({
      email: 'refresh-approved-e2e@example.test',
      role: Role.OPERATOR,
      is_active: true,
      is_verified: true,
      approval_status: ApprovalStatus.APPROVED,
    });

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: user.email,
        password: 'P@ssword123!',
      })
      .expect(200);

    expect(loginResponse.body).not.toHaveProperty('refresh_token');
    expectRefreshCookie(loginResponse);
    const oldRefreshToken = getCookieValueFromSetCookie(
      loginResponse,
      'refresh_token',
    );
    const oldCsrfToken = getCookieValueFromSetCookie(
      loginResponse,
      'csrf_token',
    );

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', getAuthCookieHeader(loginResponse))
      .expect(403);

    const firstRefresh = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', getAuthCookieHeader(loginResponse))
      .set('X-CSRF-Token', oldCsrfToken)
      .expect(200);

    expect(firstRefresh.body.access_token).toEqual(expect.any(String));
    expect(firstRefresh.body).not.toHaveProperty('refresh_token');
    expectRefreshCookie(firstRefresh);
    const refreshedRefreshToken = getCookieValueFromSetCookie(
      firstRefresh,
      'refresh_token',
    );
    const rotatedCsrfToken = getCookieValueFromSetCookie(
      firstRefresh,
      'csrf_token',
    );
    expect(refreshedRefreshToken).toBe(oldRefreshToken);
    expect(firstRefresh.body.user).toEqual(
      expect.objectContaining({
        email: user.email,
        role: Role.OPERATOR,
        is_active: true,
        is_verified: true,
      }),
    );
    expect(firstRefresh.body.user).not.toHaveProperty('password');
    expect(firstRefresh.body.user).not.toHaveProperty('refresh_token_hash');
    expect(firstRefresh.body.user).not.toHaveProperty('google_id');
    expect(firstRefresh.body.user).not.toHaveProperty('user_id');

    const storedAfterRefresh = await users.findById(user._id);
    expect(storedAfterRefresh?.login_history ?? []).toHaveLength(1);

    const stableRefresh = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refresh_token: oldRefreshToken })
      .expect(200);
    expect(stableRefresh.body.access_token).toEqual(expect.any(String));

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', getAuthCookieHeader(firstRefresh))
      .set('X-CSRF-Token', rotatedCsrfToken)
      .expect(200);

    const logout = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${firstRefresh.body.access_token}`)
      .set('Cookie', getAuthCookieHeader(firstRefresh))
      .set('X-CSRF-Token', rotatedCsrfToken)
      .expect(200);
    expect(
      getSetCookies(logout).some((cookie) => /^refresh_token=;/.test(cookie)),
    ).toBe(true);
  });

  it('AA: refresh rejects invalid tokens, access tokens, pending, rejected, inactive, and deleted users', async () => {
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({})
      .expect(401);

    const invalid = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refresh_token: 'not-a-jwt' })
      .expect(401);
    expect(invalid.body.code).toBe('REFRESH_TOKEN_INVALID_OR_EXPIRED');

    const accessUser = await createApprovalUser({
      email: 'refresh-access-token-e2e@example.test',
      role: Role.OPERATOR,
      is_active: true,
      is_verified: true,
      approval_status: ApprovalStatus.APPROVED,
    });
    const accessToken = tokenFor(accessUser);
    const wrongType = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refresh_token: accessToken })
      .expect(401);
    expect([
      'REFRESH_TOKEN_INVALID_OR_EXPIRED',
      'REFRESH_TOKEN_WRONG_TYPE',
    ]).toContain(wrongType.body.code);

    const pendingUser = await createApprovalUser({
      email: 'refresh-pending-e2e@example.test',
      role: Role.OPERATOR,
      is_active: false,
      is_verified: true,
      approval_status: ApprovalStatus.PENDING,
      refresh_token_hash: 'placeholder',
    });
    const pendingRefresh = jwtService.sign(
      { sub: pendingUser._id.toString(), type: 'refresh' },
      { secret: process.env.JWT_REFRESH_SECRET },
    );
    const pending = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refresh_token: pendingRefresh })
      .expect(403);
    expect(pending.body.code).toBe('ACCOUNT_PENDING_APPROVAL');

    const rejectedUser = await createApprovalUser({
      email: 'refresh-rejected-e2e@example.test',
      role: Role.OPERATOR,
      is_active: false,
      is_verified: true,
      approval_status: ApprovalStatus.REJECTED,
    });
    const rejectedRefresh = jwtService.sign(
      { sub: rejectedUser._id.toString(), type: 'refresh' },
      { secret: process.env.JWT_REFRESH_SECRET },
    );
    const rejected = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refresh_token: rejectedRefresh })
      .expect(403);
    expect(rejected.body.code).toBe('ACCOUNT_REJECTED');

    const inactiveUser = await createApprovalUser({
      email: 'refresh-inactive-e2e@example.test',
      role: Role.OPERATOR,
      is_active: false,
      is_verified: true,
      approval_status: ApprovalStatus.APPROVED,
    });
    const inactiveRefresh = jwtService.sign(
      { sub: inactiveUser._id.toString(), type: 'refresh' },
      { secret: process.env.JWT_REFRESH_SECRET },
    );
    const inactive = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refresh_token: inactiveRefresh })
      .expect(403);
    expect(inactive.body.code).toBe('ACCOUNT_INACTIVE');

    const deletedUser = await createApprovalUser({
      email: 'refresh-deleted-e2e@example.test',
      role: Role.OPERATOR,
      is_active: true,
      is_verified: true,
      approval_status: ApprovalStatus.APPROVED,
    });
    const deletedRefresh = jwtService.sign(
      { sub: deletedUser._id.toString(), type: 'refresh' },
      { secret: process.env.JWT_REFRESH_SECRET },
    );
    await users.findByIdAndDelete(deletedUser._id);
    const deleted = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refresh_token: deletedRefresh })
      .expect(401);
    expect(deleted.body.code).toBe('REFRESH_USER_NOT_FOUND');
  });

  it('AB: concurrent refresh requests with the same valid token both succeed', async () => {
    const user = await createApprovalUser({
      email: 'refresh-concurrent-e2e@example.test',
      role: Role.OPERATOR,
      is_active: true,
      is_verified: true,
      approval_status: ApprovalStatus.APPROVED,
    });

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: user.email,
        password: 'P@ssword123!',
      })
      .expect(200);

    const refreshToken = getCookieValueFromSetCookie(
      loginResponse,
      'refresh_token',
    );
    const [one, two] = await Promise.all([
      request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: refreshToken }),
      request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: refreshToken }),
    ]);

    const statuses = [one.status, two.status].sort();
    expect(statuses).toEqual([200, 200]);
    expect(one.body.access_token).toEqual(expect.any(String));
    expect(two.body.access_token).toEqual(expect.any(String));
  });

  it('AC: production login cookies are HttpOnly, Secure, and SameSite=None', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const user = await createApprovalUser({
      email: 'production-cookie-e2e@example.test',
      role: Role.OPERATOR,
      is_active: true,
      is_verified: true,
      approval_status: ApprovalStatus.APPROVED,
    });

    process.env.NODE_ENV = 'production';
    try {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: user.email,
          password: 'P@ssword123!',
        })
        .expect(200);

      const refreshCookie = getSetCookies(response).find((cookie) =>
        cookie.startsWith('refresh_token='),
      );
      const csrfCookie = getSetCookies(response).find((cookie) =>
        cookie.startsWith('csrf_token='),
      );

      expect(refreshCookie).toEqual(expect.stringContaining('HttpOnly'));
      expect(refreshCookie).toEqual(expect.stringContaining('Secure'));
      expect(refreshCookie).toEqual(expect.stringContaining('SameSite=None'));
      expect(csrfCookie).toEqual(expect.stringContaining('Secure'));
      expect(csrfCookie).toEqual(expect.stringContaining('SameSite=None'));
      expect(csrfCookie).not.toEqual(expect.stringContaining('HttpOnly'));
      expect(response.body).not.toHaveProperty('refresh_token');
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('AD: throttles repeated failed login attempts by normalized email', async () => {
    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', '203.0.113.101')
        .send({
          email: ' THROTTLED-LOGIN@example.test ',
          password: 'WrongPassword123!',
        })
        .expect(401);
    }

    const throttled = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '203.0.113.101')
      .send({
        email: 'throttled-login@example.test',
        password: 'WrongPassword123!',
      })
      .expect(429);

    expect(throttled.body.code).toBe('AUTH_TOO_MANY_ATTEMPTS');
  });

  it('AE: throttles forgot-password without revealing whether the email exists', async () => {
    for (let i = 0; i < 3; i += 1) {
      const response = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .set('X-Forwarded-For', '203.0.113.102')
        .send({ email: 'missing-forgot-throttle@example.test' })
        .expect(201);

      expect(response.body.message).toBe(
        'If an account exists with that email, a password reset link has been sent.',
      );
    }

    const throttled = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', '203.0.113.102')
      .send({ email: ' MISSING-FORGOT-THROTTLE@example.test ' })
      .expect(429);

    expect(throttled.body).toEqual(
      expect.objectContaining({
        code: 'AUTH_TOO_MANY_ATTEMPTS',
        message: 'Too many authentication attempts. Please try again later.',
      }),
    );
  });

  it('AF: throttles reset-token verification, reset-password, Google exchange, and registration', async () => {
    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post('/auth/verify-reset-token')
        .set('X-Forwarded-For', '203.0.113.103')
        .send({ token: 'invalid-reset-token' })
        .expect(400);
    }
    await request(app.getHttpServer())
      .post('/auth/verify-reset-token')
      .set('X-Forwarded-For', '203.0.113.103')
      .send({ token: 'invalid-reset-token' })
      .expect(429);

    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .set('X-Forwarded-For', '203.0.113.104')
        .send({
          token: 'invalid-reset-password-token',
          password: 'P@ssword123!',
        })
        .expect(400);
    }
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .set('X-Forwarded-For', '203.0.113.104')
      .send({
        token: 'invalid-reset-password-token',
        password: 'P@ssword123!',
      })
      .expect(429);

    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post('/auth/google/exchange')
        .set('X-Forwarded-For', '203.0.113.105')
        .send({ code: 'invalid-google-exchange-code' })
        .expect(401);
    }
    await request(app.getHttpServer())
      .post('/auth/google/exchange')
      .set('X-Forwarded-For', '203.0.113.105')
      .send({ code: 'invalid-google-exchange-code' })
      .expect(429);

    await createApprovalUser({
      email: 'register-throttle@example.test',
      role: Role.OPERATOR,
    });

    for (let i = 0; i < 3; i += 1) {
      await request(app.getHttpServer())
        .post('/auth/register')
        .set('X-Forwarded-For', '203.0.113.106')
        .send({
          nom_complet: 'Register Throttle',
          email: 'REGISTER-THROTTLE@example.test',
          password: 'P@ssword123!',
          role: Role.OPERATOR,
        })
        .expect(409);
    }
    await request(app.getHttpServer())
      .post('/auth/register')
      .set('X-Forwarded-For', '203.0.113.106')
      .send({
        nom_complet: 'Register Throttle',
        email: 'register-throttle@example.test',
        password: 'P@ssword123!',
        role: Role.OPERATOR,
      })
      .expect(429);
  });

  it('AG: an administrator-approved account stays approved through login, repeated refresh, logout, password reset, an admin profile edit, email re-verification, Google OAuth login, and profile resubmission', async () => {
    const usersService = app.get(UsersService);
    const emailVerificationTokenService = app.get(
      EmailVerificationTokenService,
    );
    const { admin: approver, token: approverToken } =
      await createApprovedAdmin();

    // Seeded exactly like a real approved Google-onboarded technician:
    // verified, active, profile complete, and with the approval decision
    // already recorded (approved_by/approved_at + one history entry) via
    // the real approveUser transition, not by hand — so this test starts
    // from the same state the approve endpoint actually produces.
    const target = await createApprovalUser({
      email: 'lifecycle-approved-e2e@example.test',
      role: Role.OPERATOR,
      is_active: false,
      is_verified: true,
      profile_completed: true,
      google_id: 'google-lifecycle-e2e',
      phone: '+21612340000',
      department: 'Maintenance',
      language: 'en',
      approval_status: ApprovalStatus.PENDING,
    });

    await request(app.getHttpServer())
      .patch(`/users/${target._id.toString()}/approve`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    const expectStillApproved = async () => {
      const stored = await users.findById(target._id);
      expect(stored?.approval_status).toBe(ApprovalStatus.APPROVED);
      expect(stored?.is_active).toBe(true);
      expect(stored?.approved_by).toEqual(approver._id);
      expect(stored?.approved_at).toBeTruthy();
      expect(stored?.rejected_by).toBeUndefined();
      expect(stored?.rejected_at).toBeUndefined();
      // Every prior transition stays on the audit trail — nothing here
      // ever unsets or rewrites approval_history.
      expect(stored?.approval_history).toHaveLength(1);
      expect(stored?.approval_history?.[0]).toEqual(
        expect.objectContaining({ status: ApprovalStatus.APPROVED }),
      );
      return stored!;
    };

    await expectStillApproved();

    // 1) LOGIN
    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: target.email, password: 'P@ssword123!' })
      .expect(200);
    expectRefreshCookie(loginResponse);
    const accessToken = loginResponse.body.access_token as string;
    await expectStillApproved();

    // 2) REPEATED SESSION RESTORATION (refresh, twice, rotating each time)
    const firstRefresh = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', getAuthCookieHeader(loginResponse))
      .set(
        'X-CSRF-Token',
        getCookieValueFromSetCookie(loginResponse, 'csrf_token'),
      )
      .expect(200);
    await expectStillApproved();

    const secondRefresh = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', getAuthCookieHeader(firstRefresh))
      .set(
        'X-CSRF-Token',
        getCookieValueFromSetCookie(firstRefresh, 'csrf_token'),
      )
      .expect(200);
    await expectStillApproved();

    // 3) LOGOUT
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', getAuthCookieHeader(secondRefresh))
      .set(
        'X-CSRF-Token',
        getCookieValueFromSetCookie(secondRefresh, 'csrf_token'),
      )
      .expect(200);
    await expectStillApproved();

    // 4) PASSWORD RESET (real controller round trip; the plaintext token is
    // written straight into the DB using the same sha256 hash the service
    // computes internally, so this doesn't depend on outbound email).
    const plaintextResetToken = 'lifecycle-e2e-reset-token';
    await users.findByIdAndUpdate(target._id, {
      reset_password_token: crypto
        .createHash('sha256')
        .update(plaintextResetToken)
        .digest('hex'),
      reset_password_expires: new Date(Date.now() + 60 * 60 * 1000),
    });
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: plaintextResetToken, password: 'NewP@ssword456!' })
      .expect(201);
    await expectStillApproved();

    // 5) ADMIN PROFILE UPDATE (generic PATCH /users/:id) — a legitimate
    // field edit must go through untouched, and the service layer must
    // strip approval fields defensively even if a caller supplies them
    // directly (bypassing the HTTP DTO whitelist), rather than letting
    // them reach the database.
    await request(app.getHttpServer())
      .patch(`/users/${target._id.toString()}`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ phone: '+21699998888' })
      .expect(200);
    expect((await expectStillApproved()).phone).toBe('+21699998888');

    await usersService.update(target._id.toString(), {
      department: 'Updated Department',
      approval_status: ApprovalStatus.REJECTED,
      rejected_by: approver._id,
      rejection_reason: 'smuggled via generic update',
    } as never);
    const afterServiceUpdate = await expectStillApproved();
    expect(afterServiceUpdate.department).toBe('Updated Department');

    // 6) EMAIL VERIFICATION (re-verification is idempotent for an
    // already-verified user, and must never touch approval fields)
    const verificationToken = emailVerificationTokenService.issueToken(
      target._id.toString(),
    );
    await request(app.getHttpServer())
      .get(`/auth/verify-email?token=${verificationToken}`)
      .expect(200);
    await expectStillApproved();

    // 7) GOOGLE OAUTH LOGIN — this is exactly the path that used to reset
    // approval_status back to PENDING and wipe approved_by/approved_at
    // whenever the Google profile-completeness check ran again.
    const googleRes = { redirect: jest.fn(), clearCookie: jest.fn() };
    await authService.googleLogin(
      {
        provider: 'google',
        google_id: 'google-lifecycle-e2e',
        email: target.email,
        name: 'Lifecycle E2E',
        email_verified: true,
      },
      googleRes as never,
      'en',
      'http://localhost:3000',
    );
    expect(googleRes.redirect.mock.calls[0][0]).toMatch(
      /^http:\/\/localhost:3000\/en\/auth\/google-result\?exchange=/,
    );
    await expectStillApproved();

    // 8) PROFILE RESUBMISSION via the real /auth/complete-profile endpoint
    // — the exact regression this whole test guards against: resubmitting
    // an already-complete Google profile must report the account as
    // still-approved (not "pending approval") and must not touch
    // approval_status/is_active/approved_by/approved_at.
    const resubmit = await request(app.getHttpServer())
      .post('/auth/complete-profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        phone: '+21699998888',
        role: Role.OPERATOR,
        department: 'Updated Department',
        language: 'en',
      })
      .expect(200);
    expect(resubmit.body.code).toBe('GOOGLE_PROFILE_COMPLETED');
    expect(resubmit.body.user.approval_status).toBe(ApprovalStatus.APPROVED);
    expect(resubmit.body.user.is_active).toBe(true);

    // 9) "BACKEND RESTART" proxy: read the row back from MongoDB completely
    // independently of any in-memory service/request state to prove the
    // approval is durable, not an artifact of one response object.
    const finalStored = await usersService.findOne(target._id.toString());
    expect(finalStored?.approval_status).toBe(ApprovalStatus.APPROVED);
    expect(finalStored?.is_active).toBe(true);
    expect(finalStored?.approved_by).toEqual(approver._id);
    expect(finalStored?.approval_history).toHaveLength(1);
  });
});
