import type { IndexSpecification } from 'mongodb';
import mongoose, { type Connection, type IndexDirection } from 'mongoose';
import {
  RECOMMENDED_MONGODB_INDEXES,
  type RecommendedMongoIndex,
} from './recommended-indexes';
import { SCHEMA_REGISTRY, type SchemaRegistryEntry } from './schema-registry';

export interface ExistingMongoIndex {
  name?: string;
  key: Record<string, unknown>;
  unique?: boolean;
  sparse?: boolean;
  expireAfterSeconds?: number;
  partialFilterExpression?: Record<string, unknown>;
  weights?: Record<string, number>;
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

function textIndexFieldNames(key: Record<string, unknown>): string[] {
  return Object.entries(key)
    .filter(([, direction]) => direction === 'text')
    .map(([field]) => field)
    .sort();
}

/**
 * MongoDB normalizes a compound text index's stored `key` to
 * `{ _fts: 'text', _ftsx: 1 }` plus a separate `weights` map — it never
 * reports back the `{ field: 'text', ... }` shape a text index is declared
 * with. Comparing `existing.key` to `spec.key` directly for a text index
 * would therefore always report a correctly-created text index as missing.
 */
function textIndexEquivalent(
  existing: ExistingMongoIndex,
  spec: RecommendedMongoIndex,
): boolean {
  const existingIsTextIndex = existing.key._fts === 'text';
  if (!existingIsTextIndex) return false;

  const specFields = textIndexFieldNames(spec.key);
  const existingFields = Object.keys(existing.weights ?? {}).sort();
  return normalize(specFields) === normalize(existingFields);
}

export function indexEquivalent(
  existing: ExistingMongoIndex,
  spec: RecommendedMongoIndex,
): boolean {
  if (textIndexFieldNames(spec.key).length > 0) {
    return textIndexEquivalent(existing, spec);
  }

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

function defaultIndexName(key: Record<string, IndexDirection>): string {
  return Object.entries(key)
    .map(([field, direction]) => `${field}_${direction}`)
    .join('_');
}

function describeIndex(spec: RecommendedMongoIndex) {
  return {
    key: spec.key,
    unique: Boolean(spec.options?.unique),
    sparse: Boolean(spec.options?.sparse),
    partialFilterExpression: spec.options?.partialFilterExpression,
    expireAfterSeconds: spec.options?.expireAfterSeconds,
  };
}

/**
 * Discovers every index declared directly on a registered schema (via
 * `@Prop({unique/index})` or `.index()` calls) and expresses each as a
 * `RecommendedMongoIndex` so it flows through the same plan/apply pipeline
 * as the hand-curated `RECOMMENDED_MONGODB_INDEXES` list. Registering the
 * schema on `connection` (rather than guessing the collection name) keeps
 * this exact for irregular pluralizations — e.g. the `DocumentEntity` model
 * backs the `documententities` collection, not `documents`.
 */
export function discoverSchemaIndexes(
  connection: Connection,
  registry: SchemaRegistryEntry[] = SCHEMA_REGISTRY,
): RecommendedMongoIndex[] {
  const discovered: RecommendedMongoIndex[] = [];

  for (const entry of registry) {
    const model =
      connection.models[entry.modelName] ??
      connection.model(entry.modelName, entry.schema);
    const collection = model.collection.name;

    for (const [key, options] of entry.schema.indexes()) {
      const typedKey = key as Record<string, IndexDirection>;
      // Only set keys that have a real value — an explicit `{ unique: undefined }`
      // survives JSON/BSON serialization as `null`, which MongoDB's createIndex
      // rejects ("not convertible to bool"), unlike an omitted key.
      const discoveredOptions: RecommendedMongoIndex['options'] = {};
      if (options.unique) discoveredOptions.unique = true;
      if (options.sparse) discoveredOptions.sparse = true;
      if (options.partialFilterExpression) {
        discoveredOptions.partialFilterExpression =
          options.partialFilterExpression;
      }
      if (typeof options.expireAfterSeconds === 'number') {
        discoveredOptions.expireAfterSeconds = options.expireAfterSeconds;
      }

      discovered.push({
        collection,
        name: (options as { name?: string }).name ?? defaultIndexName(typedKey),
        key: typedKey,
        options: discoveredOptions,
        rationale:
          'Declared directly on the Mongoose schema (auto-discovered from SCHEMA_REGISTRY).',
      });
    }
  }

  return discovered;
}

/**
 * Merges the curated, rationale-documented `RECOMMENDED_MONGODB_INDEXES`
 * with every schema-declared index, de-duplicating logically-identical
 * definitions (same collection/key/unique/sparse/partialFilter/ttl) so
 * nothing is checked or created twice. Curated entries win on collision
 * since they carry a human-written rationale; this is what makes schema
 * files the single source of truth for structural indexes instead of
 * requiring every index to also be hand-copied into a second list.
 */
export function buildDesiredIndexes(
  connection: Connection,
  options: {
    curated?: RecommendedMongoIndex[];
    registry?: SchemaRegistryEntry[];
  } = {},
): RecommendedMongoIndex[] {
  const curated = options.curated ?? RECOMMENDED_MONGODB_INDEXES;
  const discovered = discoverSchemaIndexes(connection, options.registry);

  const seen = new Set(
    curated.map((spec) =>
      normalize({ collection: spec.collection, ...describeIndex(spec) }),
    ),
  );

  const merged = [...curated];
  for (const spec of discovered) {
    const fingerprint = normalize({
      collection: spec.collection,
      ...describeIndex(spec),
    });
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    merged.push(spec);
  }

  return merged;
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
  indexes,
  logger = console,
}: IndexManagerOptions): Promise<IndexPlanEntry[]> {
  if (!uri?.trim()) {
    throw new Error('MONGODB_URI is required');
  }

  const connection = await mongoose
    .createConnection(uri, { autoCreate: false, autoIndex: false })
    .asPromise();
  try {
    // When the caller doesn't pin an explicit index list (the normal CLI
    // path), plan against the curated list merged with every schema-declared
    // index — this is what closes the drift between `RECOMMENDED_MONGODB_INDEXES`
    // and `@Prop`/`.index()` declarations that previously left some
    // collections' indexes unverified in production.
    const effectiveIndexes = indexes ?? buildDesiredIndexes(connection);
    const existing = await loadExistingIndexes(connection, effectiveIndexes);
    const plan = planIndexes(existing, effectiveIndexes);

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
        // A same-name index with a different definition (e.g. a
        // partialFilterExpression that no longer matches the code) can't be
        // created over in place — Mongo rejects it as IndexOptionsConflict.
        // Drop the stale definition first so `--apply` can heal drift, not
        // just fill genuine gaps.
        const staleSameName = (existing.get(spec.collection) ?? []).find(
          (index) => index.name === spec.name,
        );
        if (staleSameName) {
          logger.log(
            `[drift] ${spec.collection}.${spec.name} exists with a different definition — dropping before recreate`,
          );
          await connection.db?.collection(spec.collection).dropIndex(spec.name);
        }

        const createOptions: Record<string, unknown> = { name: spec.name };
        for (const [key, value] of Object.entries(spec.options ?? {})) {
          if (value !== undefined) createOptions[key] = value;
        }

        await connection.db
          ?.collection(spec.collection)
          .createIndex(spec.key as IndexSpecification, createOptions);
        logger.log(`[created] ${spec.collection}.${spec.name}`);
      }
    }

    return plan;
  } finally {
    await connection.close();
  }
}
