/* eslint-disable no-console */
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const mongoUri =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  'mongodb://localhost:27017/gmao';

const workOrderSchema = new mongoose.Schema({}, { strict: false });
const WorkOrder = mongoose.model('WorkOrder', workOrderSchema, 'workorders');

// Mirrors backend/src/common/maintenance-type.ts's isCorrectiveMaintenanceType
// — this plain-JS script (no ts-node build step) can't import the shared TS
// helper, so the same "is NOT corrective" rule (covers preventive,
// lubrication, inspection, and any custom scheduled-maintenance label) is
// duplicated here inline.
function isCorrectiveType(type) {
  return /correct/i.test(String(type || ''));
}

function hasRealDueDate(order) {
  return Boolean(order.due_date || order.scheduled_date || order.date_start);
}

function hasHistoricalCompletion(order) {
  return ['completed', 'validated'].includes(String(order.status || '').toLowerCase())
    || Boolean(order.execution_date || order.date_end || order.date_closed);
}

function classify(order) {
  if (isCorrectiveType(order.type_maintenance)) {
    return 'Needs manual review';
  }

  if (hasHistoricalCompletion(order)) {
    return 'Legitimate historical occurrence';
  }

  if (hasRealDueDate(order)) {
    return 'Legitimate scheduled occurrence';
  }

  if (String(order.status || '').toLowerCase() === 'overdue') {
    return 'Safe to repair';
  }

  return 'Needs manual review';
}

async function main() {
  const apply = process.argv.includes('--apply');
  const seedTest = process.argv.includes('--seed-test');
  let memoryServer;
  const uri = seedTest
    ? await MongoMemoryServer.create().then((server) => {
        memoryServer = server;
        return server.getUri('gmao_preventive_audit_test');
      })
    : mongoUri;

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });

  if (seedTest) {
    await seedRepresentativeAuditData();
  }

  const rows = await WorkOrder.find({
    type_maintenance: { $not: /correct/i },
  })
    .sort({ date_created: -1 })
    .lean();

  const buckets = {
    'Safe to repair': [],
    'Needs manual review': [],
    'Legitimate scheduled occurrence': [],
    'Legitimate historical occurrence': [],
  };

  for (const row of rows) {
    buckets[classify(row)].push(row);
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    scanned: rows.length,
    counts: Object.fromEntries(
      Object.entries(buckets).map(([key, value]) => [key, value.length]),
    ),
    safeToRepairPreview: buckets['Safe to repair'].slice(0, 25).map((row) => ({
      _id: String(row._id),
      ot_id: row.ot_id,
      before: { status: row.status },
      after: { status: 'not_scheduled' },
      reason: 'Preventive work order has overdue status without any real due/scheduled/execution date.',
    })),
    rollback: 'Restore status from the before.status values printed by this dry-run output or from database backup.',
  }, null, 2));

  if (apply && buckets['Safe to repair'].length > 0) {
    if (seedTest) {
      console.log('Apply skipped: --seed-test mode is dry-run only.');
      await mongoose.disconnect();
      if (memoryServer) await memoryServer.stop();
      return;
    }
    const ids = buckets['Safe to repair'].map((row) => row._id);
    const result = await WorkOrder.updateMany(
      { _id: { $in: ids } },
      { $set: { status: 'not_scheduled' } },
    );
    console.log(`Applied updates: ${result.modifiedCount}`);
  }

  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
}

async function seedRepresentativeAuditData() {
  const machine = new mongoose.Types.ObjectId();
  const moduleId = new mongoose.Types.ObjectId();
  const plan = new mongoose.Types.ObjectId();
  await WorkOrder.deleteMany({});
  await WorkOrder.insertMany([
    {
      ot_id: 'AUDIT-FALSE-OVERDUE',
      machine_id: machine,
      module_id: moduleId,
      plan_id: plan,
      type_maintenance: 'preventive',
      status: 'overdue',
      date_created: new Date('2026-07-01T00:00:00.000Z'),
    },
    {
      ot_id: 'AUDIT-SCHEDULED',
      machine_id: machine,
      module_id: moduleId,
      plan_id: plan,
      type_maintenance: 'preventive',
      status: 'scheduled',
      date_created: new Date('2026-07-01T00:00:00.000Z'),
      due_date: new Date('2026-08-14T00:00:00.000Z'),
      scheduled_date: new Date('2026-08-14T00:00:00.000Z'),
    },
    {
      ot_id: 'AUDIT-HISTORICAL',
      machine_id: machine,
      module_id: moduleId,
      plan_id: plan,
      type_maintenance: 'preventive',
      status: 'validated',
      date_created: new Date('2026-07-01T00:00:00.000Z'),
      execution_date: new Date('2026-07-14T00:00:00.000Z'),
      due_date: new Date('2026-07-14T00:00:00.000Z'),
    },
    {
      ot_id: 'AUDIT-MANUAL-REVIEW',
      machine_id: machine,
      type_maintenance: 'preventive',
      status: 'pending',
      date_created: new Date('2026-07-01T00:00:00.000Z'),
    },
  ]);
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exitCode = 1;
});
