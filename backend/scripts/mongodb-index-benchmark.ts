import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IndexSpecification } from 'mongodb';
import mongoose from 'mongoose';
import { RECOMMENDED_MONGODB_INDEXES } from '../src/database/recommended-indexes';

type ExplainSummary = {
  label: string;
  stage: string;
  indexName?: string;
  totalKeysExamined: number;
  totalDocsExamined: number;
  nReturned: number;
  executionTimeMillis: number;
  hasBlockingSort: boolean;
};

const SAMPLE_MACHINE_ID = new mongoose.Types.ObjectId();
const SAMPLE_TECHNICIAN_ID = new mongoose.Types.ObjectId();
const SAMPLE_MODULE_ID = new mongoose.Types.ObjectId();
const SAMPLE_USER_ID = new mongoose.Types.ObjectId();

function findPlanStage(
  plan: unknown,
  stages: string[],
): Record<string, unknown> | null {
  if (!plan || typeof plan !== 'object') return null;
  const node = plan as Record<string, unknown>;
  if (typeof node.stage === 'string' && stages.includes(node.stage)) {
    return node;
  }

  return findPlanStageInValues(Object.values(node), stages);
}

function findPlanStageInValues(
  values: unknown[],
  stages: string[],
): Record<string, unknown> | null {
  for (const value of values) {
    const found = Array.isArray(value)
      ? findPlanStageInValues(value, stages)
      : findPlanStage(value, stages);
    if (found) return found;
  }

  return null;
}

function getWinningStage(
  ixscan: Record<string, unknown> | null,
  collscan: Record<string, unknown> | null,
): string {
  if (ixscan) return 'IXSCAN';
  if (collscan) return 'COLLSCAN';
  return 'UNKNOWN';
}

function summarize(
  label: string,
  explain: Record<string, unknown>,
): ExplainSummary {
  const executionStats = explain.executionStats as Record<string, unknown>;
  const plan = executionStats.executionStages ?? explain.queryPlanner;
  const ixscan = findPlanStage(plan, ['IXSCAN']);
  const collscan = findPlanStage(plan, ['COLLSCAN']);
  const sort = findPlanStage(plan, ['SORT']);
  return {
    label,
    stage: getWinningStage(ixscan, collscan),
    indexName: ixscan?.indexName as string | undefined,
    totalKeysExamined: Number(executionStats.totalKeysExamined ?? 0),
    totalDocsExamined: Number(executionStats.totalDocsExamined ?? 0),
    nReturned: Number(executionStats.nReturned ?? 0),
    executionTimeMillis: Number(executionStats.executionTimeMillis ?? 0),
    hasBlockingSort: Boolean(sort),
  };
}

async function explainFind(
  collection: string,
  label: string,
  filter: Record<string, unknown>,
  sort: Record<string, 1 | -1>,
  limit = 25,
): Promise<ExplainSummary> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not ready');
  const explain = (await db
    .collection(collection)
    .find(filter)
    .sort(sort)
    .limit(limit)
    .explain('executionStats')) as Record<string, unknown>;
  return summarize(label, explain);
}

async function seed() {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not ready');
  const now = Date.now();

  await db.collection('workorders').insertMany(
    Array.from({ length: 40_000 }, (_, index) => ({
      ot_id: `WO-BENCH-${index}`,
      machine_id:
        index % 20 === 0 ? SAMPLE_MACHINE_ID : new mongoose.Types.ObjectId(),
      technician_id:
        index % 12 === 0 ? SAMPLE_TECHNICIAN_ID : new mongoose.Types.ObjectId(),
      status: ['open', 'in_progress', 'waiting_parts', 'completed'][index % 4],
      priorite: ['low', 'medium', 'urgent'][index % 3],
      type_maintenance: index % 5 === 0 ? 'corrective' : 'preventive',
      date_created: new Date(now - index * 60_000),
    })),
  );
  await db.collection('preventivetasks').insertMany(
    Array.from({ length: 20_000 }, (_, index) => ({
      task_id: `PT-BENCH-${index}`,
      module_id:
        index % 30 === 0 ? SAMPLE_MODULE_ID : new mongoose.Types.ObjectId(),
      status: index % 3 === 0 ? 'completed' : 'pending',
      instruction: `Task ${index}`,
      completed_at:
        index % 3 === 0 ? new Date(now - index * 60_000) : undefined,
      createdAt: new Date(now - index * 60_000),
      updatedAt: new Date(now - index * 60_000),
      ...(index % 17 === 0 ? { deleted_at: new Date(now) } : {}),
    })),
  );
  await db.collection('notifications').insertMany(
    Array.from({ length: 60_000 }, (_, index) => ({
      notification_id: `NOTIF-BENCH-${index}`,
      dedupe_key: `bench:${index}`,
      type: 'work_order_created',
      title: `Notification ${index}`,
      recipient_user_id:
        index % 10 === 0 ? SAMPLE_USER_ID : new mongoose.Types.ObjectId(),
      recipient_role: index % 10 === 0 ? undefined : 'operator',
      is_read: index % 4 === 0,
      createdAt: new Date(now - index * 30_000),
      updatedAt: new Date(now - index * 30_000),
    })),
  );
  await db.collection('stockmovements').insertMany(
    Array.from({ length: 40_000 }, (_, index) => ({
      movement_id: `SM-BENCH-${index}`,
      stock_id: new mongoose.Types.ObjectId(),
      part_id: new mongoose.Types.ObjectId(),
      work_order_id:
        index % 40 === 0 ? SAMPLE_MACHINE_ID : new mongoose.Types.ObjectId(),
      type: index % 2 === 0 ? 'consumption' : 'reservation',
      quantity_delta: -1,
      reserved_delta: 0,
      quantite_en_stock_after: 100,
      quantite_reservee_after: 0,
      createdAt: new Date(now - index * 30_000),
      updatedAt: new Date(now - index * 30_000),
    })),
  );
}

async function createRecommendedIndexes() {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not ready');
  for (const spec of RECOMMENDED_MONGODB_INDEXES) {
    await db
      .collection(spec.collection)
      .createIndex(spec.key as IndexSpecification, {
        ...spec.options,
        name: spec.name,
      });
  }
}

async function runBenchmark() {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), {
    autoCreate: false,
    autoIndex: false,
  });
  try {
    await seed();
    const before = [
      await explainFind(
        'workorders',
        'workorders by machine newest',
        { machine_id: SAMPLE_MACHINE_ID },
        { date_created: -1 },
      ),
      await explainFind(
        'workorders',
        'workorders by technician newest',
        { technician_id: SAMPLE_TECHNICIAN_ID },
        { date_created: -1 },
      ),
      await explainFind(
        'preventivetasks',
        'latest completed task by module',
        { module_id: SAMPLE_MODULE_ID, status: 'completed' },
        { completed_at: -1 },
        1,
      ),
      await explainFind(
        'notifications',
        'notifications by user newest',
        { recipient_user_id: SAMPLE_USER_ID },
        { createdAt: -1 },
      ),
      await explainFind(
        'stockmovements',
        'stock movement report newest',
        {},
        { createdAt: -1 },
      ),
    ];

    await createRecommendedIndexes();

    const after = [
      await explainFind(
        'workorders',
        'workorders by machine newest',
        { machine_id: SAMPLE_MACHINE_ID },
        { date_created: -1 },
      ),
      await explainFind(
        'workorders',
        'workorders by technician newest',
        { technician_id: SAMPLE_TECHNICIAN_ID },
        { date_created: -1 },
      ),
      await explainFind(
        'preventivetasks',
        'latest completed task by module',
        { module_id: SAMPLE_MODULE_ID, status: 'completed' },
        { completed_at: -1 },
        1,
      ),
      await explainFind(
        'notifications',
        'notifications by user newest',
        { recipient_user_id: SAMPLE_USER_ID },
        { createdAt: -1 },
      ),
      await explainFind(
        'stockmovements',
        'stock movement report newest',
        {},
        { createdAt: -1 },
      ),
    ];

    console.log(JSON.stringify({ before, after }, null, 2));
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
}

runBenchmark().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[mongodb-index-benchmark] ${message}`);
  process.exitCode = 1;
});
