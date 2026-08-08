import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from '@jest/globals';
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
import { WorkOrder, WorkOrderDocument } from '../src/schemas/work-order.schema';
import {
  InterventionReport,
  InterventionReportDocument,
} from '../src/schemas/intervention-report.schema';
import { WorkOrderKpiService } from '../src/work-orders/services/work-order-kpi.service';

/**
 * `WorkOrderCommandService.create`/`update` wrap the work-order write
 * together with its completion side effects (auto report, next preventive
 * occurrence, KPI recompute) in a single Mongo transaction (see
 * `work-order-command.service.ts`). Before this, a failure in any one of
 * the three follow-on writes left a persisted "completed" work order with
 * no matching report/schedule/KPI. This spec proves the transaction is
 * real: it injects a failure into the *last* follow-on write (KPI) via a
 * spy, so the two writes that already succeeded in-transaction (the work
 * order itself and the auto-generated report) must be rolled back too, not
 * just the KPI write that actually threw.
 */
describe('WorkOrderCommandService — transactional completion rollback (e2e)', () => {
  let mongo: MongoMemoryReplSet;
  let app: INestApplication<App>;
  let jwtService: JwtService;
  let connection: Connection;
  let users: Model<UserDocument>;
  let machineTypes: Model<MachineTypeDocument>;
  let machines: Model<MachineDocument>;
  let workOrders: Model<WorkOrderDocument>;
  let interventionReports: Model<InterventionReportDocument>;
  let kpiService: WorkOrderKpiService;

  let adminToken: string;
  let admin: UserDocument;
  let technician: UserDocument;
  let machine: MachineDocument;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongo.getUri('gmao_wo_command_txn_e2e');
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
    workOrders = app.get(getModelToken(WorkOrder.name));
    interventionReports = app.get(getModelToken(InterventionReport.name));
    kpiService = app.get(WorkOrderKpiService);

    await seedBaseData();
  }, 120_000);

  afterAll(async () => {
    await connection?.dropDatabase();
    await app?.close();
    await mongo?.stop();
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
      name: 'WO Command Txn E2E machine type',
    });
    machine = await machines.create({
      machine_id: 'MACHINE-WOCT',
      type_id: machineType._id,
      serial_no: 'WOCT-001',
      status: 'active',
    });

    admin = await users.create({
      user_id: 'ADMIN-WOCT-E2E',
      nom_complet: 'WO Command Txn Admin',
      email: 'wo-command-txn-admin-e2e@example.test',
      password: 'x',
      role: 'admin',
      is_active: true,
      is_verified: true,
    });
    technician = await users.create({
      user_id: 'TECH-WOCT-E2E',
      nom_complet: 'WO Command Txn Technician',
      email: 'wo-command-txn-tech-e2e@example.test',
      password: 'x',
      role: 'technician',
      is_active: true,
      is_verified: true,
    });

    adminToken = tokenFor(admin);
  }

  describe('create', () => {
    it('rolls back the work order and its auto-generated report when KPI recompute fails mid-transaction', async () => {
      const otId = `WO-COR-TXN-${Date.now()}`;
      jest
        .spyOn(kpiService, 'updateKpiForMachine')
        .mockRejectedValueOnce(new Error('simulated KPI failure'));

      await request(app.getHttpServer())
        .post('/work-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ot_id: otId,
          machine_id: machine._id.toString(),
          technician_id: technician._id.toString(),
          description: 'Transactional rollback probe',
          type_maintenance: 'corrective',
          status: 'completed',
          date_created: '2026-07-14T08:00:00.000Z',
          date_start: '2026-07-14T08:00:00.000Z',
          date_end: '2026-07-14T09:00:00.000Z',
        })
        .expect(500);

      const persistedWorkOrder = await workOrders
        .findOne({ ot_id: otId })
        .lean();
      expect(persistedWorkOrder).toBeNull();

      // The intervention report's `ot_id` field stores the work order's
      // Mongo `_id` (not its business `ot_id` code), and creation failed
      // before a work order document ever existed to reference — so
      // instead match on the description text this report would have
      // carried, which is unique to this test.
      const persistedReport = await interventionReports
        .findOne({ description_action: 'Transactional rollback probe' })
        .lean();
      expect(persistedReport).toBeNull();
    });

    it('persists the work order and its auto-generated report when nothing fails (control case)', async () => {
      const otId = `WO-COR-TXN-OK-${Date.now()}`;

      await request(app.getHttpServer())
        .post('/work-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ot_id: otId,
          machine_id: machine._id.toString(),
          technician_id: technician._id.toString(),
          description: 'Transactional control probe',
          type_maintenance: 'corrective',
          status: 'completed',
          date_created: '2026-07-14T08:00:00.000Z',
          date_start: '2026-07-14T08:00:00.000Z',
          date_end: '2026-07-14T09:00:00.000Z',
        })
        .expect(201);

      const persistedWorkOrder = await workOrders
        .findOne({ ot_id: otId })
        .lean();
      expect(persistedWorkOrder).not.toBeNull();

      const persistedReport = await interventionReports
        .findOne({ description_action: 'Transactional control probe' })
        .lean();
      expect(persistedReport).not.toBeNull();
    });
  });

  describe('update', () => {
    it('leaves the work order in its prior status when KPI recompute fails while transitioning to completed', async () => {
      const otId = `WO-COR-TXN-UPD-${Date.now()}`;
      const created = await request(app.getHttpServer())
        .post('/work-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ot_id: otId,
          machine_id: machine._id.toString(),
          technician_id: technician._id.toString(),
          description: 'Transactional update rollback probe',
          type_maintenance: 'corrective',
          status: 'in_progress',
          date_created: '2026-07-14T08:00:00.000Z',
          date_start: '2026-07-14T08:00:00.000Z',
        })
        .expect(201);

      jest
        .spyOn(kpiService, 'updateKpiForMachine')
        .mockRejectedValueOnce(new Error('simulated KPI failure'));

      await request(app.getHttpServer())
        .patch(`/work-orders/${created.body._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'completed',
          date_end: '2026-07-14T09:00:00.000Z',
        })
        .expect(500);

      const unchanged = await workOrders.findById(created.body._id).lean();
      expect(unchanged?.status).toBe('in_progress');

      const persistedReport = await interventionReports
        .findOne({
          description_action: 'Transactional update rollback probe',
        })
        .lean();
      expect(persistedReport).toBeNull();
    });
  });
});
