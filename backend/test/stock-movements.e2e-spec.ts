/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
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
import { Stock, StockDocument } from '../src/schemas/stock.schema';
import {
  StockMovement,
  StockMovementDocument,
} from '../src/schemas/stock-movement.schema';
import {
  PartRequest,
  PartRequestDocument,
} from '../src/schemas/part-request.schema';
import { OTPieces, OTPiecesDocument } from '../src/schemas/ot-pieces.schema';

describe('Stock movements — transactional, traceable inventory (e2e)', () => {
  // A replica set is required: every stock-affecting operation here
  // (create, reserve, cancel, consume, return, adjust) runs inside a real
  // Mongo multi-document transaction spanning Stock + StockMovement (and,
  // for reservations, PartRequest too).
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
  let stocks: Model<StockDocument>;
  let stockMovements: Model<StockMovementDocument>;
  let partRequests: Model<PartRequestDocument>;
  let otPieces: Model<OTPiecesDocument>;

  let adminToken: string;
  let operatorToken: string;
  let technicianToken: string;
  let admin: UserDocument;
  let operator: UserDocument;
  let technician: UserDocument;
  let machine: MachineDocument;
  let moduleEntity: ModuleDocument;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongo.getUri('gmao_stock_movements_e2e');
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
    stocks = app.get(getModelToken(Stock.name));
    stockMovements = app.get(getModelToken(StockMovement.name));
    partRequests = app.get(getModelToken(PartRequest.name));
    otPieces = app.get(getModelToken(OTPieces.name));

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
      name: 'Stock movements E2E machine type',
    });
    const moduleType = await moduleTypes.create({
      mod_type_id: 'MODTYPE-STOCK-E2E',
      type_id: machineType._id,
      nom_module: 'Stock movements E2E module type',
    });
    machine = await machines.create({
      machine_id: 'MACHINE-STOCK',
      type_id: machineType._id,
      serial_no: 'STOCK-001',
      status: 'active',
    });
    moduleEntity = await modules.create({
      module_id: 'MODULE-STOCK',
      machine_id: machine._id,
      mod_type_id: moduleType._id,
    });

    admin = await users.create({
      user_id: 'ADMIN-STOCK-E2E',
      nom_complet: 'Stock Admin',
      email: 'stock-admin-e2e@example.test',
      password: 'x',
      role: 'admin',
      is_active: true,
      is_verified: true,
    });
    operator = await users.create({
      user_id: 'OP-STOCK-E2E',
      nom_complet: 'Stock Operator',
      email: 'stock-operator-e2e@example.test',
      password: 'x',
      role: 'operator',
      is_active: true,
      is_verified: true,
      assigned_machine_ids: [machine._id],
    });
    technician = await users.create({
      user_id: 'TECH-STOCK-E2E',
      nom_complet: 'Stock Technician',
      email: 'stock-technician-e2e@example.test',
      password: 'x',
      role: 'technician',
      is_active: true,
      is_verified: true,
    });

    adminToken = tokenFor(admin);
    operatorToken = tokenFor(operator);
    technicianToken = tokenFor(technician);
  }

  async function createCorrectiveWorkOrder(overrides: Record<string, unknown> = {}) {
    return workOrders.create({
      ot_id: `WO-STOCK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      machine_id: machine._id,
      module_id: moduleEntity._id,
      technician_id: operator._id,
      description: 'Motor overheating',
      type_maintenance: 'corrective',
      status: 'waiting_validation',
      priorite: 'high',
      code_panne: 'FAULT-STOCK',
      date_created: new Date('2026-07-14T08:00:00.000Z'),
      date_start: new Date('2026-07-14T08:00:00.000Z'),
      ...overrides,
    });
  }

  // Each call mints a brand-new Catalogue part before creating its Stock
  // record. This matters because StockMovementsService/decidePartRequest
  // resolve "the" stock for a part via `findOne({ part_id })` — if two
  // tests shared one Catalogue part, they would also silently share (and
  // corrupt) each other's Stock document.
  async function createStockViaApi(quantity: number) {
    const freshPart = await catalogues.create({
      part_id: `PART-STOCK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      nom_piece: 'Drive belt',
      ref_constructeur: 'DB-100',
    });
    const response = await request(app.getHttpServer())
      .post('/stocks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        stock_id: `STOCK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        part_id: freshPart._id.toString(),
        quantite_en_stock: quantity,
      })
      .expect(201);
    return { stock: response.body, part: freshPart };
  }

  describe('creation and orphan prevention', () => {
    it('rejects creating a stock record against a part that does not exist', async () => {
      await request(app.getHttpServer())
        .post('/stocks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          stock_id: `STOCK-ORPHAN-${Date.now()}`,
          part_id: new Types.ObjectId().toString(),
          quantite_en_stock: 5,
        })
        .expect(400);
    });

    it('creates a stock record with version 1, zero reservations, and an audited initial-quantity movement', async () => {
      const { stock } = await createStockViaApi(20);

      expect(stock.quantite_en_stock).toBe(20);
      expect(stock.quantite_reservee).toBe(0);
      expect(stock.version).toBe(1);

      const movementsResponse = await request(app.getHttpServer())
        .get(`/stocks/${stock._id}/movements`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(movementsResponse.body.items).toHaveLength(1);
      expect(movementsResponse.body.items[0]).toMatchObject({
        type: 'adjustment',
        quantity_delta: 20,
        quantite_en_stock_after: 20,
        reason: 'Initial stock on record creation',
      });
    });

    it('writes no initial movement when a stock record is created at zero quantity', async () => {
      const { stock } = await createStockViaApi(0);

      const movementsResponse = await request(app.getHttpServer())
        .get(`/stocks/${stock._id}/movements`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(movementsResponse.body.items).toHaveLength(0);
    });
  });

  describe('reservation, cancellation, and rollback safety', () => {
    it('reserves stock transactionally on approval, linking the movement to the work order and part request', async () => {
      const { stock, part } = await createStockViaApi(10);
      const workOrder = await createCorrectiveWorkOrder();

      const partRequestResponse = await request(app.getHttpServer())
        .post(`/operator/work-orders/${workOrder._id.toString()}/parts-request`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ part_id: part._id.toString(), quantity: 4 })
        .expect(201);
      const partRequestId = partRequestResponse.body._id;

      await request(app.getHttpServer())
        .patch(`/work-orders/part-requests/${partRequestId}/decision`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ action: 'approve' })
        .expect(200);

      const stockAfter = await stocks.findById(stock._id);
      expect(stockAfter?.quantite_en_stock).toBe(10);
      expect(stockAfter?.quantite_reservee).toBe(4);
      expect(stockAfter?.version).toBe(2);

      const storedRequest = await partRequests.findById(partRequestId);
      expect(storedRequest?.status).toBe('reserved');

      const movements = await stockMovements.find({ stock_id: new Types.ObjectId(stock._id) }).sort({ createdAt: 1 });
      expect(movements).toHaveLength(2);
      const reservation = movements[1];
      expect(reservation.type).toBe('reservation');
      expect(reservation.reserved_delta).toBe(4);
      expect(reservation.work_order_id?.toString()).toBe(workOrder._id.toString());
      expect(reservation.part_request_id?.toString()).toBe(partRequestId);
    });

    it('rolls back the entire transaction (no partial state) when a reservation would exceed available stock', async () => {
      const { stock, part } = await createStockViaApi(3);
      const workOrder = await createCorrectiveWorkOrder();

      const partRequestResponse = await request(app.getHttpServer())
        .post(`/operator/work-orders/${workOrder._id.toString()}/parts-request`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ part_id: part._id.toString(), quantity: 999 })
        .expect(201);
      const partRequestId = partRequestResponse.body._id;

      await request(app.getHttpServer())
        .patch(`/work-orders/part-requests/${partRequestId}/decision`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ action: 'approve' })
        .expect(409);

      // Neither side of the transaction was applied: the request is still
      // pending (not stuck half-approved) and Stock/its ledger are
      // completely untouched by the failed attempt.
      const storedRequest = await partRequests.findById(partRequestId);
      expect(storedRequest?.status).toBe('pending');

      const stockAfter = await stocks.findById(stock._id);
      expect(stockAfter?.quantite_en_stock).toBe(3);
      expect(stockAfter?.quantite_reservee).toBe(0);
      expect(stockAfter?.version).toBe(1);

      const movementCount = await stockMovements.countDocuments({ stock_id: new Types.ObjectId(stock._id) });
      expect(movementCount).toBe(1); // only the initial-creation movement
    });

    it('releases a reservation on cancel, restoring available stock and recording a Cancellation movement', async () => {
      const { stock, part } = await createStockViaApi(10);
      const workOrder = await createCorrectiveWorkOrder();

      const partRequestResponse = await request(app.getHttpServer())
        .post(`/operator/work-orders/${workOrder._id.toString()}/parts-request`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ part_id: part._id.toString(), quantity: 5 })
        .expect(201);
      const partRequestId = partRequestResponse.body._id;

      await request(app.getHttpServer())
        .patch(`/work-orders/part-requests/${partRequestId}/decision`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ action: 'approve' })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/work-orders/part-requests/${partRequestId}/decision`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ action: 'cancel', reason: 'No longer needed' })
        .expect(200);

      const stockAfter = await stocks.findById(stock._id);
      expect(stockAfter?.quantite_en_stock).toBe(10);
      expect(stockAfter?.quantite_reservee).toBe(0);

      const storedRequest = await partRequests.findById(partRequestId);
      expect(storedRequest?.status).toBe('cancelled');

      const movements = await stockMovements.find({ stock_id: new Types.ObjectId(stock._id) }).sort({ createdAt: 1 });
      const cancellation = movements[movements.length - 1];
      expect(cancellation.type).toBe('cancellation');
      expect(cancellation.reserved_delta).toBe(-5);
      expect(cancellation.reason).toBe('No longer needed');
    });

    it('rejects cancelling a request that is not currently reserved', async () => {
      const workOrder = await createCorrectiveWorkOrder();
      const { part } = await createStockViaApi(10);

      const partRequestResponse = await request(app.getHttpServer())
        .post(`/operator/work-orders/${workOrder._id.toString()}/parts-request`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ part_id: part._id.toString(), quantity: 2 })
        .expect(201);
      const partRequestId = partRequestResponse.body._id;

      await request(app.getHttpServer())
        .patch(`/work-orders/part-requests/${partRequestId}/decision`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ action: 'cancel' })
        .expect(409);
    });
  });

  describe('consumption and return, via the Technician parts endpoint', () => {
    async function reserveForTechnicianConsumption(stockQuantity: number, reserveQuantity: number) {
      const { stock, part } = await createStockViaApi(stockQuantity);
      const workOrder = await createCorrectiveWorkOrder();

      const partRequestResponse = await request(app.getHttpServer())
        .post(`/operator/work-orders/${workOrder._id.toString()}/parts-request`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ part_id: part._id.toString(), quantity: reserveQuantity })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/work-orders/part-requests/${partRequestResponse.body._id}/decision`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ action: 'approve' })
        .expect(200);

      // Test scaffolding only: hand the work order over to the Technician
      // (as the dedicated claim/start endpoints would) so the Technician's
      // own parts endpoint — which is scoped to work orders it owns — can
      // act on it. The claim/start state machine itself is covered by its
      // own tests elsewhere; this file is only about the stock ledger.
      await workOrders.findByIdAndUpdate(workOrder._id, {
        $set: { technician_id: technician._id, status: 'in_progress' },
      });

      return { stock, part, workOrder, partRequestId: partRequestResponse.body._id };
    }

    it('drains the reservation and stock together, and marks the request Fulfilled, when consumption matches the reserved amount exactly', async () => {
      const { stock, part, workOrder, partRequestId } = await reserveForTechnicianConsumption(10, 4);

      await request(app.getHttpServer())
        .post(`/technician/work-orders/${workOrder._id.toString()}/parts`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ partId: part._id.toString(), quantity: 4 })
        .expect(201);

      const stockAfter = await stocks.findById(stock._id);
      expect(stockAfter?.quantite_en_stock).toBe(6);
      expect(stockAfter?.quantite_reservee).toBe(0);

      const storedRequest = await partRequests.findById(partRequestId);
      expect(storedRequest?.status).toBe('fulfilled');

      const movements = await stockMovements.find({ stock_id: new Types.ObjectId(stock._id) }).sort({ createdAt: 1 });
      const consumption = movements[movements.length - 1];
      expect(consumption.type).toBe('consumption');
      expect(consumption.quantity_delta).toBe(-4);
      expect(consumption.reserved_delta).toBe(-4);
      expect(consumption.work_order_id?.toString()).toBe(workOrder._id.toString());
      expect(consumption.part_request_id?.toString()).toBe(partRequestId);
    });

    it('draws down the reservation first and only pulls the overflow from the general pool, leaving the request Fulfilled', async () => {
      const { stock, part, workOrder, partRequestId } = await reserveForTechnicianConsumption(10, 3);

      // Consume 5: reservation only covers 3, so 2 must come from the
      // general (unreserved) pool — proving the guard math and the
      // Fulfilled transition both trigger correctly for a mixed draw.
      await request(app.getHttpServer())
        .post(`/technician/work-orders/${workOrder._id.toString()}/parts`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ partId: part._id.toString(), quantity: 5 })
        .expect(201);

      const stockAfter = await stocks.findById(stock._id);
      expect(stockAfter?.quantite_en_stock).toBe(5);
      expect(stockAfter?.quantite_reservee).toBe(0);

      const storedRequest = await partRequests.findById(partRequestId);
      expect(storedRequest?.status).toBe('fulfilled');
    });

    it('records a Return and increases stock when the corrected quantity is lower than before, without ever going negative', async () => {
      const { stock, part, workOrder } = await reserveForTechnicianConsumption(10, 6);

      await request(app.getHttpServer())
        .post(`/technician/work-orders/${workOrder._id.toString()}/parts`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ partId: part._id.toString(), quantity: 6 })
        .expect(201);

      let stockAfter = await stocks.findById(stock._id);
      expect(stockAfter?.quantite_en_stock).toBe(4);

      // Correct the recorded usage down from 6 to 2 — a return of 4.
      await request(app.getHttpServer())
        .post(`/technician/work-orders/${workOrder._id.toString()}/parts`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ partId: part._id.toString(), quantity: 2 })
        .expect(201);

      stockAfter = await stocks.findById(stock._id);
      expect(stockAfter?.quantite_en_stock).toBe(8);

      const movements = await stockMovements.find({ stock_id: new Types.ObjectId(stock._id) }).sort({ createdAt: 1 });
      const returnMovement = movements[movements.length - 1];
      expect(returnMovement.type).toBe('return');
      expect(returnMovement.quantity_delta).toBe(4);
      expect(returnMovement.reserved_delta).toBe(0);
    });

    it('rejects consumption that would exceed what is actually available, leaving Stock unchanged', async () => {
      const { stock, part, workOrder } = await reserveForTechnicianConsumption(5, 2);

      await request(app.getHttpServer())
        .post(`/technician/work-orders/${workOrder._id.toString()}/parts`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ partId: part._id.toString(), quantity: 999 })
        .expect(409);

      const stockAfter = await stocks.findById(stock._id);
      expect(stockAfter?.quantite_en_stock).toBe(5);
      expect(stockAfter?.quantite_reservee).toBe(2);

      const otPieceCount = await otPieces.countDocuments({ ot_id: workOrder._id });
      expect(otPieceCount).toBe(0); // the OTPieces usage row was never created either — full rollback
    });
  });

  describe('adjustments and optimistic concurrency', () => {
    it('applies a positive adjustment and records the reason', async () => {
      const { stock } = await createStockViaApi(10);

      const response = await request(app.getHttpServer())
        .post(`/stocks/${stock._id}/adjustment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ delta: 15, reason: 'Found extra stock during audit', expected_version: 1 })
        .expect(201);
      expect(response.body.quantite_en_stock_after).toBe(25);

      const stockAfter = await stocks.findById(stock._id);
      expect(stockAfter?.quantite_en_stock).toBe(25);
      expect(stockAfter?.version).toBe(2);
    });

    it('prevents a negative adjustment from taking stock below zero', async () => {
      const { stock } = await createStockViaApi(5);

      await request(app.getHttpServer())
        .post(`/stocks/${stock._id}/adjustment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ delta: -10, reason: 'Damaged goods', expected_version: 1 })
        .expect(409);

      const stockAfter = await stocks.findById(stock._id);
      expect(stockAfter?.quantite_en_stock).toBe(5);
      expect(stockAfter?.version).toBe(1);
    });

    it('rejects an adjustment with a stale expected_version (optimistic concurrency)', async () => {
      const { stock } = await createStockViaApi(10);

      await request(app.getHttpServer())
        .post(`/stocks/${stock._id}/adjustment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ delta: 5, reason: 'First adjustment', expected_version: 1 })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/stocks/${stock._id}/adjustment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ delta: 5, reason: 'Stale retry', expected_version: 1 })
        .expect(409);

      const stockAfter = await stocks.findById(stock._id);
      expect(stockAfter?.quantite_en_stock).toBe(15);
      expect(stockAfter?.version).toBe(2);
    });

    it('lets exactly one of two concurrent adjustments against the same version win, the other failing with a conflict', async () => {
      const { stock } = await createStockViaApi(50);

      const [first, second] = await Promise.allSettled([
        request(app.getHttpServer())
          .post(`/stocks/${stock._id}/adjustment`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ delta: 10, reason: 'Concurrent adjustment A', expected_version: 1 }),
        request(app.getHttpServer())
          .post(`/stocks/${stock._id}/adjustment`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ delta: 20, reason: 'Concurrent adjustment B', expected_version: 1 }),
      ]);

      const statuses = [first, second].map((result) =>
        result.status === 'fulfilled' ? result.value.status : -1,
      );
      expect(statuses.filter((status) => status === 201)).toHaveLength(1);
      expect(statuses.filter((status) => status === 409)).toHaveLength(1);

      const stockAfter = await stocks.findById(stock._id);
      // Exactly one delta was ever applied — never both, never neither.
      expect([60, 70]).toContain(stockAfter?.quantite_en_stock);
      expect(stockAfter?.version).toBe(2);

      const movementCount = await stockMovements.countDocuments({ stock_id: new Types.ObjectId(stock._id) });
      expect(movementCount).toBe(2); // initial-creation + exactly one successful adjustment
    });
  });

  describe('concurrent reservations never over-commit the same stock', () => {
    it('lets only one of two competing reservations succeed when stock cannot cover both', async () => {
      const { stock, part } = await createStockViaApi(5);
      const workOrderA = await createCorrectiveWorkOrder();
      const workOrderB = await createCorrectiveWorkOrder();

      const [requestAResponse, requestBResponse] = await Promise.all([
        request(app.getHttpServer())
          .post(`/operator/work-orders/${workOrderA._id.toString()}/parts-request`)
          .set('Authorization', `Bearer ${operatorToken}`)
          .send({ part_id: part._id.toString(), quantity: 4 }),
        request(app.getHttpServer())
          .post(`/operator/work-orders/${workOrderB._id.toString()}/parts-request`)
          .set('Authorization', `Bearer ${operatorToken}`)
          .send({ part_id: part._id.toString(), quantity: 4 }),
      ]);
      expect(requestAResponse.status).toBe(201);
      expect(requestBResponse.status).toBe(201);

      const [approveA, approveB] = await Promise.allSettled([
        request(app.getHttpServer())
          .patch(`/work-orders/part-requests/${requestAResponse.body._id}/decision`)
          .set('Authorization', `Bearer ${technicianToken}`)
          .send({ action: 'approve' }),
        request(app.getHttpServer())
          .patch(`/work-orders/part-requests/${requestBResponse.body._id}/decision`)
          .set('Authorization', `Bearer ${technicianToken}`)
          .send({ action: 'approve' }),
      ]);

      const statuses = [approveA, approveB].map((result) =>
        result.status === 'fulfilled' ? result.value.status : -1,
      );
      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
      expect(statuses.filter((status) => status === 409)).toHaveLength(1);

      const stockAfter = await stocks.findById(stock._id);
      // Only one reservation of 4 was ever applied against 5 available —
      // never both (which would have driven reserved above stock).
      expect(stockAfter?.quantite_reservee).toBe(4);
      expect(stockAfter?.quantite_en_stock).toBe(5);

      const requestStatuses = await Promise.all([
        partRequests.findById(requestAResponse.body._id).then((doc) => doc?.status),
        partRequests.findById(requestBResponse.body._id).then((doc) => doc?.status),
      ]);
      expect(requestStatuses.sort()).toEqual(['pending', 'reserved']);
    });
  });

  describe('audit history', () => {
    it('accumulates a complete, chronologically ordered ledger across reserve -> consume and adjust', async () => {
      const { stock, part } = await createStockViaApi(20);
      const workOrder = await createCorrectiveWorkOrder();
      const partRequestResponse = await request(app.getHttpServer())
        .post(`/operator/work-orders/${workOrder._id.toString()}/parts-request`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ part_id: part._id.toString(), quantity: 5 })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/work-orders/part-requests/${partRequestResponse.body._id}/decision`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ action: 'approve' })
        .expect(200);
      await workOrders.findByIdAndUpdate(workOrder._id, {
        $set: { technician_id: technician._id, status: 'in_progress' },
      });

      await request(app.getHttpServer())
        .post(`/technician/work-orders/${workOrder._id.toString()}/parts`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ partId: part._id.toString(), quantity: 5 })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/stocks/${stock._id}/adjustment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ delta: -3, reason: 'Damaged in storage', expected_version: 3 })
        .expect(201);

      const movementsResponse = await request(app.getHttpServer())
        .get(`/stocks/${stock._id}/movements`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const types = movementsResponse.body.items.map((item: { type: string }) => item.type);
      // Newest first: adjustment, consumption, reservation, initial creation.
      expect(types).toEqual(['adjustment', 'consumption', 'reservation', 'adjustment']);

      const stockAfter = await stocks.findById(stock._id);
      // 20 (initial) - 5 (consumption) - 3 (adjustment) = 12; the
      // reservation itself never touches quantite_en_stock.
      expect(stockAfter?.quantite_en_stock).toBe(12);
    });
  });

  describe('deletion is blocked while a stock record has movement history (permanent audit trail)', () => {
    it('rejects deleting a stock record that has any recorded movement, even once fully drained', async () => {
      const { stock } = await createStockViaApi(4);

      await request(app.getHttpServer())
        .post(`/stocks/${stock._id}/adjustment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ delta: -4, reason: 'Fully consumed for test', expected_version: 1 })
        .expect(201);

      const stockAfter = await stocks.findById(stock._id);
      expect(stockAfter?.quantite_en_stock).toBe(0);
      expect(stockAfter?.quantite_reservee).toBe(0);

      await request(app.getHttpServer())
        .delete(`/stocks/${stock._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });

    it('allows deleting a stock record that was created at zero and never had any movement', async () => {
      const { stock } = await createStockViaApi(0);

      await request(app.getHttpServer())
        .delete(`/stocks/${stock._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const stockAfter = await stocks.findById(stock._id);
      expect(stockAfter).toBeNull();
    });
  });
});
