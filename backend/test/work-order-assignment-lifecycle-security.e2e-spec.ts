/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
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
import { WorkOrder, WorkOrderDocument } from '../src/schemas/work-order.schema';
import {
  InterventionReport,
  InterventionReportDocument,
} from '../src/schemas/intervention-report.schema';

type MutationKind =
  | 'technician_claim'
  | 'technician_waiting_parts'
  | 'operator_start'
  | 'admin_validation';

type AccountStateCase = {
  name: string;
  expectedStatus: number;
  expectedCode: string;
  userPatch?: Partial<User>;
  afterToken?: (user: UserDocument) => Promise<void>;
  rawRole?: string;
};

describe('Work Order assignment/lifecycle security (e2e)', () => {
  let mongod: MongoMemoryReplSet;
  let app: INestApplication<App>;
  let jwtService: JwtService;
  let connection: Connection;
  let users: Model<UserDocument>;
  let machineTypes: Model<MachineTypeDocument>;
  let machines: Model<MachineDocument>;
  let workOrders: Model<WorkOrderDocument>;
  let reports: Model<InterventionReportDocument>;
  let machineType: MachineTypeDocument;
  let machine: MachineDocument;
  let validTechnician: UserDocument;
  let validOperator: UserDocument;
  let validAdmin: UserDocument;

  beforeAll(async () => {
    mongod = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
    });
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongod.getUri('gmao_lifecycle_security_e2e');
    process.env.JWT_SECRET = 'e2e-test-jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'e2e-test-refresh-secret';
    process.env.EMAIL_VERIFICATION_SECRET = 'e2e-test-email-secret';
    process.env.FILE_STORAGE_DRIVER = 'local';
    process.env.AUTOMATION_SCHEDULER_ENABLED = 'false';

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
    workOrders = app.get(getModelToken(WorkOrder.name));
    reports = app.get(getModelToken(InterventionReport.name));
  }, 120_000);

  afterAll(async () => {
    await connection?.dropDatabase();
    await app?.close();
    await mongod?.stop();
  });

  beforeEach(async () => {
    await seedBaseData();
  });

  const accountStateCases: AccountStateCase[] = [
    {
      name: 'rejected account',
      expectedStatus: 403,
      expectedCode: 'ACCOUNT_REJECTED',
      userPatch: { approval_status: ApprovalStatus.REJECTED },
    },
    {
      name: 'unverified email',
      expectedStatus: 403,
      expectedCode: 'EMAIL_NOT_VERIFIED',
      userPatch: { is_verified: false },
    },
    {
      name: 'pending approval',
      expectedStatus: 403,
      expectedCode: 'ACCOUNT_PENDING_APPROVAL',
      userPatch: { approval_status: ApprovalStatus.PENDING },
    },
    {
      name: 'inactive account',
      expectedStatus: 403,
      expectedCode: 'ACCOUNT_INACTIVE',
      userPatch: { is_active: false },
    },
    {
      name: 'incomplete profile',
      expectedStatus: 403,
      expectedCode: 'PROFILE_COMPLETION_REQUIRED',
      userPatch: { profile_completed: false },
    },
    {
      name: 'forced password reset',
      expectedStatus: 403,
      expectedCode: 'PASSWORD_RESET_REQUIRED',
      userPatch: { must_reset_password: true },
    },
    {
      name: 'revoked session',
      expectedStatus: 401,
      expectedCode: 'SESSION_REVOKED',
      userPatch: {
        credentials_invalidated_at: new Date(Date.now() + 60_000),
      },
    },
    {
      name: 'deleted account',
      expectedStatus: 401,
      expectedCode: 'AUTHENTICATED_USER_NOT_FOUND',
      afterToken: async (user) => {
        await users.deleteOne({ _id: user._id }).exec();
      },
    },
    {
      name: 'unsupported role',
      expectedStatus: 403,
      expectedCode: 'ACCOUNT_ROLE_NOT_ALLOWED',
      rawRole: 'auditor',
    },
  ];

  for (const kind of [
    'technician_claim',
    'technician_waiting_parts',
    'operator_start',
    'admin_validation',
  ] as MutationKind[]) {
    describe(`${kind} account-state denial`, () => {
      for (const stateCase of accountStateCases) {
        it(`denies ${stateCase.name} without mutating Work Order state`, async () => {
          const target = await createMutationTarget(kind);
          const actor = await createActorForTarget(kind, stateCase);
          const token = tokenFor(actor);
          await stateCase.afterToken?.(actor);

          const beforeNotifications = await countNotifications();
          const response = await invokeMutation(
            kind,
            target.workOrderId,
            token,
          );

          expect(response.status).toBe(stateCase.expectedStatus);
          expect(response.body.code).toBe(stateCase.expectedCode);
          await expectWorkOrderUnchanged(target.workOrderId, target.before);
          await expectReportUnchanged(target.reportId, target.reportBefore);
          expect(await countNotifications()).toBe(beforeNotifications);
        });
      }
    });
  }

  it('rejects forged server-controlled fields on the admin validation DTO', async () => {
    const performer = validTechnician._id;
    const workOrder = await createWorkOrder({
      technician_id: performer,
      status: 'waiting_validation',
    });
    const report = await createReport(workOrder._id, performer);

    const response = await request(app.getHttpServer())
      .post(`/work-orders/${workOrder._id.toString()}/validation`)
      .set('Authorization', `Bearer ${tokenFor(validAdmin)}`)
      .send({
        action: 'approve',
        status: 'validated',
        technician_id: validAdmin._id.toString(),
        validated_by: validAdmin._id.toString(),
        lifecycle_history: [{ to_status: 'validated' }],
      });

    expect(response.status).toBe(400);
    await expectWorkOrderUnchanged(
      workOrder._id.toString(),
      snapshot(workOrder),
    );
    await expectReportUnchanged(report._id.toString(), snapshot(report));
  });

  for (const forgedField of [
    'status',
    'technician_id',
    'validated_by',
    'date_end',
    'lifecycle_history',
    'role',
    'is_active',
  ]) {
    it(`rejects single forged validation field: ${forgedField}`, async () => {
      const performer = validTechnician._id;
      const workOrder = await createWorkOrder({
        technician_id: performer,
        status: 'waiting_validation',
      });
      const report = await createReport(workOrder._id, performer);

      const response = await request(app.getHttpServer())
        .post(`/work-orders/${workOrder._id.toString()}/validation`)
        .set('Authorization', `Bearer ${tokenFor(validAdmin)}`)
        .send({
          action: 'approve',
          [forgedField]:
            forgedField === 'lifecycle_history'
              ? [{ to_status: 'validated' }]
              : validAdmin._id.toString(),
        });

      expect(response.status).toBe(400);
      await expectWorkOrderUnchanged(
        workOrder._id.toString(),
        snapshot(workOrder),
      );
      await expectReportUnchanged(report._id.toString(), snapshot(report));
    });
  }

  it('rejects nested, prototype-like, and array-shaped validation forgeries', async () => {
    const performer = validTechnician._id;
    const workOrder = await createWorkOrder({
      technician_id: performer,
      status: 'waiting_validation',
    });
    const report = await createReport(workOrder._id, performer);

    const response = await request(app.getHttpServer())
      .post(`/work-orders/${workOrder._id.toString()}/validation`)
      .set('Authorization', `Bearer ${tokenFor(validAdmin)}`)
      .send(
        JSON.parse(`{
          "action": ["approve"],
          "__proto__": { "status": "validated" },
          "constructor": { "prototype": { "validated_by": "${validAdmin._id.toString()}" } },
          "actor": { "user_id": "${validAdmin._id.toString()}", "role": "admin" }
        }`),
      );

    expect(response.status).toBe(400);
    await expectWorkOrderUnchanged(
      workOrder._id.toString(),
      snapshot(workOrder),
    );
    await expectReportUnchanged(report._id.toString(), snapshot(report));
  });

  it('rejects forged server-controlled fields on technician report updates', async () => {
    const workOrder = await createWorkOrder({
      technician_id: validTechnician._id,
      status: 'in_progress',
    });
    const report = await createReport(workOrder._id, validTechnician._id);

    const response = await request(app.getHttpServer())
      .patch(`/technician/work-orders/${workOrder._id.toString()}/report`)
      .set('Authorization', `Bearer ${tokenFor(validTechnician)}`)
      .send({
        description_action: 'Legitimate update',
        technician_id: validAdmin._id.toString(),
        validation_responsable: 'validated',
        validated_by: validAdmin._id.toString(),
        date_fin: new Date().toISOString(),
      });

    expect(response.status).toBe(400);
    await expectWorkOrderUnchanged(
      workOrder._id.toString(),
      snapshot(workOrder),
    );
    await expectReportUnchanged(report._id.toString(), snapshot(report));
  });

  it('rejects forged server-controlled fields on operator corrective reports', async () => {
    const beforeWorkOrders = await workOrders.countDocuments().exec();
    const beforeReports = await reports.countDocuments().exec();

    const response = await request(app.getHttpServer())
      .post('/operator/report-problem')
      .set('Authorization', `Bearer ${tokenFor(validOperator)}`)
      .send({
        machine_id: machine._id.toString(),
        code_panne: 'E-401',
        fault_description: 'Unexpected vibration',
        actions: ['Stopped machine'],
        technician_id: validAdmin._id.toString(),
        status: 'validated',
        date_start: '2026-08-02T10:00:00.000Z',
      });

    expect(response.status).toBe(400);
    expect(await workOrders.countDocuments().exec()).toBe(beforeWorkOrders);
    expect(await reports.countDocuments().exec()).toBe(beforeReports);
  });

  it('rejects valid-looking but unauthorized machine ids on operator corrective reports', async () => {
    const inaccessibleMachine = await machines.create({
      machine_id: 'SEC-E2E-INACCESSIBLE',
      type_id: machineType._id,
      serial_no: 'SEC-E2E-INACCESSIBLE-SERIAL',
      status: 'active',
      lifecycle_history: [],
    });
    const beforeWorkOrders = await workOrders.countDocuments().exec();
    const beforeReports = await reports.countDocuments().exec();

    const response = await request(app.getHttpServer())
      .post('/operator/report-problem')
      .set('Authorization', `Bearer ${tokenFor(validOperator)}`)
      .send({
        machine_id: inaccessibleMachine._id.toString(),
        code_panne: 'E-403',
        fault_description: 'Should not be accepted',
        actions: ['Attempted report'],
      });

    expect(response.status).toBe(403);
    expect(await workOrders.countDocuments().exec()).toBe(beforeWorkOrders);
    expect(await reports.countDocuments().exec()).toBe(beforeReports);
  });

  it('rejects forged server-controlled fields on operator preventive submissions', async () => {
    const workOrder = await createWorkOrder({
      technician_id: validOperator._id,
      type_maintenance: 'preventive',
      status: 'scheduled',
    });

    const response = await request(app.getHttpServer())
      .post('/operator/preventive/submit')
      .set('Authorization', `Bearer ${tokenFor(validOperator)}`)
      .send({
        work_order_id: workOrder._id.toString(),
        tasks_completed: ['Inspect guards'],
        condition: 'nominal',
        comments: 'done',
        status: 'validated',
        execution_date: '2026-08-02T10:00:00.000Z',
        technician_id: validAdmin._id.toString(),
      });

    expect(response.status).toBe(400);
    await expectWorkOrderUnchanged(
      workOrder._id.toString(),
      snapshot(workOrder),
    );
    expect(await reports.countDocuments({ ot_id: workOrder._id }).exec()).toBe(
      0,
    );
  });

  it('ignores forged bodies on bodyless lifecycle endpoints and derives server fields from the authenticated actor', async () => {
    const other = new Types.ObjectId();
    const claimTarget = await createWorkOrder({ status: 'pending' });
    const startTarget = await createWorkOrder({
      technician_id: validOperator._id,
      status: 'scheduled',
    });
    const waitingTarget = await createWorkOrder({
      technician_id: validTechnician._id,
      status: 'in_progress',
    });

    await request(app.getHttpServer())
      .patch(`/technician/work-orders/${claimTarget._id.toString()}/claim`)
      .set('Authorization', `Bearer ${tokenFor(validTechnician)}`)
      .send({ technician_id: other.toHexString(), status: 'validated' })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/operator/calendar/events/${startTarget._id.toString()}/start`)
      .set('Authorization', `Bearer ${tokenFor(validOperator)}`)
      .send({ status: 'completed', date_end: '2026-08-02T10:00:00.000Z' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(
        `/technician/work-orders/${waitingTarget._id.toString()}/waiting-parts`,
      )
      .set('Authorization', `Bearer ${tokenFor(validTechnician)}`)
      .send({ status: 'completed', validated_by: other.toHexString() })
      .expect(200);

    const claimed = await workOrders.findById(claimTarget._id).lean().exec();
    const started = await workOrders.findById(startTarget._id).lean().exec();
    const waiting = await workOrders.findById(waitingTarget._id).lean().exec();

    expect(claimed?.technician_id?.toString()).toBe(
      validTechnician._id.toString(),
    );
    expect(claimed?.status).toBe('assigned');
    expect(claimed?.validated_by).toBeUndefined();
    expect(started?.status).toBe('in_progress');
    expect(started?.date_end).toBeUndefined();
    expect(waiting?.status).toBe('waiting_parts');
    expect(waiting?.validated_by).toBeUndefined();
  });

  async function seedBaseData() {
    await connection.dropDatabase();
    machineType = await machineTypes.create({
      type_id: 901,
      name: 'Security E2E Machine Type',
    });
    machine = await machines.create({
      machine_id: 'SEC-E2E-MACHINE',
      type_id: machineType._id,
      serial_no: 'SEC-E2E-SERIAL',
      status: 'active',
      lifecycle_history: [],
    });
    validTechnician = await createUser({
      user_id: 'SEC-E2E-TECH',
      email: 'security-tech@example.test',
      role: Role.TECHNICIAN,
      assigned_machine_ids: [machine._id],
    });
    validOperator = await createUser({
      user_id: 'SEC-E2E-OP',
      email: 'security-operator@example.test',
      role: Role.OPERATOR,
      assigned_machine_ids: [machine._id],
    });
    validAdmin = await createUser({
      user_id: 'SEC-E2E-ADMIN',
      email: 'security-admin@example.test',
      role: Role.ADMIN,
    });
  }

  async function createActorForTarget(
    kind: MutationKind,
    stateCase: AccountStateCase,
  ): Promise<UserDocument> {
    const role =
      kind === 'admin_validation'
        ? Role.ADMIN
        : kind === 'operator_start'
          ? Role.OPERATOR
          : Role.TECHNICIAN;
    const user = await createUser({
      user_id: `SEC-${kind}-${new Types.ObjectId().toHexString()}`,
      email: `${kind}-${new Types.ObjectId().toHexString()}@example.test`,
      role,
      assigned_machine_ids: role === Role.ADMIN ? undefined : [machine._id],
      ...stateCase.userPatch,
    });
    if (stateCase.rawRole) {
      await users.collection.updateOne(
        { _id: user._id },
        { $set: { role: stateCase.rawRole } },
      );
      return (await users.findById(user._id).exec())!;
    }
    return user;
  }

  async function createUser(input: Partial<User>): Promise<UserDocument> {
    return users.create({
      nom_complet: 'Security E2E User',
      password: 'x',
      is_active: true,
      is_verified: true,
      approval_status: ApprovalStatus.APPROVED,
      profile_completed: true,
      must_reset_password: false,
      ...input,
    });
  }

  async function createMutationTarget(kind: MutationKind): Promise<{
    workOrderId: string;
    reportId?: string;
    before: Record<string, unknown>;
    reportBefore?: Record<string, unknown>;
  }> {
    if (kind === 'technician_claim') {
      const workOrder = await createWorkOrder({ status: 'pending' });
      return {
        workOrderId: workOrder._id.toString(),
        before: snapshot(workOrder),
      };
    }
    if (kind === 'technician_waiting_parts') {
      const actorId = new Types.ObjectId();
      const workOrder = await createWorkOrder({
        technician_id: actorId,
        status: 'in_progress',
      });
      const report = await createReport(workOrder._id, actorId);
      return {
        workOrderId: workOrder._id.toString(),
        reportId: report._id.toString(),
        before: snapshot(workOrder),
        reportBefore: snapshot(report),
      };
    }
    if (kind === 'operator_start') {
      const actorId = new Types.ObjectId();
      const workOrder = await createWorkOrder({
        technician_id: actorId,
        status: 'scheduled',
      });
      return {
        workOrderId: workOrder._id.toString(),
        before: snapshot(workOrder),
      };
    }

    const performerId = validTechnician._id;
    const workOrder = await createWorkOrder({
      technician_id: performerId,
      status: 'waiting_validation',
    });
    const report = await createReport(workOrder._id, performerId);
    return {
      workOrderId: workOrder._id.toString(),
      reportId: report._id.toString(),
      before: snapshot(workOrder),
      reportBefore: snapshot(report),
    };
  }

  async function invokeMutation(
    kind: MutationKind,
    workOrderId: string,
    token: string,
  ) {
    const server = app.getHttpServer();
    if (kind === 'technician_claim') {
      return request(server)
        .patch(`/technician/work-orders/${workOrderId}/claim`)
        .set('Authorization', `Bearer ${token}`)
        .send();
    }
    if (kind === 'technician_waiting_parts') {
      return request(server)
        .patch(`/technician/work-orders/${workOrderId}/waiting-parts`)
        .set('Authorization', `Bearer ${token}`)
        .send();
    }
    if (kind === 'operator_start') {
      return request(server)
        .post(`/operator/calendar/events/${workOrderId}/start`)
        .set('Authorization', `Bearer ${token}`)
        .send();
    }
    return request(server)
      .post(`/work-orders/${workOrderId}/validation`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'approve' });
  }

  async function createWorkOrder(
    overrides: Partial<WorkOrder> = {},
  ): Promise<WorkOrderDocument> {
    return workOrders.create({
      ot_id: `SEC-WO-${new Types.ObjectId().toHexString()}`,
      machine_id: machine._id,
      type_maintenance: 'corrective',
      status: 'pending',
      date_created: new Date('2026-08-02T08:00:00.000Z'),
      lifecycle_history: [],
      ...overrides,
    });
  }

  async function createReport(
    workOrderId: Types.ObjectId,
    technicianId: Types.ObjectId,
  ): Promise<InterventionReportDocument> {
    return reports.create({
      report_id: `SEC-REP-${new Types.ObjectId().toHexString()}`,
      ot_id: workOrderId,
      technician_id: technicianId,
      date_debut: new Date('2026-08-02T08:00:00.000Z'),
      date_fin: new Date('2026-08-02T09:00:00.000Z'),
      description_action: 'Baseline repair',
      etat_final: 'Baseline state',
      validation_responsable: 'waiting_validation',
    });
  }

  function tokenFor(user: UserDocument): string {
    return jwtService.sign({
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
      user_id: user.user_id,
    });
  }

  function snapshot(document: {
    status?: unknown;
    technician_id?: unknown;
    date_start?: unknown;
    date_end?: unknown;
    date_closed?: unknown;
    execution_date?: unknown;
    validated_by?: unknown;
    validated_at?: unknown;
    validation_responsable?: unknown;
    lifecycle_history?: unknown[];
    description_action?: unknown;
    etat_final?: unknown;
    cause_racine?: unknown;
  }): Record<string, unknown> {
    return {
      status: document.status,
      technician_id: valueToString(document.technician_id),
      date_start: valueToString(document.date_start),
      date_end: valueToString(document.date_end),
      date_closed: valueToString(document.date_closed),
      execution_date: valueToString(document.execution_date),
      validated_by: valueToString(document.validated_by),
      validated_at: valueToString(document.validated_at),
      validation_responsable: document.validation_responsable,
      lifecycle_history_length: document.lifecycle_history?.length ?? 0,
      description_action: document.description_action,
      etat_final: document.etat_final,
      cause_racine: document.cause_racine,
    };
  }

  async function expectWorkOrderUnchanged(
    id: string,
    before: Record<string, unknown>,
  ) {
    const current = await workOrders.findById(id).lean().exec();
    expect(snapshot(current ?? {})).toEqual(before);
  }

  async function expectReportUnchanged(
    id: string | undefined,
    before: Record<string, unknown> | undefined,
  ) {
    if (!id || !before) return;
    const current = await reports.findById(id).lean().exec();
    expect(snapshot(current ?? {})).toEqual(before);
  }

  async function countNotifications(): Promise<number> {
    return connection.collection('notifications').countDocuments();
  }

  function valueToString(value: unknown): string | undefined {
    if (!value) return undefined;
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Types.ObjectId) return value.toHexString();
    if (typeof value === 'object' && value !== null && 'toString' in value) {
      return String(value);
    }
    return String(value);
  }
});
