/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
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
import {
  InterventionReport,
  InterventionReportDocument,
} from '../src/schemas/intervention-report.schema';

describe('Operator corrective report workflow (e2e)', () => {
  let replSet: MongoMemoryReplSet;
  let app: INestApplication<App>;
  let jwtService: JwtService;
  let connection: Connection;
  let users: Model<UserDocument>;
  let machineTypes: Model<MachineTypeDocument>;
  let machines: Model<MachineDocument>;
  let workOrders: Model<WorkOrderDocument>;
  let reports: Model<InterventionReportDocument>;
  let operatorToken: string;
  let machine: MachineDocument;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = replSet.getUri('gmao_operator_corrective_e2e');
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
    reports = app.get(getModelToken(InterventionReport.name));

    const machineType = await machineTypes.create({
      type_id: 100,
      name: 'Corrective E2E machine type',
    });
    machine = await machines.create({
      machine_id: 'CORRECTIVE-E2E-MACHINE',
      type_id: machineType._id,
      serial_no: 'COR-E2E-001',
      status: 'active',
    });
    const operator = await users.create({
      user_id: 'OP-CORRECTIVE-E2E',
      nom_complet: 'Corrective Operator',
      email: 'corrective-operator-e2e@example.test',
      password: 'x',
      role: 'operator',
      is_active: true,
      is_verified: true,
      assigned_machine_ids: [machine._id],
    });
    operatorToken = jwtService.sign({
      sub: operator._id.toString(),
      email: operator.email,
      role: operator.role,
      user_id: operator.user_id,
    });
  }, 180_000);

  afterAll(async () => {
    await connection?.dropDatabase();
    await app?.close();
    await replSet?.stop();
  });

  it('creates a corrective work order and report from required visible fields without requiring a photo', async () => {
    const codePanne = `COR-E2E-${Date.now()}`;

    const response = await request(app.getHttpServer())
      .post('/operator/report-problem')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        machine_id: machine._id.toString(),
        code_panne: codePanne,
        fault_description: 'Operator selected solved in the corrective form',
        actions: ['Solved'],
        priority: 'high',
      })
      .expect(201);

    expect(response.body.duplicate).toBe(false);
    expect(response.body.workOrder).toEqual(
      expect.objectContaining({
        machine_id: machine._id.toString(),
        code_panne: codePanne,
        type_maintenance: 'corrective',
        status: 'waiting_validation',
      }),
    );
    expect(response.body.report).toEqual(
      expect.objectContaining({
        description_action: 'Solved',
        validation_responsable: 'waiting_validation',
      }),
    );
    await expect(workOrders.countDocuments({ code_panne: codePanne })).resolves.toBe(1);
    await expect(reports.countDocuments({ description_action: 'Solved' })).resolves.toBe(1);
  });

  it('rejects empty actions and missing fault code with the same required-field contract as the frontend', async () => {
    await request(app.getHttpServer())
      .post('/operator/report-problem')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        machine_id: machine._id.toString(),
        code_panne: `COR-E2E-${Date.now()}`,
        actions: ['   ', ''],
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/operator/report-problem')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        machine_id: machine._id.toString(),
        actions: ['Solved'],
      })
      .expect(400);
  });
});
