import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { MongoMemoryServer } from 'mongodb-memory-server';
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
import { WorkOrder, WorkOrderDocument } from '../src/schemas/work-order.schema';
import { Catalogue, CatalogueDocument } from '../src/schemas/catalogue.schema';
import { Stock, StockDocument } from '../src/schemas/stock.schema';
import {
  PartRequest,
  PartRequestDocument,
} from '../src/schemas/part-request.schema';

describe('Operator parts request (e2e)', () => {
  // A plain standalone MongoMemoryServer is sufficient here: unlike the
  // corrective-report and preventive-submission endpoints, this one never
  // opens a multi-document transaction (it is a single, isolated insert),
  // so it doesn't require a replica set.
  let mongo: MongoMemoryServer;
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
  let partRequests: Model<PartRequestDocument>;

  let operatorToken: string;
  let otherOperatorToken: string;
  let technicianToken: string;
  let operator: UserDocument;
  let otherOperator: UserDocument;
  let machine: MachineDocument;
  let moduleEntity: ModuleDocument;
  let part: CatalogueDocument;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongo.getUri('gmao_part_request_e2e');
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
    partRequests = app.get(getModelToken(PartRequest.name));

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
      name: 'Part request E2E machine type',
    });
    const moduleType = await moduleTypes.create({
      mod_type_id: 'MODTYPE-PART-REQ-E2E',
      type_id: machineType._id,
      nom_module: 'Part request E2E module type',
    });
    machine = await machines.create({
      machine_id: 'MACHINE-PART-REQ',
      type_id: machineType._id,
      serial_no: 'PART-REQ-001',
      status: 'active',
    });
    moduleEntity = await modules.create({
      module_id: 'MODULE-PART-REQ',
      machine_id: machine._id,
      mod_type_id: moduleType._id,
    });
    part = await catalogues.create({
      part_id: 'PART-REQ-CATALOGUE',
      nom_piece: 'Drive belt',
      ref_constructeur: 'DB-100',
    });

    operator = await users.create({
      user_id: 'OP-PART-REQ-E2E',
      nom_complet: 'Part Request Operator',
      email: 'part-request-operator-e2e@example.test',
      password: 'x',
      role: 'operator',
      is_active: true,
      is_verified: true,
      assigned_machine_ids: [machine._id],
    });
    otherOperator = await users.create({
      user_id: 'OP-PART-REQ-OTHER-E2E',
      nom_complet: 'Other Part Request Operator',
      email: 'part-request-other-operator-e2e@example.test',
      password: 'x',
      role: 'operator',
      is_active: true,
      is_verified: true,
      assigned_machine_ids: [machine._id],
    });
    const technician = await users.create({
      user_id: 'TECH-PART-REQ-E2E',
      nom_complet: 'Part Request Technician',
      email: 'part-request-technician-e2e@example.test',
      password: 'x',
      role: 'technician',
      is_active: true,
      is_verified: true,
    });

    operatorToken = tokenFor(operator);
    otherOperatorToken = tokenFor(otherOperator);
    technicianToken = tokenFor(technician);
  }

  async function createCorrectiveWorkOrder(
    overrides: Record<string, unknown> = {},
  ) {
    return workOrders.create({
      ot_id: `WO-COR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      machine_id: machine._id,
      module_id: moduleEntity._id,
      technician_id: operator._id,
      description: 'Motor overheating',
      type_maintenance: 'corrective',
      status: 'waiting_validation',
      priorite: 'high',
      code_panne: 'FAULT-PART-REQ',
      date_created: new Date('2026-07-14T08:00:00.000Z'),
      date_start: new Date('2026-07-14T08:00:00.000Z'),
      ...overrides,
    });
  }

  it('rejects an anonymous request', async () => {
    const workOrder = await createCorrectiveWorkOrder();

    await request(app.getHttpServer())
      .post(`/operator/work-orders/${workOrder._id.toString()}/parts-request`)
      .send({ part_id: part._id.toString(), quantity: 2 })
      .expect(401);
  });

  it('rejects a technician (Operator-only endpoint)', async () => {
    const workOrder = await createCorrectiveWorkOrder();

    await request(app.getHttpServer())
      .post(`/operator/work-orders/${workOrder._id.toString()}/parts-request`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ part_id: part._id.toString(), quantity: 2 })
      .expect(403);
  });

  it('rejects a request that tries to smuggle a client-supplied requester, status, stock, or approval field', async () => {
    const workOrder = await createCorrectiveWorkOrder();

    await request(app.getHttpServer())
      .post(`/operator/work-orders/${workOrder._id.toString()}/parts-request`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        part_id: part._id.toString(),
        quantity: 2,
        requested_by: '000000000000000000000000',
        status: 'approved',
        quantite_en_stock: 999,
        approved_by: '000000000000000000000000',
        approved_at: '2026-01-01T00:00:00.000Z',
      })
      .expect(400);

    expect(await partRequests.countDocuments({ ot_id: workOrder._id })).toBe(0);
  });

  it('rejects a machine not assigned to the Operator', async () => {
    const unassignedMachine = await machines.create({
      machine_id: `MACHINE-UNASSIGNED-${Date.now()}`,
      type_id: machine.type_id,
      serial_no: `UNASSIGNED-${Date.now()}`,
      status: 'active',
    });
    const unassignedModule = await modules.create({
      module_id: `MODULE-UNASSIGNED-${Date.now()}`,
      machine_id: unassignedMachine._id,
      mod_type_id: moduleEntity.mod_type_id,
    });
    const workOrder = await createCorrectiveWorkOrder({
      machine_id: unassignedMachine._id,
      module_id: unassignedModule._id,
      technician_id: otherOperator._id,
    });

    await request(app.getHttpServer())
      .post(`/operator/work-orders/${workOrder._id.toString()}/parts-request`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ part_id: part._id.toString(), quantity: 2 })
      .expect(403);
  });

  it('rejects a work order assigned to a different operator on the same machine (ownership, not just machine assignment)', async () => {
    const workOrder = await createCorrectiveWorkOrder({
      technician_id: otherOperator._id,
    });

    await request(app.getHttpServer())
      .post(`/operator/work-orders/${workOrder._id.toString()}/parts-request`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ part_id: part._id.toString(), quantity: 2 })
      .expect(403);
  });

  it('rejects a non-corrective work order', async () => {
    const workOrder = await createCorrectiveWorkOrder({
      type_maintenance: 'preventive',
    });

    await request(app.getHttpServer())
      .post(`/operator/work-orders/${workOrder._id.toString()}/parts-request`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ part_id: part._id.toString(), quantity: 2 })
      .expect(400);
  });

  it('rejects a request against a closed corrective work order', async () => {
    const workOrder = await createCorrectiveWorkOrder({ status: 'completed' });

    await request(app.getHttpServer())
      .post(`/operator/work-orders/${workOrder._id.toString()}/parts-request`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ part_id: part._id.toString(), quantity: 2 })
      .expect(409);
  });

  it('rejects a request for a part that does not exist', async () => {
    const workOrder = await createCorrectiveWorkOrder();
    const bogusPartId = machine._id.toString();

    await request(app.getHttpServer())
      .post(`/operator/work-orders/${workOrder._id.toString()}/parts-request`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ part_id: bogusPartId, quantity: 2 })
      .expect(404);
  });

  it('rejects an invalid quantity', async () => {
    const workOrder = await createCorrectiveWorkOrder();

    await request(app.getHttpServer())
      .post(`/operator/work-orders/${workOrder._id.toString()}/parts-request`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ part_id: part._id.toString(), quantity: 0 })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/operator/work-orders/${workOrder._id.toString()}/parts-request`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ part_id: part._id.toString(), quantity: -1 })
      .expect(400);
  });

  it('stores a pending request without mutating Stock in any way', async () => {
    const workOrder = await createCorrectiveWorkOrder();
    const stock = await stocks.create({
      stock_id: `STOCK-PART-REQ-${Date.now()}`,
      part_id: part._id,
      quantite_en_stock: 25,
    });

    const response = await request(app.getHttpServer())
      .post(`/operator/work-orders/${workOrder._id.toString()}/parts-request`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ part_id: part._id.toString(), quantity: 4 })
      .expect(201);

    expect(response.body.status).toBe('pending');
    expect(response.body.ot_id).toBe(workOrder._id.toString());
    expect(response.body.part_id).toBe(part._id.toString());
    expect(response.body.quantity).toBe(4);
    expect(response.body.requested_by).toBe(operator._id.toString());

    const storedRequest = await partRequests.findById(response.body._id);
    expect(storedRequest?.status).toBe('pending');
    expect(storedRequest?.requested_by.toString()).toBe(
      operator._id.toString(),
    );

    // Direct proof of "without directly reducing stock": the previously
    // seeded stock quantity is completely untouched by this call.
    const stockAfter = await stocks.findById(stock._id);
    expect(stockAfter?.quantite_en_stock).toBe(25);
  });

  it('rejects a duplicate active request for the same work order and part, and creates no second record', async () => {
    const workOrder = await createCorrectiveWorkOrder();

    await request(app.getHttpServer())
      .post(`/operator/work-orders/${workOrder._id.toString()}/parts-request`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ part_id: part._id.toString(), quantity: 3 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/operator/work-orders/${workOrder._id.toString()}/parts-request`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ part_id: part._id.toString(), quantity: 5 })
      .expect(409);

    expect(
      await partRequests.countDocuments({
        ot_id: workOrder._id,
        part_id: part._id,
      }),
    ).toBe(1);
  });

  it('allows a request for a different part on the same work order (dedup is scoped per part, not per work order)', async () => {
    const workOrder = await createCorrectiveWorkOrder();
    const otherPart = await catalogues.create({
      part_id: `PART-REQ-OTHER-${Date.now()}`,
      nom_piece: 'Filter',
      ref_constructeur: 'F-200',
    });

    await request(app.getHttpServer())
      .post(`/operator/work-orders/${workOrder._id.toString()}/parts-request`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ part_id: part._id.toString(), quantity: 1 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/operator/work-orders/${workOrder._id.toString()}/parts-request`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ part_id: otherPart._id.toString(), quantity: 1 })
      .expect(201);

    expect(await partRequests.countDocuments({ ot_id: workOrder._id })).toBe(2);
  });
});
