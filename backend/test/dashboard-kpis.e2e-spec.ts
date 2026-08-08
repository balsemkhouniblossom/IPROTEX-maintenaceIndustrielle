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
import { WorkOrder, WorkOrderDocument } from '../src/schemas/work-order.schema';
import { Stock, StockDocument } from '../src/schemas/stock.schema';
import { Catalogue, CatalogueDocument } from '../src/schemas/catalogue.schema';
import * as businessTime from '../src/common/business-time';

describe('Dashboard KPIs — role-scoped, computed from seeded database state (e2e)', () => {
  // A replica set is required by convention for this app's transactional
  // write paths; the dashboard endpoints themselves are read-only, but
  // this suite still runs against a replica set to match how the rest of
  // the app's e2e tests exercise the same Mongo topology production uses.
  //
  // BUSINESS_TIMEZONE is pinned to UTC for this suite so every "today"
  // boundary in the assertions below can be computed with plain UTC
  // arithmetic instead of reasoning about Africa/Tunis offsets — the
  // business-timezone *mechanism* itself (not the specific zone) is what's
  // under test elsewhere (`business-time.spec.ts`).
  let mongo: MongoMemoryReplSet;
  let app: INestApplication<App>;
  let jwtService: JwtService;
  let connection: Connection;
  let users: Model<UserDocument>;
  let machineTypes: Model<MachineTypeDocument>;
  let machines: Model<MachineDocument>;
  let workOrders: Model<WorkOrderDocument>;
  let stocks: Model<StockDocument>;
  let catalogues: Model<CatalogueDocument>;

  let adminToken: string;
  let technicianToken: string;
  let operatorToken: string;
  let admin: UserDocument;
  let technician: UserDocument;
  let operator: UserDocument;
  let machine: MachineDocument;

  const todayStart = new Date();

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongo.getUri('gmao_dashboard_kpis_e2e');
    process.env.JWT_SECRET = 'e2e-test-jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'e2e-test-refresh-secret';
    process.env.EMAIL_VERIFICATION_SECRET = 'e2e-test-email-secret';
    process.env.BUSINESS_TIMEZONE = 'UTC';

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
    stocks = app.get(getModelToken(Stock.name));
    catalogues = app.get(getModelToken(Catalogue.name));

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

  function hoursFromTodayStart(hours: number): Date {
    return new Date(todayStart.getTime() + hours * 3_600_000);
  }

  function daysFromTodayStart(days: number): Date {
    return hoursFromTodayStart(days * 24);
  }

  async function seedBaseData() {
    await connection.dropDatabase();

    const machineType = await machineTypes.create({
      type_id: 1,
      name: 'Dashboard KPI E2E machine type',
    });
    machine = await machines.create({
      machine_id: 'MACHINE-KPI',
      type_id: machineType._id,
      serial_no: 'KPI-001',
      status: 'active',
    });

    admin = await users.create({
      user_id: 'ADMIN-KPI-E2E',
      nom_complet: 'KPI Admin',
      email: 'kpi-admin-e2e@example.test',
      password: 'x',
      role: 'admin',
      is_active: true,
      is_verified: true,
    });
    technician = await users.create({
      user_id: 'TECH-KPI-E2E',
      nom_complet: 'KPI Technician',
      email: 'kpi-technician-e2e@example.test',
      password: 'x',
      role: 'technician',
      is_active: true,
      is_verified: true,
    });
    operator = await users.create({
      user_id: 'OP-KPI-E2E',
      nom_complet: 'KPI Operator',
      email: 'kpi-operator-e2e@example.test',
      password: 'x',
      role: 'operator',
      is_active: true,
      is_verified: true,
      assigned_machine_ids: [machine._id],
    });

    adminToken = tokenFor(admin);
    technicianToken = tokenFor(technician);
    operatorToken = tokenFor(operator);

    todayStart.setTime(
      businessTime.startOfBusinessDay(new Date(), 'UTC').getTime(),
    );

    // A: overdue, assigned to the Technician.
    await workOrders.create({
      ot_id: 'WO-KPI-A-OVERDUE',
      machine_id: machine._id,
      technician_id: technician._id,
      description: 'Overdue corrective task',
      type_maintenance: 'corrective',
      status: 'pending',
      priorite: 'high',
      code_panne: 'FAULT-A',
      date_created: daysFromTodayStart(-10),
      due_date: daysFromTodayStart(-3),
    });

    // B: due today, assigned to the Technician.
    await workOrders.create({
      ot_id: 'WO-KPI-B-DUE-TODAY',
      machine_id: machine._id,
      technician_id: technician._id,
      description: 'Preventive task due today',
      type_maintenance: 'preventive',
      status: 'in_progress',
      priorite: 'medium',
      code_panne: 'FAULT-B',
      date_created: daysFromTodayStart(-10),
      due_date: hoursFromTodayStart(5),
    });

    // C: waiting validation, assigned to the Operator — also proves a
    // waiting_validation order is never double-counted as overdue even
    // though its (past) due date would otherwise qualify.
    await workOrders.create({
      ot_id: 'WO-KPI-C-WAITING-VALIDATION',
      machine_id: machine._id,
      technician_id: operator._id,
      description: 'Awaiting validation',
      type_maintenance: 'corrective',
      status: 'waiting_validation',
      priorite: 'medium',
      code_panne: 'FAULT-C',
      date_created: daysFromTodayStart(-5),
      due_date: daysFromTodayStart(-1),
    });

    // D: completed today, assigned to the Technician — also the first of
    // two corrective closures feeding MTTR/MTBF/response-time.
    await workOrders.create({
      ot_id: 'WO-KPI-D-COMPLETED-TODAY',
      machine_id: machine._id,
      technician_id: technician._id,
      description: 'Completed earlier today',
      type_maintenance: 'corrective',
      status: 'completed',
      priorite: 'high',
      code_panne: 'FAULT-D',
      date_created: hoursFromTodayStart(-2),
      date_start: hoursFromTodayStart(-1),
      date_end: hoursFromTodayStart(1),
    });

    // E: an older corrective closure (10 days ago) — the second MTBF data
    // point, exactly 241 hours before D's closure.
    await workOrders.create({
      ot_id: 'WO-KPI-E-OLD-CORRECTIVE',
      machine_id: machine._id,
      technician_id: technician._id,
      description: 'Closed 10 days ago',
      type_maintenance: 'corrective',
      status: 'validated',
      priorite: 'medium',
      code_panne: 'FAULT-E',
      date_created: hoursFromTodayStart(-10 * 24 - 3),
      date_start: hoursFromTodayStart(-10 * 24 - 2),
      date_end: hoursFromTodayStart(-10 * 24),
    });

    // F: preventive, completed on time.
    await workOrders.create({
      ot_id: 'WO-KPI-F-PREVENTIVE-ON-TIME',
      machine_id: machine._id,
      technician_id: technician._id,
      description: 'Preventive completed on schedule',
      type_maintenance: 'preventive',
      status: 'completed',
      priorite: 'low',
      code_panne: 'FAULT-F',
      date_created: daysFromTodayStart(-4),
      due_date: daysFromTodayStart(-2),
      date_start: daysFromTodayStart(-3),
      date_end: hoursFromTodayStart(-2 * 24 - 2), // 2h before its due date
    });

    // G: preventive, completed late.
    await workOrders.create({
      ot_id: 'WO-KPI-G-PREVENTIVE-LATE',
      machine_id: machine._id,
      technician_id: technician._id,
      description: 'Preventive completed late',
      type_maintenance: 'preventive',
      status: 'validated',
      priorite: 'low',
      code_panne: 'FAULT-G',
      date_created: daysFromTodayStart(-8),
      due_date: daysFromTodayStart(-6),
      date_start: daysFromTodayStart(-7),
      date_end: hoursFromTodayStart(-5 * 24 - 12), // after its due date
    });

    // H: scheduled far in the future — never touches any of the four
    // status counters, but still contributes to totalCount/workload.
    await workOrders.create({
      ot_id: 'WO-KPI-H-NOT-DUE-YET',
      machine_id: machine._id,
      technician_id: technician._id,
      description: 'Scheduled well in the future',
      type_maintenance: 'preventive',
      status: 'scheduled',
      priorite: 'low',
      code_panne: 'FAULT-H',
      date_created: daysFromTodayStart(-1),
      due_date: daysFromTodayStart(10),
    });

    // I: in progress, assigned to the Operator.
    await workOrders.create({
      ot_id: 'WO-KPI-I-OPERATOR-IN-PROGRESS',
      machine_id: machine._id,
      technician_id: operator._id,
      description: 'Operator currently working this',
      type_maintenance: 'preventive',
      status: 'in_progress',
      priorite: 'medium',
      code_panne: 'FAULT-I',
      date_created: daysFromTodayStart(-2),
      due_date: daysFromTodayStart(2),
    });

    // J: completed, assigned to the Operator — also a third (on-time)
    // preventive-compliance data point.
    await workOrders.create({
      ot_id: 'WO-KPI-J-OPERATOR-COMPLETED',
      machine_id: machine._id,
      technician_id: operator._id,
      description: 'Operator finished this already',
      type_maintenance: 'preventive',
      status: 'completed',
      priorite: 'medium',
      code_panne: 'FAULT-J',
      date_created: daysFromTodayStart(-3),
      due_date: daysFromTodayStart(1),
      date_start: hoursFromTodayStart(-3 * 24 + 1),
      date_end: hoursFromTodayStart(-3 * 24 + 5),
    });

    const part = await catalogues.create({
      part_id: 'PART-KPI',
      nom_piece: 'Drive belt',
      ref_constructeur: 'DB-100',
    });
    await stocks.create({
      stock_id: 'STOCK-KPI-ALERTING',
      part_id: part._id,
      quantite_en_stock: 3,
      quantite_reservee: 1,
      seuil_alerte_stock: 5, // available = 2 <= 5 -> alerts
      version: 1,
    });
    await stocks.create({
      stock_id: 'STOCK-KPI-HEALTHY',
      part_id: part._id,
      quantite_en_stock: 50,
      quantite_reservee: 0,
      seuil_alerte_stock: 5, // available = 50 > 5 -> no alert
      version: 1,
    });
  }

  describe('role permissions', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/dashboard/admin').expect(401);
    });

    it('rejects Technician and Operator roles from the Admin dashboard', async () => {
      await request(app.getHttpServer())
        .get('/dashboard/admin')
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .get('/dashboard/admin')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(403);
    });

    it('rejects an Operator from the Technician dashboard, and vice versa', async () => {
      await request(app.getHttpServer())
        .get('/technician/dashboard')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .get('/operator/dashboard')
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(403);
    });
  });

  describe('GET /dashboard/admin', () => {
    it('computes fleet-wide status counts, stock alerts, compliance, response time, MTTR/MTBF, and workload from the seeded state', async () => {
      const response = await request(app.getHttpServer())
        .get('/dashboard/admin')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const body = response.body;

      // The four canonical status counters, fleet-wide.
      expect(body.workOrders.overdueCount).toBe(1); // A only
      expect(body.workOrders.dueTodayCount).toBe(1); // B only
      expect(body.workOrders.waitingValidationCount).toBe(1); // C only
      expect(body.workOrders.completedTodayCount).toBe(1); // D only
      expect(body.workOrders.totalCount).toBe(10);
      expect(typeof body.workOrders.percentageChange).toBe('number');

      // Stock alerts: exactly the one below its reservation-aware threshold.
      expect(body.stockAlerts.count).toBe(1);
      expect(body.stockAlerts.items[0]).toMatchObject({
        stockCode: 'STOCK-KPI-ALERTING',
        available: 2,
        threshold: 5,
      });

      // Preventive compliance: F and J on time, G late -> 2/3.
      expect(body.preventiveCompliance.evaluableCount).toBe(3);
      expect(body.preventiveCompliance.onTimeCount).toBe(2);
      expect(body.preventiveCompliance.ratePercent).toBeCloseTo(66.67, 1);

      // Corrective response time: D (1h) and E (1h) -> mean 1h.
      expect(body.correctiveResponseTime.sampleSize).toBe(2);
      expect(body.correctiveResponseTime.averageResponseHours).toBe(1);

      // MTTR: D(2h) + E(2h) + F(22h) + G(36h) + J(4h) over 5 samples = 13.2h.
      expect(body.mttrMtbf.sampleSize).toBe(5);
      expect(body.mttrMtbf.mttrHours).toBeCloseTo(13.2, 1);
      // MTBF: only D and E are corrective closures, 241h apart.
      expect(body.mttrMtbf.mtbfHours).toBe(241);

      // Workload: Technician has 3 open orders (A, B, H); Operator has 2 (C, I).
      expect(body.workload).toEqual([
        expect.objectContaining({
          technicianId: technician._id.toString(),
          openCount: 3,
        }),
        expect.objectContaining({
          technicianId: operator._id.toString(),
          openCount: 2,
        }),
      ]);

      expect(body.totals).toEqual({ machines: 1, users: 3 });
      expect(body.businessTimezone).toBe('UTC');
    });
  });

  describe('GET /technician/dashboard', () => {
    it('scopes the four status counters to only the Technician’s own work orders', async () => {
      const response = await request(app.getHttpServer())
        .get('/technician/dashboard')
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(200);

      expect(response.body.counters.overdue).toBe(1); // A
      expect(response.body.counters.dueToday).toBe(1); // B
      expect(response.body.counters.waitingValidation).toBe(0); // C belongs to the Operator
      expect(response.body.counters.completedToday).toBe(1); // D
    });
  });

  describe('GET /operator/dashboard', () => {
    it('scopes status counters and summary counts to only the Operator’s own work orders', async () => {
      const response = await request(app.getHttpServer())
        .get('/operator/dashboard')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      expect(response.body.overdueCount).toBe(0);
      expect(response.body.dueTodayCount).toBe(0);
      expect(response.body.waitingValidationCount).toBe(1); // C
      expect(response.body.completedTodayCount).toBe(0);
      expect(response.body.assignedCount).toBe(2); // C (waiting_validation) + I (in_progress)
      expect(response.body.inProgressCount).toBe(1); // I
      expect(response.body.completedCount).toBe(1); // J
    });
  });
});
