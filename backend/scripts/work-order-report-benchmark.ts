import { performance } from 'perf_hooks';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types, createConnection } from 'mongoose';
import { WorkOrder, WorkOrderSchema } from '../src/schemas/work-order.schema';
import {
  InterventionReport,
  InterventionReportSchema,
} from '../src/schemas/intervention-report.schema';
import { Machine, MachineSchema } from '../src/schemas/machine.schema';
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
import { Counter, CounterSchema } from '../src/counters/counter.schema';
import { CounterService } from '../src/counters/counter.service';
import { WorkOrderLifecycleService } from '../src/work-orders/services/work-order-lifecycle.service';
import { WorkOrderPreventiveSchedulingService } from '../src/work-orders/services/work-order-preventive-scheduling.service';
import { MaintenanceSchedulingService } from '../src/work-orders/maintenance-scheduling.service';
import { WorkOrderReportService } from '../src/work-orders/services/work-order-report.service';
import { WorkOrderNotificationService } from '../src/work-orders/services/work-order-notification.service';

type BenchmarkOperation = {
  name: string;
  maxMongoOps: number;
  setup: () => Promise<() => Promise<unknown>>;
};

type MongoOp = {
  collectionName: string;
  method: string;
};

type BenchmarkResult = {
  name: string;
  medianMs: number;
  p95Ms: number;
  maxMongoOps: number;
  observedMongoOps: number;
  methods: Record<string, number>;
};

const SAMPLES = Number(process.env.WORK_ORDER_REPORT_BENCHMARK_SAMPLES ?? 20);

// No-op notification stub: this benchmark measures the durable-write path
// (report creation, lifecycle transition, report validation update), not
// the notification-center's own broadcast fan-out — the same exclusion the
// lifecycle and parts benchmarks make for the same reason.
const notificationService: Pick<
  WorkOrderNotificationService,
  'notifyCorrectiveAwaitingValidation' | 'notifyValidationDecision'
> = {
  notifyCorrectiveAwaitingValidation: () => Promise.resolve(null as never),
  notifyValidationDecision: () => Promise.resolve(null as never),
};

async function main() {
  const mongod = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
  });
  const connection = await createConnection(mongod.getUri()).asPromise();

  try {
    const workOrderModel = connection.model(WorkOrder.name, WorkOrderSchema);
    const reportModel = connection.model(
      InterventionReport.name,
      InterventionReportSchema,
    );
    const machineModel = connection.model(Machine.name, MachineSchema);
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
    const counterModel = connection.model(Counter.name, CounterSchema);
    await Promise.all([
      workOrderModel.syncIndexes(),
      reportModel.syncIndexes(),
      machineModel.syncIndexes(),
      lubrifiantModel.syncIndexes(),
      lubricationLogModel.syncIndexes(),
      panneModel.syncIndexes(),
      panneSolutionModel.syncIndexes(),
      counterModel.syncIndexes(),
    ]);

    const counterService = new CounterService(counterModel as never);
    const lifecycleService = new WorkOrderLifecycleService(
      workOrderModel as never,
      reportModel as never,
    );
    const preventiveSchedulingService = new WorkOrderPreventiveSchedulingService(
      workOrderModel as never,
      machineModel as never,
      {} as never,
      {} as never,
      counterService,
      new MaintenanceSchedulingService(),
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
      notificationService as WorkOrderNotificationService,
      lifecycleService,
      preventiveSchedulingService,
    );

    const machine = await machineModel.create(machineRow());
    const technicianId = new Types.ObjectId();
    const validatorId = new Types.ObjectId();

    const operations: BenchmarkOperation[] = [
      {
        name: 'create_corrective_report',
        maxMongoOps: 6,
        setup: async () => {
          const operatorId = new Types.ObjectId().toHexString();
          return () =>
            reportService.createCorrectiveReportForOperator({
              operatorId,
              machineId: machine._id.toString(),
              codePanne: `FAULT-${new Types.ObjectId().toHexString()}`,
              actions: ['Reset breaker'],
            });
        },
      },
      {
        name: 'submit_preventive_report',
        maxMongoOps: 4,
        setup: async () => {
          const order = await workOrderModel.create(
            preventiveOrder(technicianId, { status: 'scheduled' }),
          );
          return () =>
            reportService.submitPreventiveMaintenanceForOperator({
              operatorId: technicianId.toHexString(),
              workOrderId: order._id.toString(),
              tasksCompleted: ['Check belt tension'],
              condition: 'good',
            });
        },
      },
      {
        name: 'approve_validation',
        maxMongoOps: 4,
        setup: async () => {
          const order = await workOrderModel.create(
            correctiveOrder(technicianId, { status: 'waiting_validation' }),
          );
          await reportModel.create(report(order._id, technicianId));
          return () =>
            reportService.applyValidationDecision({
              workOrderId: order._id.toString(),
              action: 'approve',
              validatorId: validatorId.toHexString(),
            });
        },
      },
      {
        name: 'reject_validation',
        maxMongoOps: 4,
        setup: async () => {
          const order = await workOrderModel.create(
            correctiveOrder(technicianId, { status: 'waiting_validation' }),
          );
          await reportModel.create(report(order._id, technicianId));
          return () =>
            reportService.applyValidationDecision({
              workOrderId: order._id.toString(),
              action: 'reject',
              validatorId: validatorId.toHexString(),
            });
        },
      },
      {
        name: 'request_correction',
        maxMongoOps: 4,
        setup: async () => {
          const order = await workOrderModel.create(
            correctiveOrder(technicianId, { status: 'waiting_validation' }),
          );
          await reportModel.create(report(order._id, technicianId));
          return () =>
            reportService.applyValidationDecision({
              workOrderId: order._id.toString(),
              action: 'request_correction',
              validatorId: validatorId.toHexString(),
            });
        },
      },
      {
        name: 'load_work_order_report',
        maxMongoOps: 1,
        setup: async () => {
          const order = await workOrderModel.create(
            correctiveOrder(technicianId, { status: 'waiting_validation' }),
          );
          await reportModel.create(report(order._id, technicianId));
          return () =>
            reportModel.findOne({ ot_id: order._id }).exec();
        },
      },
    ];

    const results: BenchmarkResult[] = [];
    for (const operation of operations) {
      results.push(await runOperation(connection, operation));
    }

    const failures = results.filter(
      (result) => result.observedMongoOps > result.maxMongoOps,
    );
    console.table(results);
    if (failures.length) {
      throw new Error(
        `Report benchmark exceeded query budget for: ${failures
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

function correctiveOrder(
  technicianId: Types.ObjectId,
  overrides: Record<string, unknown> = {},
) {
  return {
    ot_id: `WO-COR-${new Types.ObjectId().toHexString()}`,
    machine_id: new Types.ObjectId(),
    technician_id: technicianId,
    type_maintenance: 'corrective',
    status: 'pending',
    date_created: new Date(),
    lifecycle_history: [],
    ...overrides,
  };
}

function preventiveOrder(
  technicianId: Types.ObjectId,
  overrides: Record<string, unknown> = {},
) {
  return {
    ot_id: `WO-PREV-${new Types.ObjectId().toHexString()}`,
    machine_id: new Types.ObjectId(),
    technician_id: technicianId,
    type_maintenance: 'preventive',
    status: 'scheduled',
    date_created: new Date(),
    lifecycle_history: [],
    ...overrides,
  };
}

function report(workOrderId: Types.ObjectId, technicianId: Types.ObjectId) {
  return {
    report_id: `REP-${new Types.ObjectId().toHexString()}`,
    ot_id: workOrderId,
    technician_id: technicianId,
    date_debut: new Date('2026-08-02T08:00:00.000Z'),
    date_fin: new Date('2026-08-02T09:00:00.000Z'),
    description_action: 'Adjusted drive',
    etat_final: 'resolved',
    validation_responsable: 'waiting_validation',
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
