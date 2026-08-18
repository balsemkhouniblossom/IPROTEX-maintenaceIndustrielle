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
import { WorkOrder, WorkOrderDocument } from '../src/schemas/work-order.schema';
import { Catalogue, CatalogueDocument } from '../src/schemas/catalogue.schema';
import { Stock, StockDocument } from '../src/schemas/stock.schema';
import {
  StockMovement,
  StockMovementDocument,
} from '../src/schemas/stock-movement.schema';
import { OTPieces, OTPiecesDocument } from '../src/schemas/ot-pieces.schema';

// The API always returns Mongo ids as plain strings; Mongoose's automatic
// string-to-ObjectId cast on query filters isn't reliable for every model
// in this test harness, so every filter built from an HTTP response id
// goes through this explicit cast rather than risking a silent
// false-empty result.
function oid(value: string | Types.ObjectId): Types.ObjectId {
  return value instanceof Types.ObjectId ? value : new Types.ObjectId(value);
}

/**
 * `OtPiecesService` used to mutate `OTPieces` directly with zero stock
 * adjustment and zero audit trail (see `DUPLICATE_MODELS_MIGRATION_PLAN.md`
 * and the production-readiness audit). It now routes every write through
 * `StockMovementsService` inside a real Mongo transaction — this spec
 * proves both the happy path (Stock/StockMovement actually move with the
 * OTPieces record) and, critically, that a mid-transaction failure rolls
 * *everything* back rather than leaving Stock and OTPieces desynced again.
 */
describe('OT Pieces — transactional stock integration (e2e)', () => {
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
  let otPieces: Model<OTPiecesDocument>;

  let adminToken: string;
  let admin: UserDocument;
  let machine: MachineDocument;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongo.getUri('gmao_ot_pieces_e2e');
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
    catalogues = app.get(getModelToken(Catalogue.name));
    stocks = app.get(getModelToken(Stock.name));
    stockMovements = app.get(getModelToken(StockMovement.name));
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
      name: 'OT Pieces E2E machine type',
    });
    machine = await machines.create({
      machine_id: 'MACHINE-OTP',
      type_id: machineType._id,
      serial_no: 'OTP-001',
      status: 'active',
    });

    admin = await users.create({
      user_id: 'ADMIN-OTP-E2E',
      nom_complet: 'OT Pieces Admin',
      email: 'ot-pieces-admin-e2e@example.test',
      password: 'x',
      role: 'admin',
      is_active: true,
      is_verified: true,
    });

    adminToken = tokenFor(admin);
  }

  async function createWorkOrder() {
    return workOrders.create({
      ot_id: `WO-OTP-${Date.now()}-${randomUUID()}`,
      machine_id: machine._id,
      description: 'OT Pieces e2e work order',
      type_maintenance: 'corrective',
      status: 'in_progress',
      priorite: 'high',
      date_created: new Date('2026-07-14T08:00:00.000Z'),
      date_start: new Date('2026-07-14T08:00:00.000Z'),
    });
  }

  // Each helper mints a brand-new Catalogue part before creating its Stock
  // record, matching stock-movements.e2e-spec.ts's convention — Stock is
  // resolved via `findOne({ part_id })`, so two tests must never share one
  // Catalogue part or they would silently corrupt each other's Stock.
  async function createStockViaApi(quantity: number) {
    const part = await catalogues.create({
      part_id: `PART-OTP-${Date.now()}-${randomUUID()}`,
      nom_piece: 'Bearing',
      ref_constructeur: 'BR-100',
    });
    const response = await request(app.getHttpServer())
      .post('/stocks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        stock_id: `STOCK-OTP-${Date.now()}-${randomUUID()}`,
        part_id: part._id.toString(),
        quantite_en_stock: quantity,
      })
      .expect(201);
    return { stock: response.body, part };
  }

  describe('create', () => {
    it('decrements stock and records an audited consumption movement', async () => {
      const workOrder = await createWorkOrder();
      const { stock, part } = await createStockViaApi(10);

      const created = await request(app.getHttpServer())
        .post('/ot-pieces')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ot_id: workOrder._id.toString(),
          part_id: part._id.toString(),
          quantite: 3,
        })
        .expect(201);

      expect(created.body.quantite).toBe(3);

      const updatedStock = await stocks.findById(stock._id).lean();
      expect(updatedStock?.quantite_en_stock).toBe(7);

      // `createStockViaApi` itself writes one "initial stock" adjustment
      // movement, so filter to the consumption movement this test actually
      // cares about rather than asserting on the total movement count.
      const consumptionMovements = await stockMovements
        .find({ stock_id: oid(stock._id), type: 'consumption' })
        .lean();
      expect(consumptionMovements).toHaveLength(1);
      expect(consumptionMovements[0]).toMatchObject({
        quantity_delta: -3,
      });
    });

    it('rejects creation against a part with no stock record, writing neither OTPieces nor a movement', async () => {
      const workOrder = await createWorkOrder();
      const orphanPart = await catalogues.create({
        part_id: `PART-OTP-ORPHAN-${Date.now()}`,
        nom_piece: 'Unstocked part',
        ref_constructeur: 'NS-1',
      });

      await request(app.getHttpServer())
        .post('/ot-pieces')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ot_id: workOrder._id.toString(),
          part_id: orphanPart._id.toString(),
          quantite: 2,
        })
        .expect(404);

      const rows = await otPieces.find({ ot_id: oid(workOrder._id) }).lean();
      expect(rows).toHaveLength(0);
    });
  });

  describe('update', () => {
    it('applies only the delta to stock when the quantity changes for the same part', async () => {
      const workOrder = await createWorkOrder();
      const { stock, part } = await createStockViaApi(10);
      const created = await request(app.getHttpServer())
        .post('/ot-pieces')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ot_id: workOrder._id.toString(),
          part_id: part._id.toString(),
          quantite: 3,
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/ot-pieces/${created.body._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantite: 5 })
        .expect(200);

      const updatedStock = await stocks.findById(stock._id).lean();
      // Started at 10, 3 consumed (-> 7), then a further 2 consumed (-> 5).
      expect(updatedStock?.quantite_en_stock).toBe(5);

      const consumptionMovements = await stockMovements
        .find({ stock_id: oid(stock._id), type: 'consumption' })
        .sort({ createdAt: 1 })
        .lean();
      expect(consumptionMovements).toHaveLength(2);
      expect(consumptionMovements[1]).toMatchObject({
        quantity_delta: -2,
      });
    });

    it('reversing to a lower quantity returns the difference to stock', async () => {
      const workOrder = await createWorkOrder();
      const { stock, part } = await createStockViaApi(10);
      const created = await request(app.getHttpServer())
        .post('/ot-pieces')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ot_id: workOrder._id.toString(),
          part_id: part._id.toString(),
          quantite: 5,
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/ot-pieces/${created.body._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantite: 2 })
        .expect(200);

      const updatedStock = await stocks.findById(stock._id).lean();
      expect(updatedStock?.quantite_en_stock).toBe(8);
    });

    it('reassigning to a different part reverses the old stock and applies the new stock atomically', async () => {
      const workOrder = await createWorkOrder();
      const { stock: oldStock, part: oldPart } = await createStockViaApi(10);
      const { stock: newStock, part: newPart } = await createStockViaApi(10);

      const created = await request(app.getHttpServer())
        .post('/ot-pieces')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ot_id: workOrder._id.toString(),
          part_id: oldPart._id.toString(),
          quantite: 4,
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/ot-pieces/${created.body._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ part_id: newPart._id.toString(), quantite: 6 })
        .expect(200);

      const finalOldStock = await stocks.findById(oldStock._id).lean();
      const finalNewStock = await stocks.findById(newStock._id).lean();
      expect(finalOldStock?.quantite_en_stock).toBe(10); // fully returned
      expect(finalNewStock?.quantite_en_stock).toBe(4); // 10 - 6 consumed
    });

    // The regression test this fix exists for: before, a failure anywhere
    // in this sequence would leave OTPieces and Stock permanently
    // desynced. Reassigning to a part with no Stock record forces the
    // second half of the transaction to throw after the first half (the
    // reversal against the old part) has already run in-transaction —
    // proving the whole operation rolls back together, not partially.
    it('rolls back the old part reversal too when the new part has no stock record', async () => {
      const workOrder = await createWorkOrder();
      const { stock: oldStock, part: oldPart } = await createStockViaApi(10);
      const orphanPart = await catalogues.create({
        part_id: `PART-OTP-ORPHAN-REASSIGN-${Date.now()}`,
        nom_piece: 'Unstocked replacement part',
        ref_constructeur: 'NS-2',
      });

      const created = await request(app.getHttpServer())
        .post('/ot-pieces')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ot_id: workOrder._id.toString(),
          part_id: oldPart._id.toString(),
          quantite: 4,
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/ot-pieces/${created.body._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ part_id: orphanPart._id.toString(), quantite: 6 })
        .expect(404);

      const unchangedOldStock = await stocks.findById(oldStock._id).lean();
      expect(unchangedOldStock?.quantite_en_stock).toBe(6); // reversal rolled back

      const unchangedRecord = await otPieces.findById(created.body._id).lean();
      expect(unchangedRecord).toMatchObject({
        part_id: oid(oldPart._id.toString()),
        quantite: 4,
      });

      const consumptionMovements = await stockMovements
        .find({ stock_id: oid(oldStock._id), type: 'consumption' })
        .lean();
      // Only the original creation's consumption movement — the failed
      // reassignment attempt wrote no movement of its own.
      expect(consumptionMovements).toHaveLength(1);
    });
  });

  describe('remove', () => {
    it('returns the consumed quantity to stock and deletes the record', async () => {
      const workOrder = await createWorkOrder();
      const { stock, part } = await createStockViaApi(10);
      const created = await request(app.getHttpServer())
        .post('/ot-pieces')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ot_id: workOrder._id.toString(),
          part_id: part._id.toString(),
          quantite: 4,
        })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/ot-pieces/${created.body._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const updatedStock = await stocks.findById(stock._id).lean();
      expect(updatedStock?.quantite_en_stock).toBe(10);

      const remaining = await otPieces.findById(created.body._id).lean();
      expect(remaining).toBeNull();
    });

    it('returns 200 for an id that does not exist, without error', async () => {
      const missingId = new Types.ObjectId().toString();
      const response = await request(app.getHttpServer())
        .delete(`/ot-pieces/${missingId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      // A `null` controller return serializes as an empty body (parsed by
      // supertest as `{}`, not the literal JS value `null`) — what matters
      // is that no document fields came back, proving nothing was found
      // or written for an id that doesn't exist.
      expect(response.body).not.toHaveProperty('_id');
    });
  });
});
