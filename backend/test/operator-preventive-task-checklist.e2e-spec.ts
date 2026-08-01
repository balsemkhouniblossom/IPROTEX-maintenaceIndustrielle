/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
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
import {
  MaintenancePlan,
  MaintenancePlanDocument,
} from '../src/schemas/maintenance-plan.schema';
import {
  PreventiveTask,
  PreventiveTaskDocument,
} from '../src/schemas/preventive-task.schema';

describe('Operator preventive task checklist (e2e)', () => {
  let mongo: MongoMemoryServer;
  let app: INestApplication<App>;
  let jwtService: JwtService;
  let connection: Connection;
  let users: Model<UserDocument>;
  let machineTypes: Model<MachineTypeDocument>;
  let machines: Model<MachineDocument>;
  let moduleTypes: Model<ModuleTypeDocument>;
  let modules: Model<ModuleDocument>;
  let plans: Model<MaintenancePlanDocument>;
  let preventiveTasks: Model<PreventiveTaskDocument>;

  let operatorToken: string;
  let otherOperatorToken: string;
  let technicianToken: string;
  let emptyOperatorToken: string;
  let machineType: MachineTypeDocument;
  let machine: MachineDocument;
  let secondOwnMachine: MachineDocument;
  let otherMachine: MachineDocument;
  let ownTask: PreventiveTaskDocument;
  let secondOwnTask: PreventiveTaskDocument;
  let foreignTask: PreventiveTaskDocument;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongo.getUri('gmao_operator_checklist_e2e');
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
    plans = app.get(getModelToken(MaintenancePlan.name));
    preventiveTasks = app.get(getModelToken(PreventiveTask.name));

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

    machineType = await machineTypes.create({
      type_id: 1,
      name: 'Checklist E2E machine type',
    });
    const otherMachineType = await machineTypes.create({
      type_id: 2,
      name: 'Checklist E2E other machine type',
    });
    const moduleType = await moduleTypes.create({
      mod_type_id: 'MODTYPE-CHECKLIST-E2E',
      type_id: machineType._id,
      nom_module: 'Checklist E2E module type',
    });
    machine = await machines.create({
      machine_id: 'MACHINE-CHECKLIST-OWN',
      type_id: machineType._id,
      serial_no: 'CHECKLIST-OWN-001',
      status: 'active',
    });
    // Same category as `machine` and also assigned to the operator, so
    // machineTypeId-scoped (category-wide) queries have something to
    // aggregate across, distinct from the single-machineId case.
    secondOwnMachine = await machines.create({
      machine_id: 'MACHINE-CHECKLIST-OWN-2',
      type_id: machineType._id,
      serial_no: 'CHECKLIST-OWN-002',
      status: 'active',
    });
    otherMachine = await machines.create({
      machine_id: 'MACHINE-CHECKLIST-OTHER',
      // Different category on purpose: proves a category-scoped query
      // excludes machines outside the requested machineTypeId.
      type_id: otherMachineType._id,
      serial_no: 'CHECKLIST-OTHER-001',
      status: 'active',
    });
    const moduleEntity = await modules.create({
      module_id: 'MODULE-CHECKLIST-OWN',
      machine_id: machine._id,
      mod_type_id: moduleType._id,
    });
    const secondOwnModuleEntity = await modules.create({
      module_id: 'MODULE-CHECKLIST-OWN-2',
      machine_id: secondOwnMachine._id,
      mod_type_id: moduleType._id,
    });
    const otherModuleEntity = await modules.create({
      module_id: 'MODULE-CHECKLIST-OTHER',
      machine_id: otherMachine._id,
      mod_type_id: moduleType._id,
    });
    const plan = await plans.create({
      plan_id: 'PLAN-CHECKLIST-OWN',
      module_id: moduleEntity._id,
      type_maintenance: 'preventive',
      frequence: 1,
      unite_frequence: 'monthly',
      maintenance_code: 'CHECKLIST-OWN',
      instruction: 'Check belt tension',
    });

    ownTask = await preventiveTasks.create({
      task_id: 'PT-CHECKLIST-OWN-1',
      plan_id: plan._id,
      plan_code: plan.plan_id,
      module_id: moduleEntity._id,
      instruction: 'Check belt tension',
      status: 'pending',
      source: 'plan',
      source_key: `${plan._id.toString()}:0`,
    });
    secondOwnTask = await preventiveTasks.create({
      task_id: 'PT-CHECKLIST-OWN-2',
      module_id: secondOwnModuleEntity._id,
      instruction: 'Check belt tension on the second machine',
      status: 'pending',
      source: 'manual',
    });
    foreignTask = await preventiveTasks.create({
      task_id: 'PT-CHECKLIST-OTHER-1',
      module_id: otherModuleEntity._id,
      instruction: 'Inspect wiring on an unrelated machine',
      status: 'pending',
      source: 'manual',
    });

    const operator = await users.create({
      user_id: 'OP-CHECKLIST-E2E',
      nom_complet: 'Checklist Operator',
      email: 'checklist-operator-e2e@example.test',
      password: 'x',
      role: 'operator',
      is_active: true,
      is_verified: true,
      assigned_machine_ids: [machine._id, secondOwnMachine._id],
    });
    const otherOperator = await users.create({
      user_id: 'OP-CHECKLIST-OTHER-E2E',
      nom_complet: 'Other Checklist Operator',
      email: 'checklist-other-operator-e2e@example.test',
      password: 'x',
      role: 'operator',
      is_active: true,
      is_verified: true,
      // Non-empty and deliberately excludes `machine`: an operator with no
      // explicit assignment now defaults to full machine visibility, so this
      // fixture must narrow explicitly to exercise cross-operator rejection.
      assigned_machine_ids: [otherMachine._id],
    });
    const technician = await users.create({
      user_id: 'TECH-CHECKLIST-E2E',
      nom_complet: 'Checklist Technician',
      email: 'checklist-technician-e2e@example.test',
      password: 'x',
      role: 'technician',
      is_active: true,
      is_verified: true,
    });

    // A machine with a module but no MaintenancePlan/PreventiveTask at all —
    // exercises the "truly empty" case (valid access, zero data) as distinct
    // from the "no machine access" 403 case covered above.
    const emptyMachine = await machines.create({
      machine_id: 'MACHINE-CHECKLIST-EMPTY',
      type_id: machineType._id,
      serial_no: 'CHECKLIST-EMPTY-001',
      status: 'active',
    });
    await modules.create({
      module_id: 'MODULE-CHECKLIST-EMPTY',
      machine_id: emptyMachine._id,
      mod_type_id: moduleType._id,
    });
    const emptyOperator = await users.create({
      user_id: 'OP-CHECKLIST-EMPTY-E2E',
      nom_complet: 'Empty Checklist Operator',
      email: 'checklist-empty-operator-e2e@example.test',
      password: 'x',
      role: 'operator',
      is_active: true,
      is_verified: true,
      assigned_machine_ids: [emptyMachine._id],
    });

    operatorToken = tokenFor(operator);
    otherOperatorToken = tokenFor(otherOperator);
    technicianToken = tokenFor(technician);
    emptyOperatorToken = tokenFor(emptyOperator);
  }

  it('rejects an anonymous request', async () => {
    await request(app.getHttpServer())
      .get('/operator/preventive-tasks')
      .expect(401);
  });

  it('rejects a non-operator role (Operator-only endpoint)', async () => {
    await request(app.getHttpServer())
      .get('/operator/preventive-tasks')
      .set('Authorization', `Bearer ${technicianToken}`)
      .expect(403);
  });

  it("lists only checklist items belonging to the operator's accessible machines", async () => {
    const response = await request(app.getHttpServer())
      .get('/operator/preventive-tasks')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);

    const ids = response.body.items.map((item: { _id: string }) => item._id);
    expect(ids).toContain(ownTask._id.toString());
    expect(ids).toContain(secondOwnTask._id.toString());
    expect(ids).not.toContain(foreignTask._id.toString());
  });

  it('scopes the checklist to a whole machine category via machineTypeId, without needing a single machineId', async () => {
    const response = await request(app.getHttpServer())
      .get('/operator/preventive-tasks')
      .query({ machineTypeId: machineType._id.toString() })
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);

    const ids = response.body.items.map((item: { _id: string }) => item._id);
    expect(ids).toContain(ownTask._id.toString());
    expect(ids).toContain(secondOwnTask._id.toString());
    expect(ids).not.toContain(foreignTask._id.toString());
  });

  it('a single-machine query narrows to just that machine, excluding the sibling machine in the same category', async () => {
    const response = await request(app.getHttpServer())
      .get('/operator/preventive-tasks')
      .query({ machineId: machine._id.toString() })
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);

    const ids = response.body.items.map((item: { _id: string }) => item._id);
    expect(ids).toContain(ownTask._id.toString());
    expect(ids).not.toContain(secondOwnTask._id.toString());
  });

  it('rejects updating a checklist item on a machine the operator cannot access', async () => {
    await request(app.getHttpServer())
      .patch(`/operator/preventive-tasks/${foreignTask._id.toString()}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ status: 'completed' })
      .expect(403);
  });

  it('rejects a client-supplied field the DTO does not whitelist', async () => {
    await request(app.getHttpServer())
      .patch(`/operator/preventive-tasks/${ownTask._id.toString()}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ status: 'completed', module_id: otherMachine._id.toString() })
      .expect(400);
  });

  it('lets the operator mark their own checklist item complete, stamping completed_at server-side', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/operator/preventive-tasks/${ownTask._id.toString()}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ status: 'completed', notes: 'Belt tension checked and adjusted' })
      .expect(200);

    expect(response.body.status).toBe('completed');
    expect(response.body.notes).toBe('Belt tension checked and adjusted');
    expect(response.body.completed_at).toBeDefined();
  });

  it('reverting to pending clears completed_at', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/operator/preventive-tasks/${ownTask._id.toString()}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ status: 'pending' })
      .expect(200);

    expect(response.body.status).toBe('pending');
    expect(response.body.completed_at).toBeNull();
  });

  it('a different operator without access to this machine cannot see or update the item', async () => {
    const listResponse = await request(app.getHttpServer())
      .get('/operator/preventive-tasks')
      .set('Authorization', `Bearer ${otherOperatorToken}`)
      .expect(200);
    const ids = listResponse.body.items.map(
      (item: { _id: string }) => item._id,
    );
    expect(ids).not.toContain(ownTask._id.toString());

    await request(app.getHttpServer())
      .patch(`/operator/preventive-tasks/${ownTask._id.toString()}`)
      .set('Authorization', `Bearer ${otherOperatorToken}`)
      .send({ status: 'completed' })
      .expect(403);
  });

  it('returns a truly empty, paginated result (not an error) for an operator whose accessible machine has no plans/tasks', async () => {
    const response = await request(app.getHttpServer())
      .get('/operator/preventive-tasks')
      .set('Authorization', `Bearer ${emptyOperatorToken}`)
      .expect(200);

    expect(response.body.items).toEqual([]);
    expect(response.body.totalItems).toBe(0);
    expect(response.body.page).toBe(1);
    expect(response.body.totalPages).toBe(1);
  });
});
