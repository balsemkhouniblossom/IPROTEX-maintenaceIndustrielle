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
import { Catalogue, CatalogueDocument } from '../src/schemas/catalogue.schema';
import {
  Notification,
  NotificationDocument,
} from '../src/schemas/notification.schema';
import {
  PartRequest,
  PartRequestDocument,
} from '../src/schemas/part-request.schema';
import { Stock, StockDocument } from '../src/schemas/stock.schema';

describe('Notification center (e2e)', () => {
  // A replica set is required: corrective-report creation writes the work
  // order and its intervention report inside a real Mongo transaction.
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
  let catalogues: Model<CatalogueDocument>;
  let notifications: Model<NotificationDocument>;
  let partRequests: Model<PartRequestDocument>;
  let stocks: Model<StockDocument>;

  let operatorToken: string;
  let otherOperatorToken: string;
  let technicianToken: string;
  let adminToken: string;
  let operator: UserDocument;
  let technician: UserDocument;
  let machine: MachineDocument;
  let moduleEntity: ModuleDocument;
  let part: CatalogueDocument;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongo.getUri('gmao_notification_center_e2e');
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
    catalogues = app.get(getModelToken(Catalogue.name));
    notifications = app.get(getModelToken(Notification.name));
    partRequests = app.get(getModelToken(PartRequest.name));
    stocks = app.get(getModelToken(Stock.name));

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
      name: 'Notification E2E machine type',
    });
    const moduleType = await moduleTypes.create({
      mod_type_id: 'MODTYPE-NOTIF-E2E',
      type_id: machineType._id,
      nom_module: 'Notification E2E module type',
    });
    machine = await machines.create({
      machine_id: 'MACHINE-NOTIF',
      type_id: machineType._id,
      serial_no: 'NOTIF-001',
      status: 'active',
    });
    moduleEntity = await modules.create({
      module_id: 'MODULE-NOTIF',
      machine_id: machine._id,
      mod_type_id: moduleType._id,
    });
    part = await catalogues.create({
      part_id: 'PART-NOTIF-CATALOGUE',
      nom_piece: 'Drive belt',
      ref_constructeur: 'DB-100',
    });
    await stocks.create({
      stock_id: 'STOCK-NOTIF',
      part_id: part._id,
      quantite_en_stock: 10,
      quantite_reservee: 0,
      version: 1,
    });

    operator = await users.create({
      user_id: 'OP-NOTIF-E2E',
      nom_complet: 'Notification Operator',
      email: 'notification-operator-e2e@example.test',
      password: 'x',
      role: 'operator',
      is_active: true,
      is_verified: true,
      assigned_machine_ids: [machine._id],
    });
    const otherOperator = await users.create({
      user_id: 'OP-NOTIF-OTHER-E2E',
      nom_complet: 'Other Notification Operator',
      email: 'notification-other-operator-e2e@example.test',
      password: 'x',
      role: 'operator',
      is_active: true,
      is_verified: true,
      assigned_machine_ids: [machine._id],
    });
    technician = await users.create({
      user_id: 'TECH-NOTIF-E2E',
      nom_complet: 'Notification Technician',
      email: 'notification-technician-e2e@example.test',
      password: 'x',
      role: 'technician',
      is_active: true,
      is_verified: true,
    });
    const admin = await users.create({
      user_id: 'ADMIN-NOTIF-E2E',
      nom_complet: 'Notification Admin',
      email: 'notification-admin-e2e@example.test',
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

  describe('authentication', () => {
    it('rejects an anonymous request', async () => {
      await request(app.getHttpServer()).get('/notifications').expect(401);
    });
  });

  describe('corrective report awaiting validation -> Admin broadcast, then validation decision -> Operator', () => {
    let workOrderId: string;

    it('broadcasts a corrective-awaiting-validation notification to Admins only when the Operator reports a fault', async () => {
      const response = await request(app.getHttpServer())
        .post('/operator/report-problem')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          machine_id: machine._id.toString(),
          code_panne: 'FAULT-NOTIF-1',
          actions: ['Reset breaker'],
        })
        .expect(201);

      workOrderId = response.body.workOrder._id;

      const adminList = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const adminNotification = adminList.body.items.find(
        (item: { type: string; work_order_id: string }) =>
          item.type === 'corrective_awaiting_validation' &&
          item.work_order_id === workOrderId,
      );
      expect(adminNotification).toBeTruthy();
      expect(adminNotification.is_read).toBe(false);

      const operatorList = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
      expect(
        operatorList.body.items.some(
          (item: { type: string }) =>
            item.type === 'corrective_awaiting_validation',
        ),
      ).toBe(false);

      const technicianList = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(200);
      expect(
        technicianList.body.items.some(
          (item: { type: string }) =>
            item.type === 'corrective_awaiting_validation',
        ),
      ).toBe(false);
    });

    it('does not create a second broadcast notification when the same fault report is resubmitted (dedup)', async () => {
      await request(app.getHttpServer())
        .post('/operator/report-problem')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          machine_id: machine._id.toString(),
          code_panne: 'FAULT-NOTIF-1',
          actions: ['Reset breaker'],
        })
        .expect(201);

      const count = await notifications.countDocuments({
        type: 'corrective_awaiting_validation',
        work_order_id: new Types.ObjectId(workOrderId),
      });
      expect(count).toBe(1);
    });

    it('notifies the Operator once Admin approves the report, and lets the Operator manage that notification', async () => {
      await request(app.getHttpServer())
        .post(`/work-orders/${workOrderId}/validation`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'approve' })
        .expect(201);

      const operatorList = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
      const approval = operatorList.body.items.find(
        (item: { type: string }) => item.type === 'validation_approved',
      );
      expect(approval).toBeTruthy();
      expect(approval.is_read).toBe(false);

      const otherOperatorList = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', `Bearer ${otherOperatorToken}`)
        .expect(200);
      expect(
        otherOperatorList.body.items.some(
          (item: { _id: string }) => item._id === approval._id,
        ),
      ).toBe(false);

      await request(app.getHttpServer())
        .patch(`/notifications/${approval._id}/read`)
        .set('Authorization', `Bearer ${otherOperatorToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .patch(`/notifications/${approval._id}/read`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      const afterRead = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
      expect(
        afterRead.body.items.find(
          (item: { _id: string }) => item._id === approval._id,
        ).is_read,
      ).toBe(true);

      await request(app.getHttpServer())
        .delete(`/notifications/${approval._id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/notifications/${approval._id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(404);
    });
  });

  describe('part request created -> Technician broadcast, decision -> Operator', () => {
    let secondWorkOrderId: string;
    let partRequestId: string;

    it('creates a corrective work order, then broadcasts a part-request-created notification to Technicians only', async () => {
      const created = await request(app.getHttpServer())
        .post('/operator/report-problem')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          machine_id: machine._id.toString(),
          code_panne: 'FAULT-NOTIF-2',
          actions: ['Inspect wiring'],
        })
        .expect(201);
      secondWorkOrderId = created.body.workOrder._id;

      const partRequestResponse = await request(app.getHttpServer())
        .post(`/operator/work-orders/${secondWorkOrderId}/parts-request`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ part_id: part._id.toString(), quantity: 2 })
        .expect(201);
      partRequestId = partRequestResponse.body._id;

      const technicianList = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(200);
      expect(
        technicianList.body.items.some(
          (item: { type: string; reference_id: string }) =>
            item.type === 'part_request_created' &&
            item.reference_id === partRequestId,
        ),
      ).toBe(true);

      const adminList = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(
        adminList.body.items.some(
          (item: { type: string }) => item.type === 'part_request_created',
        ),
      ).toBe(false);
    });

    it('rejects a decision from a role that is neither Technician nor Admin', async () => {
      await request(app.getHttpServer())
        .patch(`/work-orders/part-requests/${partRequestId}/decision`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ action: 'approve' })
        .expect(403);
    });

    it('approves the part request and notifies the requesting Operator', async () => {
      await request(app.getHttpServer())
        .patch(`/work-orders/part-requests/${partRequestId}/decision`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ action: 'approve' })
        .expect(200);

      const stored = await partRequests.findById(partRequestId);
      expect(stored?.status).toBe('reserved');

      const operatorList = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
      expect(
        operatorList.body.items.some(
          (item: { type: string; reference_id: string }) =>
            item.type === 'part_request_decision' &&
            item.reference_id === partRequestId,
        ),
      ).toBe(true);
    });

    it('rejects deciding an already-decided part request', async () => {
      await request(app.getHttpServer())
        .patch(`/work-orders/part-requests/${partRequestId}/decision`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ action: 'reject' })
        .expect(409);
    });
  });

  describe('mark-all-read and clear-all', () => {
    it('marks every unread notification visible to this user as read, and clearing all removes only this users own notifications', async () => {
      const beforeCount = await request(app.getHttpServer())
        .get('/notifications/unread-count')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
      expect(beforeCount.body.count).toBeGreaterThan(0);

      await request(app.getHttpServer())
        .patch('/notifications/read-all')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      const afterMarkAll = await request(app.getHttpServer())
        .get('/notifications/unread-count')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
      expect(afterMarkAll.body.count).toBe(0);

      const technicianUnreadBefore = await request(app.getHttpServer())
        .get('/notifications/unread-count')
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(200);
      expect(technicianUnreadBefore.body.count).toBeGreaterThan(0);

      await request(app.getHttpServer())
        .delete('/notifications')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      const operatorListAfterClear = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
      expect(operatorListAfterClear.body.items).toHaveLength(0);

      // Clearing the Operator's own notifications must never touch the
      // Technician's separate, still-unread broadcast notifications.
      const technicianUnreadAfter = await request(app.getHttpServer())
        .get('/notifications/unread-count')
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(200);
      expect(technicianUnreadAfter.body.count).toBe(
        technicianUnreadBefore.body.count,
      );
    });
  });
});
