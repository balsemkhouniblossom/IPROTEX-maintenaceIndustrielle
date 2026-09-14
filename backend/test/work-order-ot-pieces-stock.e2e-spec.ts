import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { Catalogue, CatalogueDocument } from '../src/schemas/catalogue.schema';
import { Machine, MachineDocument } from '../src/schemas/machine.schema';
import { MachineType, MachineTypeDocument } from '../src/schemas/machine-type.schema';
import { Stock, StockDocument } from '../src/schemas/stock.schema';
import { User, UserDocument } from '../src/schemas/user.schema';

/**
 * Executable example of the complete Admin Work Order -> OT Piece -> Stock
 * lifecycle. It proves that OT Pieces never act as a disconnected list:
 * recording usage consumes live stock, and deleting that usage returns it.
 */
describe('Maintenance Work Order with OT Pieces and live Stock (e2e)', () => {
  let mongo: MongoMemoryReplSet;
  let app: INestApplication<App>;
  let connection: Connection;
  let jwt: JwtService;
  let catalogues: Model<CatalogueDocument>;
  let stocks: Model<StockDocument>;
  let machineTypes: Model<MachineTypeDocument>;
  let machines: Model<MachineDocument>;
  let users: Model<UserDocument>;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      instanceOpts: [{ launchTimeout: 60_000 }],
    });
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongo.getUri('gmao_ot_piece_stock_example');
    process.env.JWT_SECRET = 'ot-piece-example-jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'ot-piece-example-refresh-secret';
    process.env.EMAIL_VERIFICATION_SECRET = 'ot-piece-example-email-secret';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    connection = app.get(getConnectionToken());
    jwt = app.get(JwtService);
    catalogues = app.get(getModelToken(Catalogue.name));
    stocks = app.get(getModelToken(Stock.name));
    machineTypes = app.get(getModelToken(MachineType.name));
    machines = app.get(getModelToken(Machine.name));
    users = app.get(getModelToken(User.name));
  }, 120_000);

  afterAll(async () => {
    await connection?.dropDatabase();
    await app?.close();
    await mongo?.stop();
  });

  it('creates a work order and test stock item, consumes 3 units through an OT Piece, then restores them', async () => {
    const machineType = await machineTypes.create({ type_id: 750102, name: 'Braiding test machine' });
    const machine = await machines.create({ machine_id: 'BRAID-TEST-01', type_id: machineType._id, serial_no: 'BRAID-TEST-SN', status: 'active' });
    const admin = await users.create({ user_id: 'ADMIN-OT-PIECE-TEST', nom_complet: 'Inventory Test Admin', email: 'inventory-test-admin@example.test', password: 'x', role: 'admin', is_active: true, is_verified: true });
    const technician = await users.create({ user_id: 'TECH-OT-PIECE-TEST', nom_complet: 'Inventory Test Technician', email: 'inventory-test-technician@example.test', password: 'x', role: 'technician', is_active: true, is_verified: true });
    const token = jwt.sign({ sub: admin._id.toString(), email: admin.email, role: admin.role, user_id: admin.user_id });

    const catalogueResponse = await request(app.getHttpServer())
      .post('/catalogues').set('Authorization', `Bearer ${token}`)
      .send({ part_id: 'TEST-BEARING-6203', nom_piece: 'Test drive bearing 6203', ref_constructeur: 'SKF-6203-2Z', fabricant: 'SKF', categorie_piece: 'Bearings' })
      .expect(201);
    const partId = catalogueResponse.body._id as string;

    await request(app.getHttpServer())
      .post('/stocks').set('Authorization', `Bearer ${token}`)
      .send({ stock_id: 'STK-TEST-BEARING-6203', part_id: partId, quantite_en_stock: 10, seuil_alerte_stock: 2, quantite_minimale: 2, emplacement: 'Test shelf A1' })
      .expect(201);

    const workOrderResponse = await request(app.getHttpServer())
      .post('/work-orders').set('Authorization', `Bearer ${token}`)
      .send({ ot_id: 'WO-STOCK-EXAMPLE-001', machine_id: machine._id.toString(), technician_id: technician._id.toString(), description: 'Replace the test drive bearing', type_maintenance: 'corrective', status: 'in_progress', priorite: 'medium', date_created: '2026-09-14T08:00:00.000Z', date_start: '2026-09-14T08:00:00.000Z' })
      .expect(201);
    const workOrderId = workOrderResponse.body._id as string;

    const otPieceResponse = await request(app.getHttpServer())
      .post('/ot-pieces').set('Authorization', `Bearer ${token}`)
      .send({ ot_id: workOrderId, part_id: partId, quantite: 3 })
      .expect(201);

    expect(await stocks.findOne({ stock_id: 'STK-TEST-BEARING-6203' }).lean()).toMatchObject({ quantite_en_stock: 7, quantite_reservee: 0 });

    await request(app.getHttpServer())
      .delete(`/ot-pieces/${otPieceResponse.body._id as string}`).set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(await stocks.findOne({ stock_id: 'STK-TEST-BEARING-6203' }).lean()).toMatchObject({ quantite_en_stock: 10, quantite_reservee: 0 });
    expect(await catalogues.findOne({ part_id: 'TEST-BEARING-6203' }).lean()).toMatchObject({ nom_piece: 'Test drive bearing 6203' });
  });
});
