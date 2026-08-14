import { performance } from 'node:perf_hooks';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types, createConnection } from 'mongoose';
import { WorkOrder, WorkOrderSchema } from '../src/schemas/work-order.schema';
import {
  InterventionReport,
  InterventionReportSchema,
} from '../src/schemas/intervention-report.schema';
import { Machine, MachineSchema } from '../src/schemas/machine.schema';
import {
  Module as ModuleEntity,
  ModuleSchema,
} from '../src/schemas/module.schema';
import {
  MaintenancePlan,
  MaintenancePlanSchema,
} from '../src/schemas/maintenance-plan.schema';
import { Lubrifiant, LubrifiantSchema } from '../src/schemas/lubrifiant.schema';
import {
  LubrificationLog,
  LubrificationLogSchema,
} from '../src/schemas/lubrification-log.schema';
import { Panne, PanneSchema } from '../src/schemas/panne.schema';
import {
  PanneSolution,
  PanneSolutionSchema,
} from '../src/schemas/panne-solution.schema';
import { KPI, KPISchema } from '../src/schemas/kpi.schema';
import { Counter, CounterSchema } from '../src/counters/counter.schema';
import { CounterService } from '../src/counters/counter.service';
import { MaintenanceSchedulingService } from '../src/work-orders/maintenance-scheduling.service';
import { WorkOrderNotificationService } from '../src/work-orders/services/work-order-notification.service';
import { WorkOrderLifecycleService } from '../src/work-orders/services/work-order-lifecycle.service';
import { WorkOrderPreventiveSchedulingService } from '../src/work-orders/services/work-order-preventive-scheduling.service';
import { WorkOrderReportService } from '../src/work-orders/services/work-order-report.service';
import { WorkOrderKpiService } from '../src/work-orders/services/work-order-kpi.service';
import { WorkOrderCommandService } from '../src/work-orders/services/work-order-command.service';
import { WorkOrderOperatorCommandService } from '../src/work-orders/services/work-order-operator-command.service';

// Regression evidence only: MongoMemoryReplSet numbers catch a query-count
// or latency regression between runs of this script, not production
// capacity planning.

type BenchmarkOperation = {
  name: string;
  maxMongoOps: number;
  setup: () => Promise<() => Promise<unknown>>;
};

type MongoOp = { collectionName: string; method: string };

type BenchmarkResult = {
  name: string;
  medianMs: number;
  p95Ms: number;
  maxMongoOps: number;
  observedMongoOps: number;
  methods: Record<string, number>;
};

const SAMPLES = Number(process.env.WORK_ORDER_COMMAND_BENCHMARK_SAMPLES ?? 20);

const noopNotificationService: Pick<
  WorkOrderNotificationService,
  'notifyCreated'
> = {
  notifyCreated: () => Promise.resolve(null as never),
};

async function main() {
  const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const connection = await createConnection(mongod.getUri()).asPromise();

  try {
    const workOrderModel = connection.model(WorkOrder.name, WorkOrderSchema);
    const reportModel = connection.model(
      InterventionReport.name,
      InterventionReportSchema,
    );
    const machineModel = connection.model(Machine.name, MachineSchema);
    const moduleModel = connection.model(ModuleEntity.name, ModuleSchema);
    const maintenancePlanModel = connection.model(
      MaintenancePlan.name,
      MaintenancePlanSchema,
    );
    const lubrifiantModel = connection.model(
      Lubrifiant.name,
      LubrifiantSchema,
    );
    const lubricationLogModel = connection.model(
      LubrificationLog.name,
      LubrificationLogSchema,
    );
    const panneModel = connection.model(Panne.name, PanneSchema);
    const panneSolutionModel = connection.model(
      PanneSolution.name,
      PanneSolutionSchema,
    );
    const kpiModel = connection.model(KPI.name, KPISchema);
    const counterModel = connection.model(Counter.name, CounterSchema);

    await Promise.all(
      [
        workOrderModel,
        reportModel,
        machineModel,
        moduleModel,
        maintenancePlanModel,
        lubrifiantModel,
        lubricationLogModel,
        panneModel,
        panneSolutionModel,
        kpiModel,
        counterModel,
      ].map((model) => model.syncIndexes()),
    );

    const counterService = new CounterService(counterModel as never);
    const schedulingService = new MaintenanceSchedulingService();
    const lifecycleService = new WorkOrderLifecycleService(
      workOrderModel as never,
      reportModel as never,
    );
    const preventiveSchedulingService = new WorkOrderPreventiveSchedulingService(
      workOrderModel as never,
      machineModel as never,
      moduleModel as never,
      maintenancePlanModel as never,
      counterService,
      schedulingService,
    );
    const reportService = new WorkOrderReportService(
      workOrderModel as never,
      reportModel as never,
      machineModel as never,
      lubrifiantModel as never,
      lubricationLogModel as never,
      panneModel as never,
      panneSolutionModel as never,
      counterService,
      noopNotificationService as WorkOrderNotificationService,
      lifecycleService,
      preventiveSchedulingService,
    );
    const kpiService = new WorkOrderKpiService(
      workOrderModel as never,
      kpiModel as never,
      counterService,
    );
    const commandService = new WorkOrderCommandService(
      workOrderModel as never,
      counterService,
      noopNotificationService as WorkOrderNotificationService,
      reportService,
      preventiveSchedulingService,
      kpiService,
    );
    const operatorCommandService = new WorkOrderOperatorCommandService(
      workOrderModel as never,
      lifecycleService,
      preventiveSchedulingService,
    );

    const machine = await machineModel.create(machineRow());
    const technicianId = new Types.ObjectId();

    const operations: BenchmarkOperation[] = [
      {
        name: 'generic_create',
        // work-order code counter increment + the insert itself (no
        // duplicate-preventive-occurrence query since no plan_id is set).
        maxMongoOps: 2,
        setup: async () => () =>
          commandService.create({
            machine_id: machine._id.toString(),
            technician_id: technicianId.toHexString(),
            type_maintenance: 'preventive',
            status: 'scheduled',
          } as never),
      },
      {
        name: 'generic_update',
        maxMongoOps: 1,
        setup: async () => {
          const order = await workOrderModel.create(
            workOrderRow(machine._id, technicianId, { status: 'in_progress' }),
          );
          return () =>
            commandService.update(order._id.toString(), {
              description: 'Updated during benchmark',
            } as never);
        },
      },
      {
        name: 'operator_start',
        maxMongoOps: 2,
        setup: async () => {
          const order = await workOrderModel.create(
            workOrderRow(machine._id, technicianId, { status: 'scheduled' }),
          );
          return () =>
            operatorCommandService.startWorkOrderForOperator({
              operatorId: technicianId.toHexString(),
              workOrderId: order._id.toString(),
            });
        },
      },
      {
        name: 'operator_completion',
        maxMongoOps: 2,
        setup: async () => {
          const order = await workOrderModel.create(
            workOrderRow(machine._id, technicianId, { status: 'in_progress' }),
          );
          return () =>
            operatorCommandService.completeWorkOrderForOperator({
              operatorId: technicianId.toHexString(),
              workOrderId: order._id.toString(),
            });
        },
      },
      {
        name: 'operator_reschedule',
        maxMongoOps: 3,
        setup: async () => {
          const order = await workOrderModel.create(
            workOrderRow(machine._id, technicianId, {
              status: 'scheduled',
              type_maintenance: 'preventive',
            }),
          );
          return () =>
            operatorCommandService.rescheduleWorkOrderForOperator({
              operatorId: technicianId.toHexString(),
              workOrderId: order._id.toString(),
              newDueDate: '2026-09-01T08:00:00.000Z',
              reason: 'Machine unavailable',
            });
        },
      },
      {
        name: 'kpi_recomputation',
        maxMongoOps: 4,
        setup: async () => {
          await workOrderModel.insertMany(
            Array.from({ length: 20 }, (_, index) =>
              workOrderRow(machine._id, technicianId, {
                status: 'completed',
                type_maintenance: index % 3 === 0 ? 'corrective' : 'preventive',
                date_start: new Date(Date.now() - (index + 2) * 3600_000),
                date_end: new Date(Date.now() - (index + 1) * 3600_000),
                date_closed: new Date(Date.now() - (index + 1) * 3600_000),
              }),
            ),
          );
          return () => kpiService.updateKpiForMachine(machine._id.toString());
        },
      },
      {
        name: 'generic_remove',
        maxMongoOps: 1,
        setup: async () => {
          const order = await workOrderModel.create(
            workOrderRow(machine._id, technicianId),
          );
          return () => commandService.remove(order._id.toString());
        },
      },
    ];

    const results: BenchmarkResult[] = [];
    for (const operation of operations) {
      results.push(await runOperation(connection, operation));
    }

    console.table(results);
    const failures = results.filter(
      (result) => result.observedMongoOps > result.maxMongoOps,
    );
    if (failures.length) {
      throw new Error(
        `Command benchmark exceeded query budget for: ${failures
          .map((failure) => failure.name)
          .join(', ')}`,
      );
    }
  } finally {
    await connection.close();
    await mongod.stop();
  }
}

async function runOperation(
  connection: Connection,
  operation: BenchmarkOperation,
): Promise<BenchmarkResult> {
  const timings: number[] = [];
  const counts: number[] = [];
  const methodTotals = new Map<string, number>();

  for (let index = 0; index < SAMPLES; index += 1) {
    const fn = await operation.setup();
    const observed: MongoOp[] = [];
    connection.set('debug', (collectionName: string, method: string) => {
      observed.push({ collectionName, method });
    });
    const started = performance.now();
    await fn();
    timings.push(performance.now() - started);
    connection.set('debug', false);
    counts.push(observed.length);
    for (const op of observed) {
      const key = `${op.collectionName}.${op.method}`;
      methodTotals.set(key, (methodTotals.get(key) ?? 0) + 1);
    }
  }

  return {
    name: operation.name,
    medianMs: round(percentile(timings, 50)),
    p95Ms: round(percentile(timings, 95)),
    maxMongoOps: operation.maxMongoOps,
    observedMongoOps: Math.max(...counts),
    methods: Object.fromEntries(methodTotals),
  };
}

function machineRow() {
  return {
    machine_id: `M-${new Types.ObjectId().toHexString()}`,
    type_id: new Types.ObjectId(),
    serial_no: `SN-${new Types.ObjectId().toHexString()}`,
    status: 'active',
    model: 'Bench Machine',
  };
}

function workOrderRow(
  machineId: Types.ObjectId,
  technicianId: Types.ObjectId,
  overrides: Record<string, unknown> = {},
) {
  return {
    ot_id: `WO-${new Types.ObjectId().toHexString()}`,
    machine_id: machineId,
    technician_id: technicianId,
    type_maintenance: 'corrective',
    status: 'pending',
    date_created: new Date(),
    lifecycle_history: [],
    ...overrides,
  };
}

function percentile(values: number[], percentileValue: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((percentileValue / 100) * sorted.length) - 1,
  );
  return sorted[index] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
