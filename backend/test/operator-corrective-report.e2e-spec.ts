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
import { WorkOrder, WorkOrderDocument } from '../src/schemas/work-order.schema';
import {
  InterventionReport,
  InterventionReportDocument,
} from '../src/schemas/intervention-report.schema';

describe('Operator corrective report creation (e2e)', () => {
  let mongo: MongoMemoryReplSet;
  let app: INestApplication<App>;
  let jwtService: JwtService;
  let connection: Connection;
  let users: Model<UserDocument>;
  let machineTypes: Model<MachineTypeDocument>;
  let machines: Model<MachineDocument>;
  let workOrders: Model<WorkOrderDocument>;
  let reports: Model<InterventionReportDocument>;

  let operatorToken: string;
  let technicianToken: string;
  let assignedMachine: MachineDocument;
  let unassignedMachine: MachineDocument;
  let operator: UserDocument;

  beforeAll(async () => {
    // A single-node replica set (not a plain standalone MongoMemoryServer) is
    // required here: the endpoint under test relies on a real multi-document
    // transaction, which standalone MongoDB does not support.
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongo.getUri('gmao_corrective_report_e2e');
    process.env.JWT_SECRET = 'e2e-test-jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'e2e-test-refresh-secret';
    process.env.EMAIL_VERIFICATION_SECRET = 'e2e-test-email-secret';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirrors backend/src/main.ts's bootstrap(): TestingModule does not run
    // that imperative bootstrap, so the production global pipe/filter have
    // to be applied here for the test to exercise the same request handling.
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
      name: 'Corrective E2E machine type',
    });
    assignedMachine = await machines.create({
      machine_id: 'MACHINE-ASSIGNED',
      type_id: machineType._id,
      serial_no: 'ASSIGNED-001',
      status: 'active',
    });
    unassignedMachine = await machines.create({
      machine_id: 'MACHINE-UNASSIGNED',
      type_id: machineType._id,
      serial_no: 'UNASSIGNED-001',
      status: 'active',
    });

    operator = await users.create({
      user_id: 'OP-CORRECTIVE-E2E',
      nom_complet: 'Corrective Operator',
      email: 'corrective-operator-e2e@example.test',
      password: 'x',
      role: 'operator',
      is_active: true,
      is_verified: true,
      assigned_machine_ids: [assignedMachine._id],
    });
    const technician = await users.create({
      user_id: 'TECH-CORRECTIVE-E2E',
      nom_complet: 'Corrective Technician',
      email: 'corrective-technician-e2e@example.test',
      password: 'x',
      role: 'technician',
      is_active: true,
      is_verified: true,
    });

    operatorToken = tokenFor(operator);
    technicianToken = tokenFor(technician);
  }

  it('rejects an anonymous request', async () => {
    await request(app.getHttpServer())
      .post('/operator/report-problem')
      .send({
        machine_id: assignedMachine._id.toString(),
        code_panne: 'FAULT-ANON',
        actions: ['Reset breaker'],
      })
      .expect(401);
  });

  it('rejects a technician (Operator-only endpoint)', async () => {
    await request(app.getHttpServer())
      .post('/operator/report-problem')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({
        machine_id: assignedMachine._id.toString(),
        code_panne: 'FAULT-ROLE',
        actions: ['Reset breaker'],
      })
      .expect(403);
  });

  it('rejects a machine that is not assigned to the Operator, without creating any record', async () => {
    await request(app.getHttpServer())
      .post('/operator/report-problem')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        machine_id: unassignedMachine._id.toString(),
        code_panne: 'FAULT-UNASSIGNED',
        actions: ['Reset breaker'],
      })
      .expect(403);

    expect(
      await workOrders.countDocuments({ machine_id: unassignedMachine._id }),
    ).toBe(0);
  });

  it('rejects a request that tries to smuggle a client-supplied technician/author id', async () => {
    const response = await request(app.getHttpServer())
      .post('/operator/report-problem')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        machine_id: assignedMachine._id.toString(),
        code_panne: 'FAULT-FORGED',
        actions: ['Reset breaker'],
        technician_id: '000000000000000000000000',
      })
      .expect(400);

    expect(response.body.message).toBeDefined();
    expect(
      await workOrders.countDocuments({ code_panne: 'FAULT-FORGED' }),
    ).toBe(0);
  });

  it('rejects missing required fields', async () => {
    await request(app.getHttpServer())
      .post('/operator/report-problem')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        machine_id: assignedMachine._id.toString(),
        code_panne: 'FAULT-NO-ACTIONS',
        actions: [],
      })
      .expect(400);
  });

  it('creates a corrective work order and its initial intervention report as one reliable operation', async () => {
    const response = await request(app.getHttpServer())
      .post('/operator/report-problem')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        machine_id: assignedMachine._id.toString(),
        code_panne: 'FAULT-MAIN',
        fault_description: 'Motor overheating',
        actions: ['Reset breaker', 'Inspect wiring'],
      })
      .expect(201);

    expect(response.body.duplicate).toBe(false);
    const workOrderId = response.body.workOrder._id as string;
    const reportId = response.body.report._id as string;

    const storedOrder = await workOrders.findById(workOrderId);
    expect(storedOrder?.machine_id.toString()).toBe(
      assignedMachine._id.toString(),
    );
    expect(storedOrder?.technician_id?.toString()).toBe(
      operator._id.toString(),
    );
    expect(storedOrder?.type_maintenance).toBe('corrective');
    expect(storedOrder?.status).toBe('waiting_validation');
    expect(storedOrder?.code_panne).toBe('FAULT-MAIN');

    const storedReport = await reports.findById(reportId);
    expect(storedReport?.ot_id.toString()).toBe(workOrderId);
    expect(storedReport?.technician_id?.toString()).toBe(
      operator._id.toString(),
    );
    expect(storedReport?.cause_racine).toBe('Motor overheating');
    expect(storedReport?.description_action).toBe(
      'Reset breaker | Inspect wiring',
    );
  });

  it('treats an immediate resubmission of the same fault as a duplicate instead of creating a second record', async () => {
    const before = await workOrders.countDocuments({
      machine_id: assignedMachine._id,
      code_panne: 'FAULT-MAIN',
    });

    const response = await request(app.getHttpServer())
      .post('/operator/report-problem')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        machine_id: assignedMachine._id.toString(),
        code_panne: 'FAULT-MAIN',
        fault_description: 'Motor overheating',
        actions: ['Reset breaker', 'Inspect wiring'],
      })
      .expect(201);

    expect(response.body.duplicate).toBe(true);

    const after = await workOrders.countDocuments({
      machine_id: assignedMachine._id,
      code_panne: 'FAULT-MAIN',
    });
    expect(after).toBe(before);
    expect(
      await reports.countDocuments({
        ot_id: new Types.ObjectId(response.body.workOrder._id as string),
      }),
    ).toBe(1);
  });

  it('rolls back the work order when the intervention report write fails, leaving no partial record', async () => {
    const createSpy = jest
      .spyOn(reports, 'create')
      .mockRejectedValueOnce(new Error('simulated report insert failure'));

    await request(app.getHttpServer())
      .post('/operator/report-problem')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        machine_id: assignedMachine._id.toString(),
        code_panne: 'FAULT-ROLLBACK',
        actions: ['Reset breaker'],
      })
      .expect(500);

    expect(
      await workOrders.countDocuments({ code_panne: 'FAULT-ROLLBACK' }),
    ).toBe(0);
    expect(
      await reports.countDocuments({ description_action: 'Reset breaker' }),
    ).toBe(0);

    createSpy.mockRestore();

    await request(app.getHttpServer())
      .post('/operator/report-problem')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        machine_id: assignedMachine._id.toString(),
        code_panne: 'FAULT-ROLLBACK',
        actions: ['Reset breaker'],
      })
      .expect(201);

    expect(
      await workOrders.countDocuments({ code_panne: 'FAULT-ROLLBACK' }),
    ).toBe(1);
  });
});
