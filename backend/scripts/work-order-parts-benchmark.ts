import { performance } from 'node:perf_hooks';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types, createConnection } from 'mongoose';
import { WorkOrder, WorkOrderSchema } from '../src/schemas/work-order.schema';
import { Catalogue, CatalogueSchema } from '../src/schemas/catalogue.schema';
import { Stock, StockSchema } from '../src/schemas/stock.schema';
import {
  StockMovement,
  StockMovementSchema,
} from '../src/schemas/stock-movement.schema';
import {
  PartRequest,
  PartRequestSchema,
} from '../src/schemas/part-request.schema';
import { Counter, CounterSchema } from '../src/counters/counter.schema';
import { CounterService } from '../src/counters/counter.service';
import { StockMovementsService } from '../src/stock-movements/stock-movements.service';
import { WorkOrderPartsService } from '../src/work-orders/services/work-order-parts.service';
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

const SAMPLES = Number(process.env.WORK_ORDER_PARTS_BENCHMARK_SAMPLES ?? 20);

// No-op notification stub: this benchmark measures the durable-write path
// (stock reservation, part-request state, movement ledger), not the
// notification-center's own broadcast fan-out, which the lifecycle
// benchmark also excludes for the same reason.
const notificationService: Pick<
  WorkOrderNotificationService,
  'notifyPartRequestCreated' | 'notifyPartRequestDecision'
> = {
  notifyPartRequestCreated: () => Promise.resolve(null as never),
  notifyPartRequestDecision: () => Promise.resolve(null as never),
};

async function main() {
  const mongod = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
  });
  const connection = await createConnection(mongod.getUri()).asPromise();

  try {
    const workOrderModel = connection.model(WorkOrder.name, WorkOrderSchema);
    const catalogueModel = connection.model(Catalogue.name, CatalogueSchema);
    const stockModel = connection.model(Stock.name, StockSchema);
    const stockMovementModel = connection.model(
      StockMovement.name,
      StockMovementSchema,
    );
    const partRequestModel = connection.model(
      PartRequest.name,
      PartRequestSchema,
    );
    const counterModel = connection.model(Counter.name, CounterSchema);
    await Promise.all([
      workOrderModel.syncIndexes(),
      catalogueModel.syncIndexes(),
      stockModel.syncIndexes(),
      stockMovementModel.syncIndexes(),
      partRequestModel.syncIndexes(),
      counterModel.syncIndexes(),
    ]);

    const counterService = new CounterService(counterModel as never);
    const stockMovementsService = new StockMovementsService(
      stockModel as never,
      stockMovementModel as never,
      partRequestModel as never,
      counterService,
    );
    const partsService = new WorkOrderPartsService(
      workOrderModel as never,
      catalogueModel as never,
      partRequestModel as never,
      stockModel as never,
      counterService,
      stockMovementsService,
      notificationService as WorkOrderNotificationService,
    );

    const technicianId = new Types.ObjectId();
    const catalogue = await catalogueModel.create(catalogueRow());

    const operations: BenchmarkOperation[] = [
      {
        name: 'create_request',
        // work order lookup + part lookup + duplicate-active-request
        // pre-check + PR-code counter increment + the create itself.
        maxMongoOps: 5,
        setup: async () => {
          const order = await workOrderModel.create(
            correctiveOrder(technicianId),
          );
          return () =>
            partsService.requestPartsForOperator({
              operatorId: technicianId.toHexString(),
              workOrderId: order._id.toString(),
              partId: catalogue._id.toString(),
              quantity: 2,
            });
        },
      },
      {
        name: 'approve_request',
        maxMongoOps: 6,
        setup: async () => {
          const order = await workOrderModel.create(
            correctiveOrder(technicianId),
          );
          await stockModel.create(stockRow(catalogue._id));
          const request = await partRequestModel.create(
            pendingRequest(order._id, catalogue._id, technicianId),
          );
          return () =>
            partsService.decidePartRequest({
              requestId: request._id.toString(),
              decision: 'approve',
              deciderId: technicianId.toHexString(),
            });
        },
      },
      {
        name: 'reject_request',
        // status-guarded update + the transaction's own findOne re-read.
        maxMongoOps: 2,
        setup: async () => {
          const order = await workOrderModel.create(
            correctiveOrder(technicianId),
          );
          const request = await partRequestModel.create(
            pendingRequest(order._id, catalogue._id, technicianId),
          );
          return () =>
            partsService.decidePartRequest({
              requestId: request._id.toString(),
              decision: 'reject',
              deciderId: technicianId.toHexString(),
            });
        },
      },
      {
        name: 'cancel_reservation',
        maxMongoOps: 6,
        setup: async () => {
          const order = await workOrderModel.create(
            correctiveOrder(technicianId),
          );
          const stock = await stockModel.create(
            stockRow(catalogue._id, { quantite_reservee: 2 }),
          );
          const request = await partRequestModel.create(
            pendingRequest(order._id, catalogue._id, technicianId, {
              status: 'reserved',
            }),
          );
          return () =>
            partsService.decidePartRequest({
              requestId: request._id.toString(),
              decision: 'cancel',
              deciderId: technicianId.toHexString(),
              reason: 'benchmark',
            });
        },
      },
      {
        name: 'list_work_order_movements',
        maxMongoOps: 2,
        setup: async () => {
          const stock = await stockModel.create(stockRow(catalogue._id));
          await stockMovementModel.insertMany(
            Array.from({ length: 10 }, () => movementRow(stock._id)),
          );
          return () => stockMovementsService.listForStock(
            stock._id.toString(),
            1,
            20,
            0,
          );
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
        `Parts benchmark exceeded query budget for: ${failures
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

function correctiveOrder(technicianId: Types.ObjectId) {
  return {
    ot_id: `WO-${new Types.ObjectId().toHexString()}`,
    machine_id: new Types.ObjectId(),
    technician_id: technicianId,
    type_maintenance: 'corrective',
    status: 'in_progress',
    date_created: new Date(),
  };
}

function catalogueRow() {
  return {
    part_id: `PART-${new Types.ObjectId().toHexString()}`,
    nom_piece: 'Bearing',
    ref_constructeur: 'REF-1',
  };
}

function stockRow(
  partId: Types.ObjectId,
  overrides: Record<string, unknown> = {},
) {
  return {
    stock_id: `STK-${new Types.ObjectId().toHexString()}`,
    part_id: partId,
    quantite_en_stock: 100,
    quantite_reservee: 0,
    ...overrides,
  };
}

function pendingRequest(
  workOrderId: Types.ObjectId,
  partId: Types.ObjectId,
  operatorId: Types.ObjectId,
  overrides: Record<string, unknown> = {},
) {
  return {
    request_id: `PR-${new Types.ObjectId().toHexString()}`,
    ot_id: workOrderId,
    part_id: partId,
    quantity: 2,
    requested_by: operatorId,
    status: 'pending',
    requested_at: new Date(),
    ...overrides,
  };
}

function movementRow(stockId: Types.ObjectId) {
  return {
    movement_id: `MOV-${new Types.ObjectId().toHexString()}`,
    type: 'adjustment',
    stock_id: stockId,
    part_id: new Types.ObjectId(),
    quantity_delta: 1,
    reserved_delta: 0,
    quantite_en_stock_after: 1,
    quantite_reservee_after: 0,
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
