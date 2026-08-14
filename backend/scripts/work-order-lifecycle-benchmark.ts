import { performance } from 'node:perf_hooks';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types, createConnection } from 'mongoose';
import {
  InterventionReport,
  InterventionReportSchema,
} from '../src/schemas/intervention-report.schema';
import { WorkOrder, WorkOrderSchema } from '../src/schemas/work-order.schema';
import { WorkOrderAssignmentService } from '../src/work-orders/services/work-order-assignment.service';
import { WorkOrderLifecycleService } from '../src/work-orders/services/work-order-lifecycle.service';

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

const SAMPLES = Number(
  process.env.WORK_ORDER_LIFECYCLE_BENCHMARK_SAMPLES ?? 20,
);
const MACHINE_COUNT = Number(
  process.env.WORK_ORDER_LIFECYCLE_BENCHMARK_MACHINES ?? 500,
);
const BACKGROUND_WORK_ORDERS = Number(
  process.env.WORK_ORDER_LIFECYCLE_BENCHMARK_BACKGROUND_ORDERS ?? 2000,
);

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
    await workOrderModel.syncIndexes();
    await reportModel.syncIndexes();

    const assignmentService = new WorkOrderAssignmentService(
      workOrderModel as never,
    );
    const lifecycleService = new WorkOrderLifecycleService(
      workOrderModel as never,
      reportModel as never,
    );
    const machineIds = Array.from(
      { length: MACHINE_COUNT },
      () => new Types.ObjectId(),
    );
    const technicianId = new Types.ObjectId();
    const validatorId = new Types.ObjectId();

    await workOrderModel.insertMany(
      Array.from({ length: BACKGROUND_WORK_ORDERS }, (_, index) =>
        workOrder({
          machine_id: machineIds[index % machineIds.length],
          technician_id: index % 3 === 0 ? new Types.ObjectId() : undefined,
          status: index % 4 === 0 ? 'scheduled' : 'pending',
        }),
      ),
    );

    const operations: BenchmarkOperation[] = [
      {
        name: 'technician_claim',
        maxMongoOps: 2,
        setup: async () => {
          const order = await workOrderModel.create(
            workOrder({ machine_id: machineIds[0], status: 'pending' }),
          );
          return () =>
            assignmentService.claimForTechnician({
              technicianId: technicianId.toHexString(),
              workOrderId: order._id.toString(),
              accessibleMachineIds: [machineIds[0]],
            });
        },
      },
      {
        name: 'operator_start',
        maxMongoOps: 1,
        setup: async () => {
          const order = await workOrderModel.create(
            workOrder({ technician_id: technicianId, status: 'scheduled' }),
          );
          return () =>
            lifecycleService.startForOperator({
              operatorId: technicianId.toHexString(),
              workOrderId: order._id.toString(),
            });
        },
      },
      {
        name: 'operator_complete',
        maxMongoOps: 1,
        setup: async () => {
          const order = await workOrderModel.create(
            workOrder({ technician_id: technicianId, status: 'in_progress' }),
          );
          return () =>
            lifecycleService.completeForOperator({
              operatorId: technicianId.toHexString(),
              workOrderId: order._id.toString(),
            });
        },
      },
      {
        name: 'technician_start',
        maxMongoOps: 3,
        setup: async () => {
          const order = await workOrderModel.create(
            workOrder({ machine_id: machineIds[1], status: 'assigned' }),
          );
          await reportModel.create(report(order._id, technicianId));
          return () =>
            lifecycleService.startForTechnician({
              technicianId: technicianId.toHexString(),
              workOrderId: order._id.toString(),
              accessibleMachineIds: [machineIds[1]],
            });
        },
      },
      {
        name: 'technician_waiting_parts',
        maxMongoOps: 1,
        setup: async () => {
          const order = await workOrderModel.create(
            workOrder({ technician_id: technicianId, status: 'in_progress' }),
          );
          return () =>
            lifecycleService.transitionForTechnician({
              technicianId: technicianId.toHexString(),
              workOrderId: order._id.toString(),
              from: ['in_progress'],
              to: 'waiting_parts',
            });
        },
      },
      {
        name: 'technician_resume',
        maxMongoOps: 1,
        setup: async () => {
          const order = await workOrderModel.create(
            workOrder({ technician_id: technicianId, status: 'waiting_parts' }),
          );
          return () =>
            lifecycleService.transitionForTechnician({
              technicianId: technicianId.toHexString(),
              workOrderId: order._id.toString(),
              from: ['waiting_parts'],
              to: 'in_progress',
            });
        },
      },
      {
        name: 'technician_close',
        maxMongoOps: 2,
        setup: async () => {
          const order = await workOrderModel.create(
            workOrder({ technician_id: technicianId, status: 'in_progress' }),
          );
          const savedReport = await reportModel.create(
            report(order._id, technicianId),
          );
          return () =>
            lifecycleService.closeForTechnician({
              technicianId: technicianId.toHexString(),
              workOrderId: order._id.toString(),
              report: savedReport,
            });
        },
      },
      validationOperation(
        'validation_approve',
        'approve',
        lifecycleService,
        workOrderModel,
        reportModel,
        technicianId,
        validatorId,
      ),
      validationOperation(
        'validation_reject',
        'reject',
        lifecycleService,
        workOrderModel,
        reportModel,
        technicianId,
        validatorId,
      ),
      validationOperation(
        'validation_request_correction',
        'request_correction',
        lifecycleService,
        workOrderModel,
        reportModel,
        technicianId,
        validatorId,
      ),
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
        `Lifecycle benchmark exceeded query budget for: ${failures
          .map((failure) => failure.name)
          .join(', ')}`,
      );
    }
  } finally {
    await connection.close();
    await mongod.stop();
  }
}

function validationOperation(
  name: string,
  action: 'approve' | 'reject' | 'request_correction',
  lifecycleService: WorkOrderLifecycleService,
  workOrderModel: any,
  reportModel: any,
  technicianId: Types.ObjectId,
  validatorId: Types.ObjectId,
): BenchmarkOperation {
  return {
    name,
    maxMongoOps: 4,
    setup: async () => {
      const order = await workOrderModel.create(
        workOrder({
          technician_id: technicianId,
          status: 'waiting_validation',
        }),
      );
      await reportModel.create(report(order._id, technicianId));
      return () =>
        lifecycleService.applyValidationAction({
          workOrderId: order._id.toString(),
          action,
          validatorId: validatorId.toHexString(),
        });
    },
  };
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

function workOrder(overrides: Record<string, unknown> = {}) {
  return {
    ot_id: `WO-${new Types.ObjectId().toHexString()}`,
    machine_id: new Types.ObjectId(),
    type_maintenance: 'corrective',
    status: 'pending',
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
