import { MongoMemoryServer } from 'mongodb-memory-server';
import { RECOMMENDED_MONGODB_INDEXES } from './recommended-indexes';
import { indexEquivalent, planIndexes, runIndexManager } from './index-manager';
import { WorkOrderSchema } from '../schemas/work-order.schema';
import { PreventiveTaskSchema } from '../schemas/preventive-task.schema';
import { LubrificationLogSchema } from '../schemas/lubrification-log.schema';
import { InterventionReportSchema } from '../schemas/intervention-report.schema';
import { StockMovementSchema } from '../schemas/stock-movement.schema';
import { KPISchema } from '../schemas/kpi.schema';
import { GeneratedReportSchema } from '../schemas/generated-report.schema';
import { NotificationSchema } from '../schemas/notification.schema';
import { DeviceSchema } from '../schemas/device.schema';
import { UserSchema } from '../schemas/user.schema';

const schemaIndexes = [
  ...WorkOrderSchema.indexes(),
  ...PreventiveTaskSchema.indexes(),
  ...LubrificationLogSchema.indexes(),
  ...InterventionReportSchema.indexes(),
  ...StockMovementSchema.indexes(),
  ...KPISchema.indexes(),
  ...GeneratedReportSchema.indexes(),
  ...NotificationSchema.indexes(),
  ...DeviceSchema.indexes(),
  ...UserSchema.indexes(),
];

function schemaIndexByName(name: string) {
  return schemaIndexes.find(([, options]) => options?.name === name);
}

describe('recommended MongoDB indexes', () => {
  it('declares every recommended named index in schema metadata', () => {
    for (const spec of RECOMMENDED_MONGODB_INDEXES) {
      const declared = schemaIndexByName(spec.name);
      expect(declared).toBeDefined();
      expect(declared?.[0]).toEqual(spec.key);
      if (spec.options?.partialFilterExpression) {
        expect(declared?.[1]?.partialFilterExpression).toEqual(
          spec.options.partialFilterExpression,
        );
      }
    }
  });

  it('does not define duplicate recommended index names', () => {
    const names = RECOMMENDED_MONGODB_INDEXES.map((spec) => spec.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('recognizes equivalent existing indexes even when the names differ', () => {
    const [spec] = RECOMMENDED_MONGODB_INDEXES;
    expect(indexEquivalent({ name: 'legacy_name', key: spec.key }, spec)).toBe(
      true,
    );
  });

  it('plans only missing indexes and never marks unexpected indexes for deletion', () => {
    const [first, second] = RECOMMENDED_MONGODB_INDEXES;
    const existing = new Map([
      [
        first.collection,
        [
          { name: '_id_', key: { _id: 1 } },
          { name: 'unexpected_custom_index', key: { custom: 1 } },
          { name: first.name, key: first.key },
        ],
      ],
    ]);

    const plan = planIndexes(existing, [first, second]);

    expect(plan).toEqual([
      expect.objectContaining({ status: 'exists' }),
      expect.objectContaining({ status: 'missing' }),
    ]);
  });

  it('rejects malformed index-manager configuration safely', async () => {
    await expect(runIndexManager({ uri: '' })).rejects.toThrow(
      'MONGODB_URI is required',
    );
  });

  it('dry-runs, applies, and reruns idempotently without dropping unexpected indexes', async () => {
    const mongo = await MongoMemoryServer.create();
    const spec = RECOMMENDED_MONGODB_INDEXES[0];
    const logger = { log: jest.fn(), error: jest.fn() };

    try {
      const uri = mongo.getUri();
      const dryRun = await runIndexManager({
        uri,
        indexes: [spec],
        logger,
      });
      expect(dryRun).toEqual([expect.objectContaining({ status: 'missing' })]);

      const applied = await runIndexManager({
        uri,
        apply: true,
        indexes: [spec],
        logger,
      });
      expect(applied).toEqual([expect.objectContaining({ status: 'missing' })]);

      const mongoose = await import('mongoose');
      const connection = await mongoose
        .createConnection(uri, { autoCreate: false, autoIndex: false })
        .asPromise();
      await connection.db
        ?.collection(spec.collection)
        .createIndex({ unexpected_field: 1 }, { name: 'unexpected_index' });
      await connection.close();

      const rerun = await runIndexManager({
        uri,
        indexes: [spec],
        logger,
      });
      expect(rerun).toEqual([expect.objectContaining({ status: 'exists' })]);

      const verifyConnection = await mongoose
        .createConnection(uri, { autoCreate: false, autoIndex: false })
        .asPromise();
      const indexes = await verifyConnection.db
        ?.collection(spec.collection)
        .indexes();
      await verifyConnection.close();
      expect(indexes?.some((index) => index.name === 'unexpected_index')).toBe(
        true,
      );
    } finally {
      await mongo.stop();
    }
  }, 60_000);
});
