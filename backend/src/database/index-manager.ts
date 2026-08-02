import type { IndexSpecification } from 'mongodb';
import mongoose, { type Connection } from 'mongoose';
import {
  RECOMMENDED_MONGODB_INDEXES,
  type RecommendedMongoIndex,
} from './recommended-indexes';

export interface ExistingMongoIndex {
  name?: string;
  key: Record<string, unknown>;
  unique?: boolean;
  sparse?: boolean;
  expireAfterSeconds?: number;
  partialFilterExpression?: Record<string, unknown>;
}

export interface IndexPlanEntry {
  spec: RecommendedMongoIndex;
  status: 'exists' | 'missing';
  equivalentName?: string;
}

export interface IndexManagerOptions {
  uri: string;
  apply?: boolean;
  indexes?: RecommendedMongoIndex[];
  logger?: Pick<Console, 'log' | 'error'>;
}

export function normalize(value: unknown): string {
  if (value === undefined) return '';
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(normalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, entryValue]) => `${JSON.stringify(key)}:${normalize(entryValue)}`,
    );
  return `{${entries.join(',')}}`;
}

export function indexEquivalent(
  existing: ExistingMongoIndex,
  spec: RecommendedMongoIndex,
): boolean {
  return (
    normalize(existing.key) === normalize(spec.key) &&
    Boolean(existing.unique) === Boolean(spec.options?.unique) &&
    Boolean(existing.sparse) === Boolean(spec.options?.sparse) &&
    normalize(existing.partialFilterExpression) ===
      normalize(spec.options?.partialFilterExpression) &&
    (existing.expireAfterSeconds ?? undefined) ===
      (spec.options?.expireAfterSeconds ?? undefined)
  );
}

export function planIndexes(
  existingByCollection: Map<string, ExistingMongoIndex[]>,
  specs: RecommendedMongoIndex[] = RECOMMENDED_MONGODB_INDEXES,
): IndexPlanEntry[] {
  return specs.map((spec) => {
    const existing = existingByCollection.get(spec.collection) ?? [];
    const equivalent = existing.find((index) => indexEquivalent(index, spec));
    return {
      spec,
      status: equivalent ? 'exists' : 'missing',
      equivalentName: equivalent?.name,
    };
  });
}

export async function loadExistingIndexes(
  connection: Connection,
  specs: RecommendedMongoIndex[] = RECOMMENDED_MONGODB_INDEXES,
): Promise<Map<string, ExistingMongoIndex[]>> {
  const collections = [...new Set(specs.map((spec) => spec.collection))];
  const result = new Map<string, ExistingMongoIndex[]>();
  for (const collectionName of collections) {
    try {
      const indexes = (await connection.db
        ?.collection(collectionName)
        .indexes()) as ExistingMongoIndex[] | undefined;
      result.set(collectionName, indexes ?? []);
    } catch (error) {
      if ((error as { codeName?: string })?.codeName === 'NamespaceNotFound') {
        result.set(collectionName, []);
        continue;
      }
      throw error;
    }
  }
  return result;
}

export async function runIndexManager({
  uri,
  apply = false,
  indexes = RECOMMENDED_MONGODB_INDEXES,
  logger = console,
}: IndexManagerOptions): Promise<IndexPlanEntry[]> {
  if (!uri?.trim()) {
    throw new Error('MONGODB_URI is required');
  }

  const connection = await mongoose
    .createConnection(uri, { autoCreate: false, autoIndex: false })
    .asPromise();
  try {
    const existing = await loadExistingIndexes(connection, indexes);
    const plan = planIndexes(existing, indexes);

    for (const entry of plan) {
      const { spec } = entry;
      if (entry.status === 'exists') {
        logger.log(
          `[exists] ${spec.collection}.${spec.name} equivalent=${entry.equivalentName}`,
        );
        continue;
      }

      logger.log(
        `[missing] ${spec.collection}.${spec.name} key=${JSON.stringify(
          spec.key,
        )}`,
      );
      if (apply) {
        await connection.db
          ?.collection(spec.collection)
          .createIndex(spec.key as IndexSpecification, {
            ...spec.options,
            name: spec.name,
          });
        logger.log(`[created] ${spec.collection}.${spec.name}`);
      }
    }

    return plan;
  } finally {
    await connection.close();
  }
}
