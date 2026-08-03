import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types, createConnection } from 'mongoose';
import { runPreventiveOccurrenceAudit } from '../../scripts/preventive-occurrences-audit';
import { WorkOrder, WorkOrderSchema } from '../schemas/work-order.schema';
import { buildPreventiveOccurrenceKey } from './preventive-occurrence-key';

describe('preventive occurrence audit script', () => {
  let mongod: MongoMemoryServer;
  let connection: Connection;
  let workOrderModel: any;
  let logger: { log: jest.Mock; error: jest.Mock };

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    connection = await createConnection(mongod.getUri()).asPromise();
    workOrderModel = connection.model(WorkOrder.name, WorkOrderSchema);
  }, 60_000);

  afterAll(async () => {
    await connection.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    logger = { log: jest.fn(), error: jest.fn() };
    await workOrderModel.deleteMany({});
  });

  function row(overrides: Record<string, unknown> = {}) {
    return {
      ot_id: `WO-${new Types.ObjectId().toHexString()}`,
      machine_id: new Types.ObjectId(),
      module_id: new Types.ObjectId(),
      plan_id: new Types.ObjectId(),
      type_maintenance: 'preventive',
      status: 'pending',
      date_created: new Date('2026-08-01T00:00:00.000Z'),
      due_date: new Date('2026-08-10T08:00:00.000Z'),
      description: 'must not be printed',
      ...overrides,
    };
  }

  it('reports key gaps, malformed values, valid duplicate groups, and legacy duplicate groups without writing data', async () => {
    const machineId = new Types.ObjectId();
    const moduleId = new Types.ObjectId();
    const planId = new Types.ObjectId();
    const duplicateKey = buildPreventiveOccurrenceKey({
      maintenanceType: 'preventive',
      machineId,
      moduleId,
      planId,
      dueDate: new Date('2026-08-10T08:00:00.000Z'),
    });

    await workOrderModel.collection.insertMany([
      row({ machine_id: machineId, module_id: moduleId, plan_id: planId }),
      row({ preventive_occurrence_key: null }),
      row({ preventive_occurrence_key: '' }),
      row({ preventive_occurrence_key: 'legacy-malformed' }),
      row({
        ot_id: 'WO-VALID-DUP-1',
        machine_id: machineId,
        module_id: moduleId,
        plan_id: planId,
        preventive_occurrence_key: duplicateKey,
      }),
      row({
        ot_id: 'WO-VALID-DUP-2',
        machine_id: machineId,
        module_id: moduleId,
        plan_id: planId,
        preventive_occurrence_key: duplicateKey,
      }),
      row({
        machine_id: machineId,
        module_id: moduleId,
        plan_id: planId,
        status: 'cancelled',
      }),
      row({
        type_maintenance: 'corrective',
        machine_id: machineId,
        module_id: moduleId,
        plan_id: planId,
      }),
    ]);

    const before = await workOrderModel.countDocuments();
    const result = await runPreventiveOccurrenceAudit({
      uri: mongod.getUri(),
      logger,
      groupLimit: 10,
      batchSize: 2,
    });
    const after = await workOrderModel.countDocuments();

    expect(after).toBe(before);
    expect(result.totals.workOrders).toBe(8);
    expect(result.totals.preventiveLikeWorkOrders).toBe(7);
    expect(result.totals.withValidOccurrenceKeys).toBe(2);
    expect(result.totals.withoutOccurrenceKeys).toBe(3);
    expect(result.totals.nullOccurrenceKeys).toBe(1);
    expect(result.totals.emptyOccurrenceKeys).toBe(1);
    expect(result.totals.malformedOccurrenceKeys).toBe(1);
    expect(result.duplicateValidOccurrenceKeys).toEqual([
      expect.objectContaining({ key: duplicateKey, count: 2 }),
    ]);
    expect(result.potentialLegacyDuplicateGroups.length).toBeGreaterThan(0);
    expect(JSON.stringify(logger.log.mock.calls)).not.toContain(
      'must not be printed',
    );
  });

  it('handles large seeded data in bounded cursor batches', async () => {
    await workOrderModel.collection.insertMany(
      Array.from({ length: 1200 }, (_, index) =>
        row({
          ot_id: `WO-LARGE-${index}`,
          due_date: new Date(2026, 0, 1 + (index % 28), 8),
        }),
      ),
    );

    const result = await runPreventiveOccurrenceAudit({
      uri: mongod.getUri(),
      logger,
      groupLimit: 5,
      batchSize: 25,
    });

    expect(result.totals.workOrders).toBe(1200);
    expect(result.potentialLegacyDuplicateGroups.length).toBeLessThanOrEqual(5);
  }, 60_000);
});
