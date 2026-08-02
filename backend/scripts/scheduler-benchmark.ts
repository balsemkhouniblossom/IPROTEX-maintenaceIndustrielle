import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model, createConnection, Types } from 'mongoose';
import {
  AutomationJobLock,
  AutomationJobLockDocument,
  AutomationJobLockSchema,
} from '../src/schemas/automation-job-lock.schema';
import {
  Device,
  DeviceConnectionStatus,
  DeviceSchema,
} from '../src/schemas/device.schema';
import { Machine, MachineSchema } from '../src/schemas/machine.schema';
import {
  MaintenancePlan,
  MaintenancePlanSchema,
  MaintenancePlanStatus,
} from '../src/schemas/maintenance-plan.schema';
import {
  Module as ModuleEntity,
  ModuleSchema,
} from '../src/schemas/module.schema';
import { WorkOrder, WorkOrderSchema } from '../src/schemas/work-order.schema';
import { SchedulerLockService } from '../src/scheduler/scheduler-lock.service';

const MACHINE_COUNT = 3000;
const DEVICE_COUNT = 3000;
const WORK_ORDER_COUNT = 6000;
const BATCH_SIZE = 250;
const MAX_ITEMS = 2000;

async function main() {
  const mongod = await MongoMemoryServer.create();
  const connection = await createConnection(mongod.getUri()).asPromise();

  try {
    const MachineModel = connection.model(Machine.name, MachineSchema);
    const ModuleModel = connection.model(ModuleEntity.name, ModuleSchema);
    const MaintenancePlanModel = connection.model(
      MaintenancePlan.name,
      MaintenancePlanSchema,
    );
    const DeviceModel = connection.model(Device.name, DeviceSchema);
    const WorkOrderModel = connection.model(WorkOrder.name, WorkOrderSchema);
    const LockModel = connection.model(
      AutomationJobLock.name,
      AutomationJobLockSchema,
    ) as unknown as Model<AutomationJobLockDocument>;
    await Promise.all([
      MachineModel.syncIndexes(),
      ModuleModel.syncIndexes(),
      MaintenancePlanModel.syncIndexes(),
      DeviceModel.syncIndexes(),
      WorkOrderModel.syncIndexes(),
      LockModel.syncIndexes(),
    ]);

    const machineIds = Array.from(
      { length: MACHINE_COUNT },
      () => new Types.ObjectId(),
    );
    await MachineModel.insertMany(
      machineIds.map((_id, index) => ({
        _id,
        machine_id: `M-${index}`,
        nom: `Machine ${index}`,
        type_id: new Types.ObjectId(),
        serial_no: `SN-${index}`,
        status: 'active',
      })),
    );
    await DeviceModel.insertMany(
      Array.from({ length: DEVICE_COUNT }, (_, index) => ({
        device_id: `DEV-${index}`,
        device_type: 'simulator',
        api_key_hash: `hash-${index}`,
        key_prefix: `kp-${index}`,
        machine_id: machineIds[index % machineIds.length],
        is_active: true,
        last_known_status:
          index % 3 === 0
            ? DeviceConnectionStatus.OFFLINE
            : DeviceConnectionStatus.ONLINE,
      })),
    );
    const moduleIds = Array.from(
      { length: MACHINE_COUNT },
      () => new Types.ObjectId(),
    );
    const planIds = Array.from(
      { length: MACHINE_COUNT },
      () => new Types.ObjectId(),
    );
    await ModuleModel.insertMany(
      moduleIds.map((_id, index) => ({
        _id,
        module_id: `MOD-${index}`,
        machine_id: machineIds[index % machineIds.length],
        mod_type_id: new Types.ObjectId(),
      })),
    );
    await MaintenancePlanModel.insertMany(
      moduleIds.map((module_id, index) => ({
        _id: planIds[index],
        plan_id: `PLAN-${index}`,
        module_id,
        type_maintenance: index % 10 === 0 ? 'corrective' : 'preventive',
        frequence: 1 + (index % 3),
        unite_frequence: index % 2 === 0 ? 'month' : 'week',
        status:
          index % 7 === 0
            ? MaintenancePlanStatus.PAUSED
            : MaintenancePlanStatus.ACTIVE,
      })),
    );
    await WorkOrderModel.insertMany(
      Array.from({ length: WORK_ORDER_COUNT }, (_, index) => ({
        ot_id: `WO-${index}`,
        machine_id: machineIds[index % machineIds.length],
        module_id: moduleIds[index % moduleIds.length],
        plan_id: planIds[index % planIds.length],
        type_maintenance: index % 2 === 0 ? 'preventive' : 'corrective',
        status: index % 5 === 0 ? 'completed' : 'overdue',
        date_created: new Date(Date.now() - index * 60_000),
        date_start: new Date(Date.now() - index * 60_000),
      })),
    );

    const beforeMemory = process.memoryUsage().heapUsed;
    const oldStart = Date.now();
    const allMachines = await MachineModel.find({}, { _id: 1 }).lean().exec();
    const oldRuntimeMs = Date.now() - oldStart;

    const oldPreventiveStart = Date.now();
    const [
      allPlansForPreventive,
      allModulesForPreventive,
      allMachinesForPreventive,
      allPreventiveOrders,
    ] = await Promise.all([
      MaintenancePlanModel.find({}, { _id: 1 }).lean().exec(),
      ModuleModel.find({}, { _id: 1 }).lean().exec(),
      MachineModel.find({}, { _id: 1 }).lean().exec(),
      WorkOrderModel.find(
        { type_maintenance: { $not: /correct/i } },
        { _id: 1, plan_id: 1, machine_id: 1, module_id: 1, date_start: 1 },
      )
        .lean()
        .exec(),
    ]);
    const oldPreventiveRuntimeMs = Date.now() - oldPreventiveStart;

    let batches = 0;
    let scanned = 0;
    let lastId: Types.ObjectId | undefined;
    const newStart = Date.now();
    while (scanned < MAX_ITEMS) {
      const remaining = MAX_ITEMS - scanned;
      const batch = await MachineModel.find(
        lastId ? { _id: { $gt: lastId } } : {},
        { _id: 1 },
      )
        .sort({ _id: 1 })
        .limit(Math.min(BATCH_SIZE, remaining))
        .lean()
        .exec();
      if (!batch.length) break;
      batches += 1;
      scanned += batch.length;
      lastId = batch[batch.length - 1]._id as Types.ObjectId;
      if (batch.length < BATCH_SIZE) break;
    }
    const newRuntimeMs = Date.now() - newStart;

    let preventiveBatches = 0;
    let preventivePlansScanned = 0;
    let preventiveLastId: Types.ObjectId | undefined;
    let preventiveLatestRows = 0;
    const newPreventiveStart = Date.now();
    while (preventivePlansScanned < MAX_ITEMS) {
      const remaining = MAX_ITEMS - preventivePlansScanned;
      const plans = await MaintenancePlanModel.find(
        {
          ...(preventiveLastId ? { _id: { $gt: preventiveLastId } } : {}),
          type_maintenance: { $not: /correct/i },
          status: MaintenancePlanStatus.ACTIVE,
        },
        { _id: 1, module_id: 1 },
      )
        .sort({ _id: 1 })
        .limit(Math.min(BATCH_SIZE, remaining))
        .lean()
        .exec();
      if (!plans.length) break;
      preventiveBatches += 1;
      preventivePlansScanned += plans.length;
      preventiveLastId = plans[plans.length - 1]._id as Types.ObjectId;
      const latestRows = await WorkOrderModel.aggregate([
        {
          $match: {
            plan_id: { $in: plans.map((plan) => plan._id) },
            type_maintenance: { $not: /correct/i },
          },
        },
        {
          $sort: {
            plan_id: 1,
            machine_id: 1,
            module_id: 1,
            date_start: -1,
            date_created: -1,
            _id: -1,
          },
        },
        {
          $group: {
            _id: {
              machine_id: '$machine_id',
              module_id: '$module_id',
              plan_id: '$plan_id',
            },
            order: { $first: '$_id' },
          },
        },
      ]).exec();
      preventiveLatestRows += latestRows.length;
      if (plans.length < BATCH_SIZE) break;
    }
    const newPreventiveRuntimeMs = Date.now() - newPreventiveStart;

    const lockA = new SchedulerLockService(LockModel);
    const lockB = new SchedulerLockService(LockModel);
    const [firstLock, secondLock] = await Promise.all([
      lockA.acquire('benchmark-singleton', 'run-a', 60_000),
      lockB.acquire('benchmark-singleton', 'run-b', 60_000),
    ]);

    const afterMemory = process.memoryUsage().heapUsed;
    console.log(
      JSON.stringify(
        {
          seeded: {
            machines: MACHINE_COUNT,
            devices: DEVICE_COUNT,
            workOrders: WORK_ORDER_COUNT,
            maintenancePlans: MACHINE_COUNT,
            modules: MACHINE_COUNT,
          },
          before: {
            mode: 'unbounded-find',
            scanned: allMachines.length,
            batches: 1,
            runtimeMs: oldRuntimeMs,
          },
          after: {
            mode: 'bounded-id-batches',
            scanned,
            batches,
            batchSize: BATCH_SIZE,
            maxItemsPerRun: MAX_ITEMS,
            runtimeMs: newRuntimeMs,
          },
          preventiveGeneration: {
            before: {
              mode: 'unbounded-plans-modules-machines-workorders',
              plansLoaded: allPlansForPreventive.length,
              modulesLoaded: allModulesForPreventive.length,
              machinesLoaded: allMachinesForPreventive.length,
              workOrdersLoaded: allPreventiveOrders.length,
              runtimeMs: oldPreventiveRuntimeMs,
            },
            after: {
              mode: 'bounded-plan-batches-with-latest-order-aggregation',
              plansScanned: preventivePlansScanned,
              latestRowsReturned: preventiveLatestRows,
              batches: preventiveBatches,
              batchSize: BATCH_SIZE,
              maxItemsPerRun: MAX_ITEMS,
              runtimeMs: newPreventiveRuntimeMs,
            },
          },
          lockBehavior: {
            simultaneousAcquirers: [firstLock, secondLock].filter(Boolean)
              .length,
          },
          heapDeltaBytes: afterMemory - beforeMemory,
        },
        null,
        2,
      ),
    );
  } finally {
    await connection.close();
    await mongod.stop();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
