import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types, createConnection } from 'mongoose';
import { Machine, MachineSchema } from '../schemas/machine.schema';
import { Module as ModuleEntity, ModuleSchema } from '../schemas/module.schema';
import {
  MaintenancePlan,
  MaintenancePlanSchema,
  MaintenancePlanStatus,
} from '../schemas/maintenance-plan.schema';
import { WorkOrder, WorkOrderSchema } from '../schemas/work-order.schema';
import { MaintenanceSchedulingService } from './maintenance-scheduling.service';
import { WorkOrdersService } from './work-orders.service';

describe('WorkOrdersService preventive scheduler generation', () => {
  let mongod: MongoMemoryServer;
  let connection: Connection;
  let service: WorkOrdersService;
  let workOrderModel: any;
  let machineModel: any;
  let moduleModel: any;
  let planModel: any;
  let counter = 0;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    connection = await createConnection(mongod.getUri()).asPromise();
    workOrderModel = connection.model(WorkOrder.name, WorkOrderSchema);
    machineModel = connection.model(Machine.name, MachineSchema);
    moduleModel = connection.model(ModuleEntity.name, ModuleSchema);
    planModel = connection.model(MaintenancePlan.name, MaintenancePlanSchema);
    await Promise.all([
      workOrderModel.syncIndexes(),
      machineModel.syncIndexes(),
      moduleModel.syncIndexes(),
      planModel.syncIndexes(),
    ]);
  }, 60_000);

  afterAll(async () => {
    await connection.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    counter = 0;
    await Promise.all([
      workOrderModel.deleteMany({}),
      machineModel.deleteMany({}),
      moduleModel.deleteMany({}),
      planModel.deleteMany({}),
    ]);

    service = new WorkOrdersService(
      workOrderModel as never,
      machineModel as never,
      moduleModel as never,
      planModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { getNextSequence: jest.fn(async () => ++counter) } as never,
      new MaintenanceSchedulingService(),
      { createIfNotExists: jest.fn() } as never,
      {} as never,
      {} as never,
      {
        getSettings: () => ({
          enabled: true,
          batchSize: 1,
          concurrency: 2,
          externalConcurrency: 1,
          lockTtlMs: 120_000,
          lockHeartbeatMs: 10_000,
          jobTimeoutMs: 60_000,
          maxItemsPerRun: 10,
        }),
      } as never,
    );
  });

  it('creates only one next preventive occurrence when two scheduler runs race', async () => {
    const machineId = new Types.ObjectId();
    const moduleId = new Types.ObjectId();
    const planId = new Types.ObjectId();
    const completedId = new Types.ObjectId();

    await machineModel.create({
      _id: machineId,
      machine_id: 'M-RACE',
      type_id: new Types.ObjectId(),
      serial_no: 'SN-RACE',
      installation_date: new Date('2026-01-01T00:00:00.000Z'),
      status: 'active',
    });
    await moduleModel.create({
      _id: moduleId,
      module_id: 'MOD-RACE',
      machine_id: machineId,
      mod_type_id: new Types.ObjectId(),
    });
    await planModel.create({
      _id: planId,
      plan_id: 'PLAN-RACE',
      module_id: moduleId,
      type_maintenance: 'preventive',
      frequence: 1,
      unite_frequence: 'month',
      status: MaintenancePlanStatus.ACTIVE,
    });
    await workOrderModel.create({
      _id: completedId,
      ot_id: 'WO-PREV-000001',
      machine_id: machineId,
      module_id: moduleId,
      plan_id: planId,
      type_maintenance: 'preventive',
      status: 'completed',
      date_created: new Date('2026-06-01T08:00:00.000Z'),
      date_start: new Date('2026-06-01T08:00:00.000Z'),
      execution_date: new Date('2026-06-15T08:30:00.000Z'),
      priorite: 'medium',
      description: 'Synthetic preventive occurrence',
    });

    const [first, second] = await Promise.all([
      service.triggerScheduler('manual'),
      service.triggerScheduler('manual'),
    ]);

    const generated = await workOrderModel
      .find({ recurrence_source_occurrence_id: completedId })
      .lean()
      .exec();

    expect(generated).toHaveLength(1);
    expect(generated[0].preventive_occurrence_key).toBe(
      `preventive:preventive:${machineId.toHexString()}:${moduleId.toHexString()}:${planId.toHexString()}:2026-07-15T08:30:00.000Z`,
    );
    expect(first.createdNextExecution + second.createdNextExecution).toBe(1);
    expect(first.alreadyExisting! + second.alreadyExisting!).toBeGreaterThan(0);
  }, 60_000);

  it('scans active/imported plans in bounded batches without collection-wide module, machine, or work-order reads', async () => {
    const machineId = new Types.ObjectId();
    const moduleId = new Types.ObjectId();
    const activePlanId = new Types.ObjectId();
    const importedPlanId = new Types.ObjectId();

    await machineModel.create({
      _id: machineId,
      machine_id: 'M-BATCH',
      type_id: new Types.ObjectId(),
      serial_no: 'SN-BATCH',
      status: 'active',
    });
    await moduleModel.create({
      _id: moduleId,
      module_id: 'MOD-BATCH',
      machine_id: machineId,
      mod_type_id: new Types.ObjectId(),
    });
    await planModel.insertMany([
      {
        _id: activePlanId,
        plan_id: 'PLAN-ACTIVE',
        module_id: moduleId,
        type_maintenance: 'preventive',
        frequence: 1,
        unite_frequence: 'month',
        status: MaintenancePlanStatus.ACTIVE,
      },
      {
        _id: importedPlanId,
        plan_id: 'PLAN-IMPORTED',
        module_id: moduleId,
        type_maintenance: 'inspection',
        frequence: 2,
        unite_frequence: 'week',
      },
    ]);

    const planFindSpy = jest.spyOn(planModel, 'find');
    const moduleFindSpy = jest.spyOn(moduleModel, 'find');
    const machineFindSpy = jest.spyOn(machineModel, 'find');
    const workOrderAggregateSpy = jest.spyOn(workOrderModel, 'aggregate');

    const summary = await service.triggerScheduler('manual');

    expect(summary.plansEvaluated).toBe(2);
    expect(summary.batches).toBe(2);
    expect(planFindSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        $and: expect.arrayContaining([
          expect.objectContaining({
            $or: expect.arrayContaining([
              { status: MaintenancePlanStatus.ACTIVE },
              { status: { $exists: false } },
            ]),
          }),
        ]),
      }),
      expect.any(Object),
    );
    expect(moduleFindSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: expect.objectContaining({ $in: expect.any(Array) }),
      }),
      expect.any(Object),
    );
    expect(machineFindSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: expect.objectContaining({ $in: expect.any(Array) }),
      }),
      expect.any(Object),
    );
    expect(workOrderAggregateSpy).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          $match: expect.objectContaining({
            plan_id: expect.objectContaining({ $in: expect.any(Array) }),
          }),
        }),
      ]),
    );
  }, 60_000);
});
