import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types, createConnection } from 'mongoose';
import { RECOMMENDED_MONGODB_INDEXES } from '../database/recommended-indexes';
import { runIndexManager } from '../database/index-manager';
import { WorkOrder, WorkOrderSchema } from '../schemas/work-order.schema';
import {
  PREVENTIVE_OCCURRENCE_KEY_INDEX_NAME,
  PREVENTIVE_OCCURRENCE_KEY_PARTIAL_FILTER,
  buildPreventiveOccurrenceKey,
  isDuplicatePreventiveOccurrenceKeyError,
} from './preventive-occurrence-key';

describe('preventive occurrence key canonicalization', () => {
  const machineId = new Types.ObjectId();
  const moduleId = new Types.ObjectId();
  const planId = new Types.ObjectId();

  it('normalizes ObjectId instances, strings, casing, and UTC timestamp deterministically', () => {
    const fromObjects = buildPreventiveOccurrenceKey({
      maintenanceType: ' Preventive ',
      machineId,
      moduleId,
      planId,
      dueDate: new Date('2026-02-28T23:30:00.123Z'),
    });
    const fromStrings = buildPreventiveOccurrenceKey({
      maintenanceType: 'preventive',
      machineId: machineId.toHexString().toUpperCase(),
      moduleId: moduleId.toHexString().toUpperCase(),
      planId: planId.toHexString().toUpperCase(),
      dueDate: new Date('2026-02-28T23:30:00.123Z'),
    });

    expect(fromObjects).toBe(fromStrings);
    expect(fromObjects).toBe(
      `preventive:v1:preventive:${machineId.toHexString()}:${moduleId.toHexString()}:${planId.toHexString()}:2026-02-28T23:30:00.123Z`,
    );
  });

  it('keeps month-end, leap-year, plan, module, and occurrence timestamps distinct', () => {
    const base = {
      maintenanceType: 'inspection',
      machineId,
      moduleId,
      planId,
    };
    const leap = buildPreventiveOccurrenceKey({
      ...base,
      dueDate: new Date('2024-02-29T00:00:00.000Z'),
    });
    const monthEnd = buildPreventiveOccurrenceKey({
      ...base,
      dueDate: new Date('2026-01-31T00:00:00.000Z'),
    });
    const otherPlan = buildPreventiveOccurrenceKey({
      ...base,
      planId: new Types.ObjectId(),
      dueDate: new Date('2024-02-29T00:00:00.000Z'),
    });
    const otherModule = buildPreventiveOccurrenceKey({
      ...base,
      moduleId: new Types.ObjectId(),
      dueDate: new Date('2024-02-29T00:00:00.000Z'),
    });

    expect(new Set([leap, monthEnd, otherPlan, otherModule]).size).toBe(4);
  });
});

describe('preventive occurrence unique index behavior', () => {
  let mongod: MongoMemoryServer;
  let connection: Connection;
  let workOrderModel: any;

  beforeEach(async () => {
    mongod = await MongoMemoryServer.create();
    connection = await createConnection(mongod.getUri()).asPromise();
    workOrderModel = connection.model(WorkOrder.name, WorkOrderSchema);
    await workOrderModel.syncIndexes();
  }, 60_000);

  afterEach(async () => {
    await connection.close();
    await mongod.stop();
  });

  function row(overrides: Record<string, unknown> = {}) {
    return {
      ot_id: `WO-${new Types.ObjectId().toHexString()}`,
      machine_id: new Types.ObjectId(),
      type_maintenance: 'preventive',
      status: 'pending',
      date_created: new Date(),
      ...overrides,
    };
  }

  it('allows legacy missing, null, empty, corrective, and malformed keys while rejecting duplicate valid keys', async () => {
    await workOrderModel.create(row());
    await workOrderModel.create(row());
    await workOrderModel.create(row({ preventive_occurrence_key: null }));
    await workOrderModel.create(row({ preventive_occurrence_key: null }));
    await workOrderModel.create(row({ preventive_occurrence_key: '' }));
    await workOrderModel.create(row({ preventive_occurrence_key: '' }));
    await workOrderModel.create(
      row({
        type_maintenance: 'corrective',
        preventive_occurrence_key: 'legacy-malformed-key',
      }),
    );
    await workOrderModel.create(
      row({ preventive_occurrence_key: 'legacy-malformed-key' }),
    );

    const firstKey = buildPreventiveOccurrenceKey({
      maintenanceType: 'preventive',
      machineId: new Types.ObjectId(),
      moduleId: new Types.ObjectId(),
      planId: new Types.ObjectId(),
      dueDate: new Date('2026-08-02T10:00:00.000Z'),
    });
    const secondKey = buildPreventiveOccurrenceKey({
      maintenanceType: 'preventive',
      machineId: new Types.ObjectId(),
      moduleId: new Types.ObjectId(),
      planId: new Types.ObjectId(),
      dueDate: new Date('2026-08-03T10:00:00.000Z'),
    });

    await workOrderModel.create(row({ preventive_occurrence_key: firstKey }));
    await workOrderModel.create(row({ preventive_occurrence_key: secondKey }));
    await expect(
      workOrderModel.create(row({ preventive_occurrence_key: firstKey })),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('keeps schema, registry, dry-run, and apply definitions aligned', async () => {
    const schemaIndex = WorkOrderSchema.indexes().find(
      ([, options]) => options?.name === PREVENTIVE_OCCURRENCE_KEY_INDEX_NAME,
    );
    const registryIndex = RECOMMENDED_MONGODB_INDEXES.find(
      (index) => index.name === PREVENTIVE_OCCURRENCE_KEY_INDEX_NAME,
    );

    expect(schemaIndex?.[0]).toEqual({ preventive_occurrence_key: 1 });
    expect(schemaIndex?.[1]?.unique).toBe(true);
    expect(schemaIndex?.[1]?.partialFilterExpression).toEqual(
      PREVENTIVE_OCCURRENCE_KEY_PARTIAL_FILTER,
    );
    expect(registryIndex?.options?.partialFilterExpression).toEqual(
      PREVENTIVE_OCCURRENCE_KEY_PARTIAL_FILTER,
    );

    await connection.db
      ?.collection('workorders')
      .dropIndex(PREVENTIVE_OCCURRENCE_KEY_INDEX_NAME);
    await connection.close();
    const uri = mongod.getUri();
    const logger = { log: jest.fn(), error: jest.fn() };
    const dryRun = await runIndexManager({
      uri,
      indexes: [registryIndex!],
      logger,
    });
    expect(dryRun).toEqual([expect.objectContaining({ status: 'missing' })]);
    const applied = await runIndexManager({
      uri,
      apply: true,
      indexes: [registryIndex!],
      logger,
    });
    expect(applied).toEqual([expect.objectContaining({ status: 'missing' })]);
    const rerun = await runIndexManager({
      uri,
      indexes: [registryIndex!],
      logger,
    });
    expect(rerun).toEqual([expect.objectContaining({ status: 'exists' })]);
    connection = await createConnection(uri).asPromise();
  }, 60_000);
});

describe('preventive occurrence duplicate-key classification', () => {
  it('only suppresses duplicate errors for the occurrence-key index', () => {
    const key = buildPreventiveOccurrenceKey({
      maintenanceType: 'preventive',
      machineId: new Types.ObjectId(),
      moduleId: new Types.ObjectId(),
      planId: new Types.ObjectId(),
      dueDate: new Date('2026-08-02T10:00:00.000Z'),
    });

    expect(
      isDuplicatePreventiveOccurrenceKeyError(
        { code: 11000, index: PREVENTIVE_OCCURRENCE_KEY_INDEX_NAME },
        key,
      ),
    ).toBe(true);
    expect(
      isDuplicatePreventiveOccurrenceKeyError(
        { code: 11000, keyPattern: { preventive_occurrence_key: 1 } },
        key,
      ),
    ).toBe(true);
    expect(
      isDuplicatePreventiveOccurrenceKeyError(
        { code: 11000, keyPattern: { ot_id: 1 } },
        key,
      ),
    ).toBe(false);
  });
});
