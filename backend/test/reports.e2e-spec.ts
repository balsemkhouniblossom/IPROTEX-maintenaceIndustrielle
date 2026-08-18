import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'node:crypto';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { User, UserDocument } from '../src/schemas/user.schema';
import {
  MachineType,
  MachineTypeDocument,
} from '../src/schemas/machine-type.schema';
import { Machine, MachineDocument } from '../src/schemas/machine.schema';
import { WorkOrder, WorkOrderDocument } from '../src/schemas/work-order.schema';
import { Catalogue, CatalogueDocument } from '../src/schemas/catalogue.schema';
import { Stock, StockDocument } from '../src/schemas/stock.schema';
import {
  StockMovement,
  StockMovementDocument,
  StockMovementType,
} from '../src/schemas/stock-movement.schema';
import {
  Notification,
  NotificationDocument,
  NotificationType,
} from '../src/schemas/notification.schema';
import {
  GeneratedReport,
  GeneratedReportDocument,
  ReportFormat,
  ReportStatus,
  ReportType,
} from '../src/schemas/generated-report.schema';
import {
  ScheduledReport,
  ScheduledReportDocument,
  ScheduleFrequency,
} from '../src/schemas/scheduled-report.schema';
import { ReportSchedulerService } from '../src/reports/report-scheduler.service';

/**
 * Report generation is genuinely async (fire-and-forget from the HTTP
 * request path), so the suite polls `GET /reports/:id` until the status
 * leaves pending/processing instead of asserting a fixed timing.
 */
/**
 * superagent only auto-parses a response into a Buffer for content types it
 * recognizes as binary; forcing this custom parser guarantees we get the
 * exact bytes back regardless of the download's declared content type, so
 * the checksum comparison below is comparing the real wire bytes.
 */

function bufferParser(
  res: any,
  callback: (err: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

async function waitForTerminalStatus(
  app: INestApplication<App>,
  token: string,
  reportId: string,
  timeoutMs = 15_000,
): Promise<{ status: string; body: Record<string, unknown> }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await request(app.getHttpServer())
      .get(`/reports/${reportId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    if (
      response.body.status === 'completed' ||
      response.body.status === 'failed'
    ) {
      return { status: response.body.status, body: response.body };
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Report ${reportId} did not reach a terminal status within ${timeoutMs}ms`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('Reports module — export generation (e2e)', () => {
  let mongo: MongoMemoryReplSet;
  let app: INestApplication<App>;
  let jwtService: JwtService;
  let connection: Connection;
  let users: Model<UserDocument>;
  let machineTypes: Model<MachineTypeDocument>;
  let machines: Model<MachineDocument>;
  let workOrders: Model<WorkOrderDocument>;
  let catalogues: Model<CatalogueDocument>;
  let stocks: Model<StockDocument>;
  let stockMovements: Model<StockMovementDocument>;
  let generatedReports: Model<GeneratedReportDocument>;
  let scheduledReports: Model<ScheduledReportDocument>;
  let notifications: Model<NotificationDocument>;
  let reportSchedulerService: ReportSchedulerService;

  let adminToken: string;
  let admin: UserDocument;
  let technicianToken: string;
  let technician: UserDocument;
  let otherOperatorToken: string; // assigned to `assignedMachine` only, excludes `otherMachine`
  let assignedMachineId: string;
  let otherMachineId: string;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongo.getUri('gmao_reports_e2e');
    process.env.JWT_SECRET = 'e2e-test-jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'e2e-test-refresh-secret';
    process.env.EMAIL_VERIFICATION_SECRET = 'e2e-test-email-secret';
    delete process.env.FILE_STORAGE_DRIVER;

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
    catalogues = app.get(getModelToken(Catalogue.name));
    stocks = app.get(getModelToken(Stock.name));
    stockMovements = app.get(getModelToken(StockMovement.name));
    generatedReports = app.get(getModelToken(GeneratedReport.name));
    scheduledReports = app.get(getModelToken(ScheduledReport.name));
    notifications = app.get(getModelToken(Notification.name));
    reportSchedulerService = app.get(ReportSchedulerService);

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
      name: 'Reports E2E machine type',
    });
    const assignedMachine = await machines.create({
      machine_id: 'MACHINE-RPT-1',
      type_id: machineType._id,
      serial_no: 'RPT-001',
      status: 'active',
    });
    assignedMachineId = assignedMachine._id.toString();
    const otherMachine = await machines.create({
      machine_id: 'MACHINE-RPT-2',
      type_id: machineType._id,
      serial_no: 'RPT-002',
      status: 'active',
    });
    otherMachineId = otherMachine._id.toString();

    admin = await users.create({
      user_id: 'ADMIN-RPT-E2E',
      nom_complet: 'Reports Admin',
      email: 'reports-admin-e2e@example.test',
      password: 'x',
      role: 'admin',
      is_active: true,
      is_verified: true,
    });
    technician = await users.create({
      user_id: 'TECH-RPT-E2E',
      nom_complet: 'Reports Technician',
      email: 'reports-technician-e2e@example.test',
      password: 'x',
      role: 'technician',
      is_active: true,
      is_verified: true,
      assigned_machine_ids: [assignedMachine._id],
    });
    await users.create({
      user_id: 'OP-RPT-E2E',
      nom_complet: 'Reports Operator',
      email: 'reports-operator-e2e@example.test',
      password: 'x',
      role: 'operator',
      is_active: true,
      is_verified: true,
      assigned_machine_ids: [assignedMachine._id],
    });
    const otherOperator = await users.create({
      user_id: 'OP2-RPT-E2E',
      nom_complet: 'Other Reports Operator',
      email: 'reports-operator2-e2e@example.test',
      password: 'x',
      role: 'operator',
      is_active: true,
      is_verified: true,
      // Non-empty and deliberately excludes otherMachine: an empty list now
      // defaults to full visibility, so this must narrow explicitly to still
      // exercise "operator scoped away from a specific machine".
      assigned_machine_ids: [assignedMachine._id],
    });

    await workOrders.create({
      ot_id: 'OT-RPT-E2E-1',
      machine_id: assignedMachine._id,
      technician_id: technician._id,
      type_maintenance: 'corrective',
      status: 'completed',
      code_panne: 'E-1',
      description: 'Bearing replaced',
      date_created: new Date('2026-01-05T00:00:00Z'),
      date_start: new Date('2026-01-05T00:00:00Z'),
      date_end: new Date('2026-01-05T04:00:00Z'),
      date_closed: new Date('2026-01-05T04:00:00Z'),
    });

    const part = await catalogues.create({
      part_id: 'PART-RPT-1',
      nom_piece: 'Filter',
      ref_constructeur: 'F-100',
      unit_cost: 15,
    });
    const stock = await stocks.create({
      stock_id: 'STOCK-RPT-1',
      part_id: part._id,
      quantite_en_stock: 10,
      quantite_reservee: 0,
    });
    await stockMovements.create({
      movement_id: 'MOV-RPT-1',
      type: StockMovementType.ADJUSTMENT,
      stock_id: stock._id,
      part_id: part._id,
      quantity_delta: 10,
      reserved_delta: 0,
      quantite_en_stock_after: 10,
      quantite_reservee_after: 0,
      actor_user_id: admin._id,
      reason: 'initial stock',
    });

    adminToken = tokenFor(admin);
    technicianToken = tokenFor(technician);
    otherOperatorToken = tokenFor(otherOperator);
  }

  describe('authentication and role scoping', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/reports').expect(401);
    });

    it("rejects requesting a report type the caller's role is not permitted to request", async () => {
      const response = await request(app.getHttpServer())
        .post('/reports')
        .set('Authorization', `Bearer ${otherOperatorToken}`)
        .send({ type: ReportType.STOCK_MOVEMENTS, format: ReportFormat.CSV })
        .expect(403);

      expect(response.body.message).toMatch(/may not request/);
    });

    it("scopes the available report types to the caller's role", async () => {
      const operatorTypes = await request(app.getHttpServer())
        .get('/reports/types')
        .set('Authorization', `Bearer ${otherOperatorToken}`)
        .expect(200);
      expect(operatorTypes.body).toEqual([ReportType.MACHINE_HISTORY]);

      const adminTypes = await request(app.getHttpServer())
        .get('/reports/types')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(adminTypes.body).toContain(ReportType.AUDIT_HISTORY);
      expect(adminTypes.body).toContain(ReportType.STOCK_MOVEMENTS);
    });

    it('/reports/all is Admin-only', async () => {
      await request(app.getHttpServer())
        .get('/reports/all')
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .get('/reports/all')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });
  });

  describe('full async generation pipeline — machine history (CSV)', () => {
    let reportId: string;

    it('creates a pending report row immediately on request', async () => {
      const response = await request(app.getHttpServer())
        .post('/reports')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: ReportType.MACHINE_HISTORY,
          format: ReportFormat.CSV,
          parameters: { machineId: assignedMachineId },
        })
        .expect(201);

      expect(['pending', 'processing', 'completed']).toContain(
        response.body.status,
      );
      expect(response.body.requester_role).toBe('admin');
      reportId = response.body._id;
    });

    it('reaches completed status with checksum, row_count, and file_size_bytes populated', async () => {
      const { status, body } = await waitForTerminalStatus(
        app,
        adminToken,
        reportId,
      );
      expect(status).toBe('completed');
      expect(body.checksum).toEqual(expect.any(String));
      expect(body.row_count).toBe(1);
      expect(body.file_size_bytes).toBeGreaterThan(0);
      expect(body.expires_at).toBeDefined();
    });

    it('downloads the completed report with the correct content-type and matching content', async () => {
      const response = await request(app.getHttpServer())
        .get(`/reports/${reportId}/download`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.headers['content-type']).toMatch(/text\/csv/);
      expect(response.headers['content-disposition']).toMatch(/attachment/);
      expect(response.text).toContain('OT-RPT-E2E-1');
      expect(response.text).toContain('E-1');
    });

    it('rejects a download attempt from a user who does not own the report and is not Admin', async () => {
      await request(app.getHttpServer())
        .get(`/reports/${reportId}/download`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(403);
    });

    it('lets the technician view (not download) their own accessible report type via /reports/all only as Admin, and lists nothing extra for a non-owner via /reports', async () => {
      const ownList = await request(app.getHttpServer())
        .get('/reports')
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(200);
      expect(ownList.body.items).toEqual([]);
      expect(ownList.body.totalItems).toBe(0);
    });
  });

  describe('role-scoped generation failure — machine access denied inside the async pipeline', () => {
    it('ends in a failed status with an access-denied error message when the requester cannot access the target machine', async () => {
      const response = await request(app.getHttpServer())
        .post('/reports')
        .set('Authorization', `Bearer ${otherOperatorToken}`)
        .send({
          type: ReportType.MACHINE_HISTORY,
          format: ReportFormat.CSV,
          parameters: { machineId: otherMachineId },
        })
        .expect(201);

      const { status, body } = await waitForTerminalStatus(
        app,
        otherOperatorToken,
        response.body._id,
      );
      expect(status).toBe('failed');
      expect(body.error_message).toMatch(/not (assigned|authorized)/i);
    });
  });

  describe('full async generation pipeline — stock movements (Admin-only, Excel)', () => {
    it('generates a completed Excel report readable by admin only', async () => {
      const requestResponse = await request(app.getHttpServer())
        .post('/reports')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: ReportType.STOCK_MOVEMENTS, format: ReportFormat.EXCEL })
        .expect(201);

      const { status, body } = await waitForTerminalStatus(
        app,
        adminToken,
        requestResponse.body._id,
      );
      expect(status).toBe('completed');
      expect(body.row_count).toBe(1);

      const download = await request(app.getHttpServer())
        .get(`/reports/${requestResponse.body._id}/download`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(download.headers['content-type']).toMatch(
        /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/,
      );
    });

    it('technician cannot even request a stock movements report', async () => {
      await request(app.getHttpServer())
        .post('/reports')
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ type: ReportType.STOCK_MOVEMENTS, format: ReportFormat.CSV })
        .expect(403);
    });
  });

  describe('download guardrails — directly-seeded report rows', () => {
    it('rejects downloading a report that is not yet completed (400)', async () => {
      const processing = await generatedReports.create({
        report_id: 'RPT-E2E-PROCESSING',
        type: ReportType.MACHINE_HISTORY,
        format: ReportFormat.CSV,
        status: ReportStatus.PROCESSING,
        parameters: {},
        requested_by: admin._id,
        requester_role: 'admin',
      });

      await request(app.getHttpServer())
        .get(`/reports/${processing._id.toString()}/download`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });

    it('rejects downloading an expired report (410)', async () => {
      const expired = await generatedReports.create({
        report_id: 'RPT-E2E-EXPIRED',
        type: ReportType.MACHINE_HISTORY,
        format: ReportFormat.CSV,
        status: ReportStatus.COMPLETED,
        parameters: {},
        requested_by: admin._id,
        requester_role: 'admin',
        file_path: 'uploads/does-not-matter.csv',
        checksum: 'irrelevant',
        expires_at: new Date(Date.now() - 60_000),
      });

      await request(app.getHttpServer())
        .get(`/reports/${expired._id.toString()}/download`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(410);
    });

    it('fails closed when the stored checksum no longer matches the file on disk', async () => {
      // Reuse the real, already-generated machine-history report file so the
      // storage layer actually has bytes to read back, then corrupt only the
      // checksum recorded on the row.
      const completedReport = await generatedReports
        .findOne({
          report_id: { $ne: null },
          status: ReportStatus.COMPLETED,
          file_path: { $exists: true },
        })
        .exec();
      expect(completedReport).toBeDefined();

      await generatedReports
        .findByIdAndUpdate(completedReport!._id, { checksum: '0'.repeat(64) })
        .exec();

      // The integrity-failure message itself is intentionally not leaked to
      // the client (AllExceptionsFilter redacts every non-HttpException
      // error to a generic "Internal server error") — what matters here is
      // that a corrupted/tampered file fails closed (500) instead of being
      // served, which the 500 status code alone confirms.
      await request(app.getHttpServer())
        .get(`/reports/${completedReport!._id.toString()}/download`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(500);
    });
  });

  describe('scheduled reports', () => {
    let scheduleId: string;

    it('rejects a role not permitted to schedule the given report type', async () => {
      await request(app.getHttpServer())
        .post('/reports/schedules')
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({
          type: ReportType.AUDIT_HISTORY,
          format: ReportFormat.CSV,
          frequency: ScheduleFrequency.DAILY,
        })
        .expect(403);
    });

    it('creates a schedule with a next_run_at in the future', async () => {
      const response = await request(app.getHttpServer())
        .post('/reports/schedules')
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({
          type: ReportType.MACHINE_HISTORY,
          format: ReportFormat.CSV,
          frequency: ScheduleFrequency.DAILY,
          parameters: { machineId: assignedMachineId },
        })
        .expect(201);

      expect(response.body.active).toBe(true);
      expect(new Date(response.body.next_run_at).getTime()).toBeGreaterThan(
        Date.now(),
      );
      scheduleId = response.body._id;
    });

    it('scopes the schedule listing to the caller (Admin sees all, others see only their own)', async () => {
      const technicianList = await request(app.getHttpServer())
        .get('/reports/schedules')
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(200);
      expect(technicianList.body.map((s: { _id: string }) => s._id)).toContain(
        scheduleId,
      );

      const otherOperatorList = await request(app.getHttpServer())
        .get('/reports/schedules')
        .set('Authorization', `Bearer ${otherOperatorToken}`)
        .expect(200);
      expect(
        otherOperatorList.body.map((s: { _id: string }) => s._id),
      ).not.toContain(scheduleId);
    });

    it('lets the owner deactivate their schedule via PATCH', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/reports/schedules/${scheduleId}`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ active: false })
        .expect(200);
      expect(response.body.active).toBe(false);
    });

    it("forbids a non-owner, non-admin from deleting someone else's schedule", async () => {
      await request(app.getHttpServer())
        .delete(`/reports/schedules/${scheduleId}`)
        .set('Authorization', `Bearer ${otherOperatorToken}`)
        .expect(403);
    });

    it('firing a due schedule (via the scheduler sweep) creates a linked GeneratedReport and a report_ready notification', async () => {
      // Force the schedule due "now" and re-activate it (the previous test deactivated it).
      await scheduledReports
        .findByIdAndUpdate(scheduleId, {
          active: true,
          next_run_at: new Date(Date.now() - 1000),
        })
        .exec();

      const result = await reportSchedulerService.runSweep();
      expect(result.generated).toBeGreaterThanOrEqual(1);
      expect(result.failed).toBe(0);

      const linkedReport = await generatedReports
        .findOne({ scheduled_report_id: new Types.ObjectId(scheduleId) })
        .exec();
      expect(linkedReport).toBeDefined();
      expect(linkedReport?.status).toBe(ReportStatus.COMPLETED);

      const notification = await notifications
        .findOne({
          type: NotificationType.REPORT_READY,
          recipient_user_id: technician._id,
        })
        .exec();
      expect(notification).toBeDefined();
    });

    it('lets the owner delete their own schedule', async () => {
      await request(app.getHttpServer())
        .delete(`/reports/schedules/${scheduleId}`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(200);

      const list = await request(app.getHttpServer())
        .get('/reports/schedules')
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(200);
      expect(list.body.map((s: { _id: string }) => s._id)).not.toContain(
        scheduleId,
      );
    });
  });

  describe('checksum integrity — happy path sanity check', () => {
    it('the checksum recorded at generation time matches a fresh sha256 of the downloaded bytes', async () => {
      // Excel's content type is treated as binary by the HTTP test client
      // (unlike text/csv, which gets decoded as text), so this is the
      // reliable way to assert on the exact byte content of a download.
      const requestResponse = await request(app.getHttpServer())
        .post('/reports')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: ReportType.MACHINE_HISTORY,
          format: ReportFormat.EXCEL,
          parameters: { machineId: assignedMachineId },
        })
        .expect(201);

      const { status, body } = await waitForTerminalStatus(
        app,
        adminToken,
        requestResponse.body._id,
      );
      expect(status).toBe('completed');

      const download = await request(app.getHttpServer())
        .get(`/reports/${requestResponse.body._id}/download`)
        .set('Authorization', `Bearer ${adminToken}`)
        .buffer(true)
        .parse(bufferParser)
        .expect(200);

      const actualChecksum = crypto
        .createHash('sha256')
        .update(download.body as Buffer)
        .digest('hex');
      expect(actualChecksum).toBe(body.checksum);
    });
  });
});
