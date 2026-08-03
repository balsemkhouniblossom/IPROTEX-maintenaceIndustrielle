import mongoose, { Connection } from 'mongoose';
import {
  PREVENTIVE_OCCURRENCE_KEY_PREFIX,
  PREVENTIVE_OCCURRENCE_KEY_PREFIX_END,
} from '../src/work-orders/preventive-occurrence-key';

export interface PreventiveOccurrenceAuditOptions {
  uri: string;
  json?: boolean;
  groupLimit?: number;
  batchSize?: number;
  logger?: Pick<Console, 'log' | 'error'>;
}

export interface PreventiveOccurrenceAuditResult {
  totals: {
    workOrders: number;
    preventiveLikeWorkOrders: number;
    withValidOccurrenceKeys: number;
    withoutOccurrenceKeys: number;
    nullOccurrenceKeys: number;
    emptyOccurrenceKeys: number;
    malformedOccurrenceKeys: number;
  };
  duplicateValidOccurrenceKeys: Array<{
    key: string;
    count: number;
    ids: string[];
  }>;
  potentialLegacyDuplicateGroups: Array<{
    classification: string;
    count: number;
    maintenanceType?: string;
    machineId?: string;
    moduleId?: string;
    planId?: string;
    dueDate?: string;
    statuses: string[];
    ids: string[];
  }>;
}

const PREVENTIVE_LIKE_FILTER = {
  type_maintenance: { $not: /correct/i },
};

function parseArgs(argv: string[]) {
  const options: {
    uri?: string;
    json?: boolean;
    groupLimit?: number;
    batchSize?: number;
  } = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    if (arg === '--uri') options.uri = argv[++index];
    if (arg === '--group-limit') options.groupLimit = Number(argv[++index]);
    if (arg === '--batch-size') options.batchSize = Number(argv[++index]);
  }

  return options;
}

function classifyLegacyDuplicate(statuses: string[]): string {
  const normalized = new Set(statuses.map((status) => status || 'unknown'));
  if (
    normalized.has('cancelled') ||
    normalized.has('canceled') ||
    normalized.has('rejected')
  ) {
    return 'cancelled_or_replacement_candidate';
  }
  if (normalized.has('completed') || normalized.has('validated')) {
    return 'historical_migration_artifact_candidate';
  }
  return 'ambiguous_manual_or_exact_duplicate_candidate';
}

async function collectDuplicateGroups<T>(
  connection: Connection,
  pipeline: Record<string, unknown>[],
  batchSize: number,
): Promise<T[]> {
  const cursor = connection.db
    ?.collection('workorders')
    .aggregate(pipeline, { allowDiskUse: true, cursor: { batchSize } });
  if (!cursor) return [];

  const rows: T[] = [];
  for await (const row of cursor) {
    rows.push(row as T);
  }
  return rows;
}

export async function runPreventiveOccurrenceAudit({
  uri,
  json = true,
  groupLimit = 50,
  batchSize = 500,
  logger = console,
}: PreventiveOccurrenceAuditOptions): Promise<PreventiveOccurrenceAuditResult> {
  if (!uri?.trim()) {
    throw new Error('MONGODB_URI is required');
  }

  const connection = await mongoose
    .createConnection(uri, { autoCreate: false, autoIndex: false })
    .asPromise();

  try {
    const workorders = connection.db?.collection('workorders');
    if (!workorders) {
      throw new Error('Unable to open workorders collection');
    }

    const [
      workOrders,
      preventiveLikeWorkOrders,
      withValidOccurrenceKeys,
      withoutOccurrenceKeys,
      nullOccurrenceKeys,
      emptyOccurrenceKeys,
      nonEmptyKeyCount,
    ] = await Promise.all([
      workorders.countDocuments({}),
      workorders.countDocuments(PREVENTIVE_LIKE_FILTER),
      workorders.countDocuments({
        preventive_occurrence_key: {
          $gte: PREVENTIVE_OCCURRENCE_KEY_PREFIX,
          $lt: PREVENTIVE_OCCURRENCE_KEY_PREFIX_END,
        },
      }),
      workorders.countDocuments({
        preventive_occurrence_key: { $exists: false },
      }),
      workorders.countDocuments({ preventive_occurrence_key: { $type: 10 } }),
      workorders.countDocuments({ preventive_occurrence_key: '' }),
      workorders.countDocuments({
        preventive_occurrence_key: { $type: 'string', $gt: '' },
      }),
    ]);

    const duplicateValidOccurrenceKeys = await collectDuplicateGroups<{
      key: string;
      count: number;
      ids: string[];
    }>(
      connection,
      [
        {
          $match: {
            preventive_occurrence_key: {
              $gte: PREVENTIVE_OCCURRENCE_KEY_PREFIX,
              $lt: PREVENTIVE_OCCURRENCE_KEY_PREFIX_END,
            },
          },
        },
        {
          $group: {
            _id: '$preventive_occurrence_key',
            count: { $sum: 1 },
            ids: { $push: { $toString: '$_id' } },
          },
        },
        { $match: { count: { $gt: 1 } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: groupLimit },
        { $project: { _id: 0, key: '$_id', count: 1, ids: 1 } },
      ],
      batchSize,
    );

    const potentialLegacyDuplicateGroups = await collectDuplicateGroups<{
      classification: string;
      count: number;
      maintenanceType?: string;
      machineId?: string;
      moduleId?: string;
      planId?: string;
      dueDate?: string;
      statuses: string[];
      ids: string[];
    }>(
      connection,
      [
        {
          $match: {
            ...PREVENTIVE_LIKE_FILTER,
            due_date: { $type: 'date' },
          },
        },
        {
          $project: {
            type_maintenance: { $toLower: '$type_maintenance' },
            machine_id: 1,
            module_id: 1,
            plan_id: 1,
            status: 1,
            due_date: 1,
          },
        },
        {
          $group: {
            _id: {
              type_maintenance: '$type_maintenance',
              machine_id: '$machine_id',
              module_id: '$module_id',
              plan_id: '$plan_id',
              due_date: '$due_date',
            },
            count: { $sum: 1 },
            statuses: { $addToSet: '$status' },
            ids: { $push: { $toString: '$_id' } },
          },
        },
        { $match: { count: { $gt: 1 } } },
        { $sort: { count: -1 } },
        { $limit: groupLimit },
        {
          $project: {
            _id: 0,
            count: 1,
            statuses: 1,
            ids: 1,
            maintenanceType: '$_id.type_maintenance',
            machineId: { $toString: '$_id.machine_id' },
            moduleId: { $toString: '$_id.module_id' },
            planId: { $toString: '$_id.plan_id' },
            dueDate: {
              $dateToString: {
                date: '$_id.due_date',
                format: '%Y-%m-%dT%H:%M:%S.%LZ',
                timezone: 'UTC',
              },
            },
          },
        },
      ],
      batchSize,
    );

    const classifiedGroups = potentialLegacyDuplicateGroups.map((group) => ({
      ...group,
      classification: classifyLegacyDuplicate(group.statuses),
    }));

    const result: PreventiveOccurrenceAuditResult = {
      totals: {
        workOrders,
        preventiveLikeWorkOrders,
        withValidOccurrenceKeys,
        withoutOccurrenceKeys,
        nullOccurrenceKeys,
        emptyOccurrenceKeys,
        malformedOccurrenceKeys: nonEmptyKeyCount - withValidOccurrenceKeys,
      },
      duplicateValidOccurrenceKeys,
      potentialLegacyDuplicateGroups: classifiedGroups,
    };

    logger.log(json ? JSON.stringify(result, null, 2) : String(result));
    return result;
  } finally {
    await connection.close();
  }
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  void runPreventiveOccurrenceAudit({
    uri: args.uri ?? process.env.MONGODB_URI ?? '',
    json: args.json ?? true,
    groupLimit: args.groupLimit,
    batchSize: args.batchSize,
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
