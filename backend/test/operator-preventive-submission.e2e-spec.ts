/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model } from 'mongoose';
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
import {
  MaintenancePlan,
  MaintenancePlanDocument,
} from '../src/schemas/maintenance-plan.schema';
import { WorkOrder, WorkOrderDocument } from '../src/schemas/work-order.schema';
import {
  InterventionReport,
  InterventionReportDocument,
} from '../src/schemas/intervention-report.schema';
import { Lubrifiant, LubrifiantDocument } from '../src/schemas/lubrifiant.schema';
import {
  LubrificationLog,
  LubrificationLogDocument,
} from '../src/schemas/lubrification-log.schema';

describe('Operator preventive-maintenance submission (e2e)', () => {
  let mongo: MongoMemoryReplSet;
  let app: INestApplication<App>;
  let jwtService: JwtService;
  let connection: Connection;
  let users: Model<UserDocument>;
  let machineTypes: Model<MachineTypeDocument>;
  let machines: Model<MachineDocument>;
  let moduleTypes: Model<ModuleTypeDocument>;
  let modules: Model<ModuleDocument>;
  let plans: Model<MaintenancePlanDocument>;
  let workOrders: Model<WorkOrderDocument>;
  let reports: Model<InterventionReportDocument>;
  let lubrifiants: Model<LubrifiantDocument>;
  let lubrificationLogs: Model<LubrificationLogDocument>;

  let operatorToken: string;
  let otherOperatorToken: string;
  let technicianToken: string;
  let adminToken: string;
  let operator: UserDocument;
  let machine: MachineDocument;
  let moduleEntity: ModuleDocument;
  let plan: MaintenancePlanDocument;
  let lubrifiant: LubrifiantDocument;

  beforeAll(async () => {
    // A single-node replica set is required: the endpoint under test relies
    // on a real multi-document transaction, which standalone MongoDB (plain
    // MongoMemoryServer) does not support.
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongo.getUri('gmao_preventive_submission_e2e');
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
    plans = app.get(getModelToken(MaintenancePlan.name));
    workOrders = app.get(getModelToken(WorkOrder.name));
    reports = app.get(getModelToken(InterventionReport.name));
    lubrifiants = app.get(getModelToken(Lubrifiant.name));
    lubrificationLogs = app.get(getModelToken(LubrificationLog.name));

    await seedBaseData();
  }, 180_000);

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
      name: 'Preventive submission E2E machine type',
    });
    const moduleType = await moduleTypes.create({
      mod_type_id: 'MODTYPE-PREV-E2E',
      type_id: machineType._id,
      nom_module: 'Preventive submission E2E module type',
    });
    machine = await machines.create({
      machine_id: 'MACHINE-PREV-SUBMIT',
      type_id: machineType._id,
      serial_no: 'PREV-SUBMIT-001',
      status: 'active',
    });
    moduleEntity = await modules.create({
      module_id: 'MODULE-PREV-SUBMIT',
      machine_id: machine._id,
      mod_type_id: moduleType._id,
    });
    plan = await plans.create({
      plan_id: 'PLAN-PREV-SUBMIT',
      module_id: moduleEntity._id,
      type_maintenance: 'preventive',
      frequence: 1,
      unite_frequence: 'monthly',
      maintenance_code: 'PREV-SUBMIT',
      instruction: 'Check belt tension',
    });
    lubrifiant = await lubrifiants.create({
      lubrifiant_id: 'LUB-PREV-SUBMIT',
      nom: 'Grease XT',
      type: 'grease',
    });

    operator = await users.create({
      user_id: 'OP-PREV-SUBMIT-E2E',
      nom_complet: 'Preventive Operator',
      email: 'preventive-operator-e2e@example.test',
      password: 'x',
      role: 'operator',
      is_active: true,
      is_verified: true,
      assigned_machine_ids: [machine._id],
    });
    const otherOperator = await users.create({
      user_id: 'OP-PREV-OTHER-E2E',
      nom_complet: 'Other Preventive Operator',
      email: 'preventive-other-operator-e2e@example.test',
      password: 'x',
      role: 'operator',
      is_active: true,
      is_verified: true,
      assigned_machine_ids: [machine._id],
    });
    const technician = await users.create({
      user_id: 'TECH-PREV-SUBMIT-E2E',
      nom_complet: 'Preventive Technician',
      email: 'preventive-technician-e2e@example.test',
      password: 'x',
      role: 'technician',
      is_active: true,
      is_verified: true,
    });
    const admin = await users.create({
      user_id: 'ADMIN-PREV-SUBMIT-E2E',
      nom_complet: 'Preventive Admin',
      email: 'preventive-admin-e2e@example.test',
      password: 'x',
      role: 'admin',
      is_active: true,
      is_verified: true,
    });

    operatorToken = tokenFor(operator);
    otherOperatorToken = tokenFor(otherOperator);
    technicianToken = tokenFor(technician);
    adminToken = tokenFor(admin);
  }

  async function createScheduledOccurrence(overrides: Record<string, unknown> = {}) {
    return workOrders.create({
      ot_id: `WO-PREV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      machine_id: machine._id,
      module_id: moduleEntity._id,
      technician_id: operator._id,
      plan_id: plan._id,
      description: plan.instruction,
      type_maintenance: 'preventive',
      status: 'scheduled',
      priorite: 'medium',
      date_created: new Date('2026-06-01T08:00:00.000Z'),
      date_start: new Date('2026-07-14T08:00:00.000Z'),
      scheduled_date: new Date('2026-07-14T08:00:00.000Z'),
      due_date: new Date('2026-07-14T08:00:00.000Z'),
      ...overrides,
    });
  }

  it('rejects an anonymous request', async () => {
    const occurrence = await createScheduledOccurrence();

    await request(app.getHttpServer())
      .post('/operator/preventive/submit')
      .send({
        work_order_id: occurrence._id.toString(),
        tasks_completed: ['Check belt tension'],
        condition: 'good',
      })
      .expect(401);
  });

  it('rejects a technician (Operator-only endpoint)', async () => {
    const occurrence = await createScheduledOccurrence();

    await request(app.getHttpServer())
      .post('/operator/preventive/submit')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({
        work_order_id: occurrence._id.toString(),
        tasks_completed: ['Check belt tension'],
        condition: 'good',
      })
      .expect(403);
  });

  it('rejects a request that tries to smuggle a client-supplied identity or status field', async () => {
    const occurrence = await createScheduledOccurrence();

    await request(app.getHttpServer())
      .post('/operator/preventive/submit')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        work_order_id: occurrence._id.toString(),
        tasks_completed: ['Check belt tension'],
        condition: 'good',
        technician_id: '000000000000000000000000',
        status: 'validated',
        execution_date: '2000-01-01T00:00:00.000Z',
      })
      .expect(400);

    const stored = await workOrders.findById(occurrence._id);
    expect(stored?.status).toBe('scheduled');
  });

  it('rejects missing required fields', async () => {
    const occurrence = await createScheduledOccurrence();

    await request(app.getHttpServer())
      .post('/operator/preventive/submit')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        work_order_id: occurrence._id.toString(),
        tasks_completed: [],
        condition: 'good',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/operator/preventive/submit')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        work_order_id: occurrence._id.toString(),
        tasks_completed: ['Check belt tension'],
        condition: '',
      })
      .expect(400);
  });

  it('rejects a machine not assigned to the Operator', async () => {
    const otherMachine = await machines.create({
      machine_id: `MACHINE-UNASSIGNED-${Date.now()}`,
      type_id: machine.type_id,
      serial_no: `UNASSIGNED-${Date.now()}`,
      status: 'active',
    });
    const otherModule = await modules.create({
      module_id: `MODULE-UNASSIGNED-${Date.now()}`,
      machine_id: otherMachine._id,
      mod_type_id: moduleEntity.mod_type_id,
    });
    // Assigned to a different operator so the acting operator's own
    // work-order history doesn't incidentally grant them access to this
    // machine — this test is specifically about machine assignment, not
    // occurrence ownership (covered separately below).
    const otherOperator = await users.findOne({ user_id: 'OP-PREV-OTHER-E2E' });
    const occurrence = await createScheduledOccurrence({
      machine_id: otherMachine._id,
      module_id: otherModule._id,
      technician_id: otherOperator?._id,
    });

    await request(app.getHttpServer())
      .post('/operator/preventive/submit')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        work_order_id: occurrence._id.toString(),
        tasks_completed: ['Check belt tension'],
        condition: 'good',
      })
      .expect(403);
  });

  it('rejects an occurrence assigned to a different operator on the same machine (ownership, not just machine assignment)', async () => {
    const otherOperator = await users.findOne({ user_id: 'OP-PREV-OTHER-E2E' });
    const occurrence = await createScheduledOccurrence({
      technician_id: otherOperator?._id,
    });

    await request(app.getHttpServer())
      .post('/operator/preventive/submit')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        work_order_id: occurrence._id.toString(),
        tasks_completed: ['Check belt tension'],
        condition: 'good',
      })
      .expect(403);
  });

  it('submits the assigned occurrence: updates the work order, creates the report, records no lubrication log, and never triggers recurrence by itself', async () => {
    const occurrence = await createScheduledOccurrence();

    const before = new Date();
    const response = await request(app.getHttpServer())
      .post('/operator/preventive/submit')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        work_order_id: occurrence._id.toString(),
        tasks_completed: ['Check belt tension', 'Inspect wiring'],
        condition: 'good',
        comments: 'All nominal',
      })
      .expect(201);
    const after = new Date();

    expect(response.body.workOrder._id).toBe(occurrence._id.toString());
    expect(response.body.workOrder.status).toBe('waiting_validation');
    expect(response.body.lubricationLog).toBeNull();

    const storedOrder = await workOrders.findById(occurrence._id);
    expect(storedOrder?.status).toBe('waiting_validation');
    expect(storedOrder?.description).toBe('Check belt tension | Inspect wiring');
    // execution_date is derived from the server clock at request time, never
    // from any client-supplied value.
    const executionDate = storedOrder?.execution_date as Date;
    expect(executionDate.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(executionDate.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);

    const storedReport = await reports.findById(response.body.report._id);
    expect(storedReport?.ot_id.toString()).toBe(occurrence._id.toString());
    expect(storedReport?.technician_id?.toString()).toBe(operator._id.toString());
    expect(storedReport?.cause_racine).toBe('All nominal');
    expect(storedReport?.description_action).toBe('Check belt tension | Inspect wiring');
    expect(storedReport?.etat_final).toBe('good');
    expect(storedReport?.validation_responsable).toBe('waiting_validation');

    // Recurrence safety: submitting (waiting_validation) must not by itself
    // create the next occurrence — only the existing validation lifecycle
    // (approve) does that.
    expect(
      await workOrders.countDocuments({
        recurrence_source_occurrence_id: occurrence._id,
      }),
    ).toBe(0);
  });

  it('records a lubrication log tied to the occurrence module only when lubrication input is supplied', async () => {
    const occurrence = await createScheduledOccurrence();

    const response = await request(app.getHttpServer())
      .post('/operator/preventive/submit')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        work_order_id: occurrence._id.toString(),
        tasks_completed: ['Grease bearings'],
        condition: 'good',
        lubrication: { lubrifiant_id: lubrifiant._id.toString(), quantity: 3 },
      })
      .expect(201);

    expect(response.body.lubricationLog).not.toBeNull();
    const storedLog = await lubrificationLogs.findById(
      response.body.lubricationLog._id,
    );
    expect(storedLog?.module_id.toString()).toBe(moduleEntity._id.toString());
    expect(storedLog?.lubrifiant_id.toString()).toBe(lubrifiant._id.toString());
    expect(storedLog?.quantite).toBe(3);
    expect(storedLog?.technician_id.toString()).toBe(operator._id.toString());
  });

  it('rejects resubmitting the same occurrence as a duplicate and creates no second report', async () => {
    const occurrence = await createScheduledOccurrence();

    await request(app.getHttpServer())
      .post('/operator/preventive/submit')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        work_order_id: occurrence._id.toString(),
        tasks_completed: ['Check belt tension'],
        condition: 'good',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/operator/preventive/submit')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        work_order_id: occurrence._id.toString(),
        tasks_completed: ['Check belt tension'],
        condition: 'good',
      })
      .expect(409);

    expect(await reports.countDocuments({ ot_id: occurrence._id })).toBe(1);
  });

  it('rolls back the work order status when the intervention report write fails, leaving it resubmittable', async () => {
    const occurrence = await createScheduledOccurrence();
    const createSpy = jest
      .spyOn(reports, 'create')
      .mockRejectedValueOnce(new Error('simulated report insert failure'));

    await request(app.getHttpServer())
      .post('/operator/preventive/submit')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        work_order_id: occurrence._id.toString(),
        tasks_completed: ['Check belt tension'],
        condition: 'good',
      })
      .expect(500);

    const storedAfterFailure = await workOrders.findById(occurrence._id);
    expect(storedAfterFailure?.status).toBe('scheduled');
    expect(await reports.countDocuments({ ot_id: occurrence._id })).toBe(0);

    createSpy.mockRestore();

    await request(app.getHttpServer())
      .post('/operator/preventive/submit')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        work_order_id: occurrence._id.toString(),
        tasks_completed: ['Check belt tension'],
        condition: 'good',
      })
      .expect(201);

    const storedAfterRetry = await workOrders.findById(occurrence._id);
    expect(storedAfterRetry?.status).toBe('waiting_validation');
  });

  it('creates the next recurrence only after admin approval, computed from the real execution date rather than the original due date', async () => {
    // The occurrence was originally due 2026-07-14 but is submitted "late" —
    // the next occurrence must be scheduled one month from the real
    // execution date captured at submission time, not from the stale due
    // date, and must not appear before that approval happens.
    const occurrence = await createScheduledOccurrence({
      due_date: new Date('2026-07-14T08:00:00.000Z'),
      scheduled_date: new Date('2026-07-14T08:00:00.000Z'),
      date_start: new Date('2026-07-14T08:00:00.000Z'),
    });

    const submitResponse = await request(app.getHttpServer())
      .post('/operator/preventive/submit')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        work_order_id: occurrence._id.toString(),
        tasks_completed: ['Check belt tension'],
        condition: 'good',
      })
      .expect(201);

    const executionDate = new Date(submitResponse.body.workOrder.execution_date);

    expect(
      await workOrders.countDocuments({
        recurrence_source_occurrence_id: occurrence._id,
      }),
    ).toBe(0);

    await request(app.getHttpServer())
      .post(`/work-orders/${occurrence._id.toString()}/validation`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'approve' })
      .expect(201);

    const next = await workOrders.findOne({
      recurrence_source_occurrence_id: occurrence._id,
    });
    expect(next).not.toBeNull();

    const expectedNextDue = new Date(executionDate);
    expectedNextDue.setMonth(expectedNextDue.getMonth() + 1);
    // The plan's monthly cadence is applied to the real execution date
    // (submission time), not to the original 2026-07-14 due date.
    expect(next?.due_date?.toISOString().slice(0, 10)).toBe(
      expectedNextDue.toISOString().slice(0, 10),
    );
    expect(next?.due_date?.toISOString().slice(0, 10)).not.toBe('2026-08-14');
  });
});
