import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types, createConnection } from 'mongoose';
import { WorkOrder, WorkOrderSchema } from '../src/schemas/work-order.schema';
import { Machine, MachineSchema } from '../src/schemas/machine.schema';
import {
  Module as ModuleEntity,
  ModuleSchema,
} from '../src/schemas/module.schema';
import {
  MaintenancePlan,
  MaintenancePlanSchema,
} from '../src/schemas/maintenance-plan.schema';
import {
  MachineType,
  MachineTypeSchema,
} from '../src/schemas/machine-type.schema';
import {
  DocumentEntity,
  DocumentSchema,
} from '../src/schemas/document.schema';
import { OTPieces, OTPiecesSchema } from '../src/schemas/ot-pieces.schema';
import {
  InterventionReport,
  InterventionReportSchema,
} from '../src/schemas/intervention-report.schema';
import { User, UserSchema } from '../src/schemas/user.schema';
import { Panne, PanneSchema } from '../src/schemas/panne.schema';
import {
  PanneSolution,
  PanneSolutionSchema,
} from '../src/schemas/panne-solution.schema';
import { Stock, StockSchema } from '../src/schemas/stock.schema';
import { KpiService } from '../src/kpi/kpi.service';
import { MaintenanceSchedulingService } from '../src/work-orders/maintenance-scheduling.service';
import { WorkOrderCalendarQueryService } from '../src/work-orders/services/work-order-calendar-query.service';
import { WorkOrderDashboardQueryService } from '../src/work-orders/services/work-order-dashboard-query.service';
import { WorkOrderAssistantContextService } from '../src/work-orders/services/work-order-assistant-context.service';
import { WorkOrderReportService } from '../src/work-orders/services/work-order-report.service';
import { WorkOrderNotificationService } from '../src/work-orders/services/work-order-notification.service';
import { WorkOrderLifecycleService } from '../src/work-orders/services/work-order-lifecycle.service';
import { WorkOrderPreventiveSchedulingService } from '../src/work-orders/services/work-order-preventive-scheduling.service';
import { CounterService } from '../src/counters/counter.service';
import { Counter, CounterSchema } from '../src/counters/counter.schema';
import { Lubrifiant, LubrifiantSchema } from '../src/schemas/lubrifiant.schema';
import {
  LubrificationLog,
  LubrificationLogSchema,
} from '../src/schemas/lubrification-log.schema';
import { Mesure, MesureSchema } from '../src/schemas/mesure.schema';

// Regression evidence only: MongoMemoryReplSet numbers are useful for
// catching a query-count/latency regression between runs of this script,
// not as production capacity planning.

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

const SAMPLES = Number(process.env.WORK_ORDER_PROJECTIONS_BENCHMARK_SAMPLES ?? 15);
const MACHINE_COUNT = Number(
  process.env.WORK_ORDER_PROJECTIONS_BENCHMARK_MACHINES ?? 200,
);
const WORK_ORDER_COUNT = Number(
  process.env.WORK_ORDER_PROJECTIONS_BENCHMARK_ORDERS ?? 1500,
);

const noopNotificationService: Pick<
  WorkOrderNotificationService,
  'notifyCorrectiveAwaitingValidation' | 'notifyValidationDecision'
> = {
  notifyCorrectiveAwaitingValidation: () => Promise.resolve(null as never),
  notifyValidationDecision: () => Promise.resolve(null as never),
};

async function main() {
  const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const connection = await createConnection(mongod.getUri()).asPromise();

  try {
    const workOrderModel = connection.model(WorkOrder.name, WorkOrderSchema);
    const machineModel = connection.model(Machine.name, MachineSchema);
    const moduleModel = connection.model(ModuleEntity.name, ModuleSchema);
    const maintenancePlanModel = connection.model(
      MaintenancePlan.name,
      MaintenancePlanSchema,
    );
    const machineTypeModel = connection.model(
      MachineType.name,
      MachineTypeSchema,
    );
    const documentModel = connection.model(
      DocumentEntity.name,
      DocumentSchema,
    );
    const otPiecesModel = connection.model(OTPieces.name, OTPiecesSchema);
    const reportModel = connection.model(
      InterventionReport.name,
      InterventionReportSchema,
    );
    const userModel = connection.model(User.name, UserSchema);
    const panneModel = connection.model(Panne.name, PanneSchema);
    const panneSolutionModel = connection.model(
      PanneSolution.name,
      PanneSolutionSchema,
    );
    const stockModel = connection.model(Stock.name, StockSchema);
    const counterModel = connection.model(Counter.name, CounterSchema);
    const lubrifiantModel = connection.model(
      Lubrifiant.name,
      LubrifiantSchema,
    );
    const lubricationLogModel = connection.model(
      LubrificationLog.name,
      LubrificationLogSchema,
    );
    // WorkOrderDashboardQueryService reaches this via the raw connection
    // registry (`workOrderModel.db.model('Mesure')`), the same way the
    // production app relies on the device-monitoring module having already
    // registered it — this standalone script has to register it too.
    connection.model(Mesure.name, MesureSchema);

    await Promise.all(
      [
        workOrderModel,
        machineModel,
        moduleModel,
        maintenancePlanModel,
        machineTypeModel,
        documentModel,
        otPiecesModel,
        reportModel,
        userModel,
        panneModel,
        panneSolutionModel,
        stockModel,
        counterModel,
        lubrifiantModel,
        lubricationLogModel,
      ].map((model) => model.syncIndexes()),
    );

    const schedulingService = new MaintenanceSchedulingService();
    const counterService = new CounterService(counterModel as never);
    const kpiService = new KpiService(
      workOrderModel as never,
      stockModel as never,
      machineModel as never,
      userModel as never,
    );
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
    const calendarService = new WorkOrderCalendarQueryService(
      workOrderModel as never,
      machineModel as never,
      moduleModel as never,
      maintenancePlanModel as never,
      machineTypeModel as never,
      documentModel as never,
      otPiecesModel as never,
      reportModel as never,
      userModel as never,
      schedulingService,
      reportService,
    );
    const dashboardService = new WorkOrderDashboardQueryService(
      workOrderModel as never,
      machineModel as never,
      moduleModel as never,
      maintenancePlanModel as never,
      reportModel as never,
      schedulingService,
      kpiService,
    );
    const assistantService = new WorkOrderAssistantContextService(
      panneModel as never,
      panneSolutionModel as never,
      documentModel as never,
    );

    // --- Seed a realistic-shaped fleet ---
    const machineTypeDoc = await machineTypeModel.create({
      type_id: 1,
      name: 'Braiding Machine',
    });
    const machines = await machineModel.insertMany(
      Array.from({ length: MACHINE_COUNT }, (_, index) =>
        machineRow(machineTypeDoc._id, index),
      ),
    );
    const technicianIds = Array.from(
      { length: 25 },
      () => new Types.ObjectId(),
    );
    await userModel.insertMany(
      technicianIds.map((id) => userRow(id)),
    );
    const modules = await moduleModel.insertMany(
      machines
        .slice(0, 50)
        .map((machine) => moduleRow(machine._id)),
    );
    const plans = await maintenancePlanModel.insertMany(
      modules.map((module) => planRow(module._id)),
    );

    await workOrderModel.insertMany(
      Array.from({ length: WORK_ORDER_COUNT }, (_, index) =>
        workOrderRow({
          machineId: machines[index % machines.length]._id,
          technicianId: technicianIds[index % technicianIds.length],
          planId: index % 3 === 0 ? plans[index % plans.length]._id : undefined,
          index,
        }),
      ),
    );

    const benchMachine = machines[0];
    const benchTechnicianId = technicianIds[0];
    const detailOrder = await workOrderModel.create(
      workOrderRow({
        machineId: benchMachine._id,
        technicianId: benchTechnicianId,
        planId: plans[0]._id,
        index: 999_999,
      }),
    );

    const operations: BenchmarkOperation[] = [
      {
        name: 'statistics',
        // KpiService.getAdminDashboard() runs several month-boundary counts
        // internally, plus this method's own pending-maintenance count.
        maxMongoOps: 12,
        setup: async () => () => dashboardService.getStatistics(),
      },
      {
        name: 'operator_dashboard_widget',
        maxMongoOps: 2,
        setup: async () => () =>
          dashboardService.getCalendarWidgetForOperator(
            benchTechnicianId.toHexString(),
          ),
      },
      {
        name: 'technician_notification_cards',
        maxMongoOps: 5,
        setup: async () => () =>
          dashboardService.getNotificationCardsForOperator(
            benchTechnicianId.toHexString(),
          ),
      },
      {
        name: 'calendar_range',
        // One find() for the range, plus a handful of cached machine-type
        // lookups — resolveMachine/Module/Plan/technician all hit the
        // already-populated fast path per row, so this must stay flat
        // regardless of how many work orders fall in the range (no N+1).
        maxMongoOps: 6,
        setup: async () => () =>
          calendarService.getCalendarEvents('month', new Date(), {}),
      },
      {
        name: 'calendar_event_detail',
        // work order + machine + machine type + plan + documents + otPieces
        // + reports (+ the corrective-fault lookup's two queries).
        maxMongoOps: 11,
        setup: async () => () =>
          calendarService.getCalendarEventDetails(detailOrder._id.toString()),
      },
      {
        name: 'machine_preventive_states',
        // machine existence check + modules + plans + orders (+ populate).
        maxMongoOps: 5,
        setup: async () => () =>
          dashboardService.getMachinePreventiveStates(
            benchMachine._id.toString(),
          ),
      },
      {
        name: 'assistant_context',
        maxMongoOps: 3,
        setup: async () => () =>
          assistantService.getCorrectiveAssistant(benchMachine._id.toString()),
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
        `Projections benchmark exceeded query budget for: ${failures
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
  let observedMongoOps = 0;
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
    observedMongoOps = Math.max(observedMongoOps, observed.length);
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
    observedMongoOps,
    methods: Object.fromEntries(methodTotals),
  };
}

function machineRow(typeId: Types.ObjectId, index: number) {
  return {
    machine_id: `M-${index}-${new Types.ObjectId().toHexString()}`,
    type_id: typeId,
    serial_no: `SN-${index}-${new Types.ObjectId().toHexString()}`,
    status: 'active',
    model: 'Bench Machine',
  };
}

function userRow(id: Types.ObjectId) {
  const fixturePasswordHash = createHash('sha256')
    .update(`benchmark-fixture-${id.toHexString()}`)
    .digest('hex');

  return {
    _id: id,
    user_id: `U-${id.toHexString()}`,
    nom_complet: 'Bench Technician',
    email: `${id.toHexString()}@bench.test`,
    password: fixturePasswordHash,
    role: 'technician',
  };
}

function moduleRow(machineId: Types.ObjectId) {
  return {
    module_id: `MOD-${new Types.ObjectId().toHexString()}`,
    machine_id: machineId,
    mod_type_id: new Types.ObjectId(),
    localisation: 'Bay 1',
  };
}

function planRow(moduleId: Types.ObjectId) {
  return {
    plan_id: `PLAN-${new Types.ObjectId().toHexString()}`,
    module_id: moduleId,
    type_maintenance: 'preventive',
    frequence: 1,
    unite_frequence: 'monthly',
    instruction: 'Inspect and lubricate',
    maintenance_code: `MC-${new Types.ObjectId().toHexString()}`,
  };
}

function workOrderRow(input: {
  machineId: Types.ObjectId;
  technicianId: Types.ObjectId;
  planId?: Types.ObjectId;
  index: number;
}) {
  const now = new Date();
  const dueDate = new Date(now.getTime() + (input.index % 30) * 86_400_000);
  const isCorrective = input.index % 4 === 0;
  return {
    ot_id: `WO-${input.index}-${new Types.ObjectId().toHexString()}`,
    machine_id: input.machineId,
    technician_id: input.technicianId,
    plan_id: input.planId,
    type_maintenance: isCorrective ? 'corrective' : 'preventive',
    status: ['scheduled', 'in_progress', 'waiting_validation', 'completed'][
      input.index % 4
    ],
    priorite: ['low', 'medium', 'high', 'urgent'][input.index % 4],
    due_date: dueDate,
    date_created: now,
    code_panne: isCorrective ? `F-${input.index % 10}` : undefined,
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
