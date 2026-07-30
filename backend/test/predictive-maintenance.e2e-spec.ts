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
import { MachineType, MachineTypeDocument } from '../src/schemas/machine-type.schema';
import { Machine, MachineDocument } from '../src/schemas/machine.schema';
import { Module as ModuleEntity, ModuleDocument } from '../src/schemas/module.schema';
import { MaintenancePlan, MaintenancePlanDocument } from '../src/schemas/maintenance-plan.schema';
import { FaultEvent, FaultEventDocument, FaultEventSeverity } from '../src/schemas/fault-event.schema';
import { WorkOrder, WorkOrderDocument } from '../src/schemas/work-order.schema';
import {
  PREDICTION_MODELS,
  PredictionModel,
  PredictionModelType,
  ModelArtifact,
  TrainingSample,
} from '../src/predictive-maintenance/prediction-model.interface';

/**
 * Deterministic stand-in for every real model (Isolation Forest, DBSCAN,
 * Autoencoder, Z-score) — the feature requires "mocked-model integration
 * tests" explicitly, so this suite exercises the full pipeline (training,
 * versioning, role-scoped inference, fleet/plan summaries, advisory-only
 * behavior) without depending on the real algorithms' numerical output.
 */
class FakeModel implements PredictionModel {
  readonly type = PredictionModelType.ZSCORE;
  readonly displayName = 'Fake Test Model';
  public forcedAnomalyScore = 0.1;
  public forcedConfidence = 0.75;

  train(samples: TrainingSample[], randomSeed: number): ModelArtifact {
    return {
      featureNames: [],
      trainingSampleCount: samples.length,
      randomSeed,
      trainedAt: new Date().toISOString(),
    };
  }

  score() {
    return {
      anomalyScore: this.forcedAnomalyScore,
      confidence: this.forcedConfidence,
      modelNotes: ['Fake model deterministic note.'],
    };
  }
}

describe('Predictive Maintenance — mocked model (e2e)', () => {
  let mongo: MongoMemoryReplSet;
  let app: INestApplication<App>;
  let jwtService: JwtService;
  let connection: Connection;
  let users: Model<UserDocument>;
  let machineTypes: Model<MachineTypeDocument>;
  let machines: Model<MachineDocument>;
  let modules: Model<ModuleDocument>;
  let maintenancePlans: Model<MaintenancePlanDocument>;
  let faultEvents: Model<FaultEventDocument>;
  let workOrders: Model<WorkOrderDocument>;
  let fakeModel: FakeModel;

  let adminToken: string;
  let operatorToken: string;
  let otherOperatorToken: string;
  let technicianToken: string;
  let assignedMachineId: string;
  let unassignedMachineId: string;
  let planId: string;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongo.getUri('gmao_predictive_maintenance_e2e');
    process.env.JWT_SECRET = 'e2e-test-jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'e2e-test-refresh-secret';
    process.env.EMAIL_VERIFICATION_SECRET = 'e2e-test-email-secret';

    fakeModel = new FakeModel();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PREDICTION_MODELS)
      .useValue([fakeModel])
      .compile();

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
    modules = app.get(getModelToken(ModuleEntity.name));
    maintenancePlans = app.get(getModelToken(MaintenancePlan.name));
    faultEvents = app.get(getModelToken(FaultEvent.name));
    workOrders = app.get(getModelToken(WorkOrder.name));

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
      name: 'Predictive Maintenance E2E machine type',
    });

    const assignedMachine = await machines.create({
      machine_id: 'MACHINE-PM-1',
      type_id: machineType._id,
      serial_no: 'PM-001',
      status: 'active',
    });
    assignedMachineId = assignedMachine._id.toString();

    const unassignedMachine = await machines.create({
      machine_id: 'MACHINE-PM-2',
      type_id: machineType._id,
      serial_no: 'PM-002',
      status: 'active',
    });
    unassignedMachineId = unassignedMachine._id.toString();

    const module = await modules.create({
      module_id: 'MODULE-PM-1',
      machine_id: assignedMachine._id,
      mod_type_id: new Types.ObjectId(),
    });

    const plan = await maintenancePlans.create({
      plan_id: 'PLAN-PM-1',
      module_id: module._id,
      type_maintenance: 'preventive',
      frequence: 30,
      unite_frequence: 'days',
      status: 'active',
    });
    planId = plan._id.toString();

    await faultEvents.create({
      device_id: new Types.ObjectId(),
      machine_id: assignedMachine._id,
      code_panne: 'E-99',
      severity: FaultEventSeverity.WARNING,
      raised_at: new Date(),
    });

    const admin = await users.create({
      user_id: 'ADMIN-PM-E2E',
      nom_complet: 'PM Admin',
      email: 'pm-admin-e2e@example.test',
      password: 'x',
      role: 'admin',
      is_active: true,
      is_verified: true,
    });
    const operator = await users.create({
      user_id: 'OP-PM-E2E',
      nom_complet: 'PM Operator',
      email: 'pm-operator-e2e@example.test',
      password: 'x',
      role: 'operator',
      is_active: true,
      is_verified: true,
      assigned_machine_ids: [assignedMachine._id],
    });
    const otherOperator = await users.create({
      user_id: 'OP2-PM-E2E',
      nom_complet: 'Other PM Operator',
      email: 'pm-operator2-e2e@example.test',
      password: 'x',
      role: 'operator',
      is_active: true,
      is_verified: true,
      // Non-empty and deliberately excludes unassignedMachine: an empty list
      // now defaults to full visibility, so this must narrow explicitly to
      // still exercise "operator scoped away from a specific machine".
      assigned_machine_ids: [assignedMachine._id],
    });
    const technician = await users.create({
      user_id: 'TECH-PM-E2E',
      nom_complet: 'PM Technician',
      email: 'pm-technician-e2e@example.test',
      password: 'x',
      role: 'technician',
      is_active: true,
      is_verified: true,
      assigned_machine_ids: [assignedMachine._id],
    });

    // DocumentAccessService's technician scoping requires an actual WorkOrder
    // tie to the machine (assigned_machine_ids alone isn't sufficient for
    // Technician the way it is for Operator) — this also feeds realistic
    // corrective_work_order_count data into the feature vector.
    await workOrders.create({
      ot_id: 'OT-PM-E2E-1',
      machine_id: assignedMachine._id,
      technician_id: technician._id,
      type_maintenance: 'corrective',
      status: 'in_progress',
      date_created: new Date(),
    });

    adminToken = tokenFor(admin);
    operatorToken = tokenFor(operator);
    otherOperatorToken = tokenFor(otherOperator);
    technicianToken = tokenFor(technician);
  }

  it('rejects an unauthenticated request', async () => {
    await request(app.getHttpServer()).get('/predictive-maintenance/fleet-summary').expect(401);
  });

  it('rejects non-Admin roles from training a model', async () => {
    await request(app.getHttpServer())
      .post('/predictive-maintenance/models/zscore/train')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(403);
  });

  it('rejects an unknown model type', async () => {
    await request(app.getHttpServer())
      .post('/predictive-maintenance/models/not-a-real-model/train')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  it('Admin trains model version 1 using the mocked model', async () => {
    const response = await request(app.getHttpServer())
      .post('/predictive-maintenance/models/zscore/train')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    expect(response.body.model_type).toBe('zscore');
    expect(response.body.version).toBe(1);
    expect(response.body.status).toBe('active');
  });

  it('rejects a refresh for a machine the caller cannot access', async () => {
    await request(app.getHttpServer())
      .post(`/predictive-maintenance/machines/${unassignedMachineId}/refresh`)
      .set('Authorization', `Bearer ${otherOperatorToken}`)
      .expect(403);
  });

  it('runs a prediction for an accessible machine and never mutates the machine record itself', async () => {
    const response = await request(app.getHttpServer())
      .post(`/predictive-maintenance/machines/${assignedMachineId}/refresh`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(201);

    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toHaveLength(1);
    const [prediction] = response.body;
    expect(prediction.model_type).toBe('zscore');
    expect(prediction.health_score).toBeCloseTo(90, 5); // 100 * (1 - 0.1)
    expect(prediction.anomaly_score).toBeCloseTo(0.1, 5);

    const machine = await machines.findById(assignedMachineId).exec();
    expect(machine?.status).toBe('active');
  });

  it('separates measured facts, model output notes, and uncertainty notes in the explanation', async () => {
    const response = await request(app.getHttpServer())
      .get(`/predictive-maintenance/machines/${assignedMachineId}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .expect(200);

    expect(response.body).toHaveLength(1);
    const explanation = response.body[0].explanation;
    expect(explanation.measuredFacts.some((f: string) => f.includes('alarm'))).toBe(true);
    expect(explanation.modelOutputNotes.some((n: string) => n.includes('Fake model deterministic note'))).toBe(
      true,
    );
    expect(explanation.uncertaintyNotes.some((n: string) => n.toLowerCase().includes('advisory'))).toBe(true);
  });

  it('records prediction history for the machine', async () => {
    const response = await request(app.getHttpServer())
      .get(`/predictive-maintenance/machines/${assignedMachineId}/history`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.length).toBeGreaterThanOrEqual(1);
  });

  it('scopes the fleet summary to the caller’s accessible machines', async () => {
    const operatorSummary = await request(app.getHttpServer())
      .get('/predictive-maintenance/fleet-summary')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);

    expect(operatorSummary.body.map((s: { machineId: string }) => s.machineId)).toEqual([assignedMachineId]);

    const adminSummary = await request(app.getHttpServer())
      .get('/predictive-maintenance/fleet-summary')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const adminMachineIds = adminSummary.body.map((s: { machineId: string }) => s.machineId);
    expect(adminMachineIds).toContain(assignedMachineId);
  });

  it('resolves the maintenance plan to its machine and surfaces the same health summary', async () => {
    const response = await request(app.getHttpServer())
      .get('/predictive-maintenance/plans-summary')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body[planId]).toBeDefined();
    expect(response.body[planId].machineId).toBe(assignedMachineId);
    expect(response.body[planId].healthScore).toBeCloseTo(90, 5);
  });

  it('escalates risk to critical once a critical alarm is active, even with a low anomaly score', async () => {
    await faultEvents.create({
      device_id: new Types.ObjectId(),
      machine_id: new Types.ObjectId(assignedMachineId),
      code_panne: 'E-100',
      severity: FaultEventSeverity.CRITICAL,
      raised_at: new Date(),
    });

    const response = await request(app.getHttpServer())
      .post(`/predictive-maintenance/machines/${assignedMachineId}/refresh`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    expect(response.body[0].risk_level).toBe('critical');
  });

  it('marks risk as insufficient_data for a machine with zero measurable data, while still recording health_score/anomaly_score/confidence for audit purposes', async () => {
    // unassignedMachineId has no module, plan, fault event, work order, or
    // intervention of any kind (seedBaseData) — using the Admin token here
    // specifically to bypass the access-control rejection this same fixture
    // is used for above; Admin can reach any machine, including this one.
    const response = await request(app.getHttpServer())
      .post(`/predictive-maintenance/machines/${unassignedMachineId}/refresh`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    expect(response.body).toHaveLength(1);
    const [prediction] = response.body;
    expect(prediction.risk_level).toBe('insufficient_data');
    // The FakeModel's forced anomalyScore/confidence are still computed and
    // persisted for audit purposes — only risk_level is overridden.
    expect(prediction.health_score).toBeCloseTo(90, 5); // 100 * (1 - forcedAnomalyScore 0.1)
    expect(prediction.anomaly_score).toBeCloseTo(0.1, 5);
    expect(prediction.confidence).toBeCloseTo(0.75, 5);
    expect(
      prediction.explanation.uncertaintyNotes.some((n: string) => n.toLowerCase().includes('no telemetry')),
    ).toBe(true);
  });

  it('surfaces insufficient_data in the fleet summary for the zero-data machine', async () => {
    const response = await request(app.getHttpServer())
      .get('/predictive-maintenance/fleet-summary')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const entry = response.body.find((s: { machineId: string }) => s.machineId === unassignedMachineId);
    expect(entry).toBeDefined();
    expect(entry.riskLevel).toBe('insufficient_data');
  });

  it('retraining creates version 2 and archives version 1 (Admin-only listing)', async () => {
    await request(app.getHttpServer())
      .get('/predictive-maintenance/models')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post('/predictive-maintenance/models/zscore/train')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    const response = await request(app.getHttpServer())
      .get('/predictive-maintenance/models')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const versions = response.body.filter((v: { model_type: string }) => v.model_type === 'zscore');
    expect(versions).toHaveLength(2);
    const active = versions.filter((v: { status: string }) => v.status === 'active');
    expect(active).toHaveLength(1);
    expect(active[0].version).toBe(2);
  });
});
