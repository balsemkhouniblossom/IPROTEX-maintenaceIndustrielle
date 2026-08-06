import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { RECOMMENDED_MONGODB_INDEXES } from './recommended-indexes';
import {
  buildDesiredIndexes,
  discoverSchemaIndexes,
  indexEquivalent,
  planIndexes,
  runIndexManager,
} from './index-manager';
import { SCHEMA_REGISTRY } from './schema-registry';
import { DocumentSchema, DocumentEntity } from '../schemas/document.schema';
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

describe('schema-discovered indexes', () => {
  it('discovers every index declared on document.schema.ts, including the unique document_id index', async () => {
    const mongo = await MongoMemoryServer.create();
    try {
      const connection = await mongoose
        .createConnection(mongo.getUri(), {
          autoCreate: false,
          autoIndex: false,
        })
        .asPromise();
      try {
        const discovered = discoverSchemaIndexes(connection, [
          { modelName: DocumentEntity.name, schema: DocumentSchema },
        ]);

        // DocumentEntity pluralizes to `documententities`, not `documents` —
        // this is exactly the mismatch that previously left this
        // collection's indexes unverified against production.
        expect(
          discovered.every((spec) => spec.collection === 'documententities'),
        ).toBe(true);
        const documentIdIndex = discovered.find(
          (spec) => spec.name === 'document_id_1',
        );
        expect(documentIdIndex?.key).toEqual({ document_id: 1 });
        expect(documentIdIndex?.options?.unique).toBe(true);
        expect(discovered.length).toBe(DocumentSchema.indexes().length);
      } finally {
        await connection.close();
      }
    } finally {
      await mongo.stop();
    }
  }, 30_000);

  it('merges curated and schema-declared indexes without duplicating logically-identical entries', async () => {
    const mongo = await MongoMemoryServer.create();
    try {
      const connection = await mongoose
        .createConnection(mongo.getUri(), {
          autoCreate: false,
          autoIndex: false,
        })
        .asPromise();
      try {
        const merged = buildDesiredIndexes(connection);

        // Every curated (rationale-bearing) index must survive the merge.
        for (const spec of RECOMMENDED_MONGODB_INDEXES) {
          expect(merged).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ name: spec.name }),
            ]),
          );
        }

        // Fingerprints (collection + key + unique/sparse/partialFilter/ttl)
        // must be unique — no logical duplicates from the merge.
        const fingerprints = merged.map(
          (spec) =>
            `${spec.collection}:${JSON.stringify(spec.key)}:${Boolean(
              spec.options?.unique,
            )}`,
        );
        expect(new Set(fingerprints).size).toBe(fingerprints.length);
      } finally {
        await connection.close();
      }
    } finally {
      await mongo.stop();
    }
  }, 30_000);

  it('registers every schema in SCHEMA_REGISTRY without throwing (collection names resolve)', async () => {
    const mongo = await MongoMemoryServer.create();
    try {
      const connection = await mongoose
        .createConnection(mongo.getUri(), {
          autoCreate: false,
          autoIndex: false,
        })
        .asPromise();
      try {
        expect(() =>
          discoverSchemaIndexes(connection, SCHEMA_REGISTRY),
        ).not.toThrow();
      } finally {
        await connection.close();
      }
    } finally {
      await mongo.stop();
    }
  }, 30_000);
});

describe('runIndexManager applies every desired index without malformed options', () => {
  it('creates every schema-discovered + curated index against a real MongoDB instance, including indexes with no explicit unique/sparse/ttl options', async () => {
    // Regression test: options objects built from Mongoose's `schema.indexes()`
    // (e.g. KnowledgeArticle's text-search index, which sets none of
    // unique/sparse/partialFilterExpression/expireAfterSeconds) must never
    // reach the driver with explicit `undefined` values — Mongo serializes
    // those as `null` and rejects them ("not convertible to bool").
    const mongo = await MongoMemoryServer.create();
    const logger = { log: jest.fn(), error: jest.fn() };

    try {
      const uri = mongo.getUri();
      await expect(
        runIndexManager({ uri, apply: true, logger }),
      ).resolves.not.toThrow();

      const connection = await mongoose
        .createConnection(uri, { autoCreate: false, autoIndex: false })
        .asPromise();
      const knowledgeArticleIndexes = await connection.db
        ?.collection('knowledgearticles')
        .indexes();
      await connection.close();

      expect(
        knowledgeArticleIndexes?.some(
          (index) => index.name === 'knowledge_article_text_search',
        ),
      ).toBe(true);

      // Regression: MongoDB stores a compound text index's key as
      // `{ _fts: 'text', _ftsx: 1 }` with a separate `weights` map, not the
      // `{ field: 'text', ... }` shape it was declared with — a correctly
      // created text index must plan as `exists` on the very next run, not
      // perpetually `missing`.
      const rerun = await runIndexManager({ uri, logger });
      const textIndexEntry = rerun.find(
        (entry) => entry.spec.name === 'knowledge_article_text_search',
      );
      expect(textIndexEntry?.status).toBe('exists');
    } finally {
      await mongo.stop();
    }
  }, 60_000);
});

describe('runIndexManager index drift healing', () => {
  it('drops and recreates a same-named index whose definition has drifted', async () => {
    const mongo = await MongoMemoryServer.create();
    const logger = { log: jest.fn(), error: jest.fn() };
    const collection = 'drift_test_collection';

    try {
      const uri = mongo.getUri();

      // Simulate a production index created under an older code path: same
      // name, different (broader) partial filter than what the code wants now.
      const seedConnection = await mongoose
        .createConnection(uri, { autoCreate: false, autoIndex: false })
        .asPromise();
      await seedConnection.db?.collection(collection).createIndex(
        { occurrence_key: 1 },
        {
          name: 'occurrence_key_unique',
          unique: true,
          partialFilterExpression: { occurrence_key: { $exists: true } },
        },
      );
      await seedConnection.close();

      const currentSpec = {
        collection,
        name: 'occurrence_key_unique',
        key: { occurrence_key: 1 as const },
        options: {
          unique: true,
          partialFilterExpression: {
            occurrence_key: { $gte: 'v1:', $lt: 'v1;' },
          },
        },
        rationale: 'test',
      };

      const dryRun = await runIndexManager({
        uri,
        indexes: [currentSpec],
        logger,
      });
      expect(dryRun).toEqual([expect.objectContaining({ status: 'missing' })]);

      await runIndexManager({
        uri,
        apply: true,
        indexes: [currentSpec],
        logger,
      });
      expect(
        logger.log.mock.calls.some(([line]) =>
          String(line).includes(
            '[drift] drift_test_collection.occurrence_key_unique',
          ),
        ),
      ).toBe(true);

      const verifyConnection = await mongoose
        .createConnection(uri, { autoCreate: false, autoIndex: false })
        .asPromise();
      const indexes = await verifyConnection.db
        ?.collection(collection)
        .indexes();
      await verifyConnection.close();

      const healed = indexes?.find(
        (index) => index.name === 'occurrence_key_unique',
      );
      expect(healed?.partialFilterExpression).toEqual({
        occurrence_key: { $gte: 'v1:', $lt: 'v1;' },
      });
    } finally {
      await mongo.stop();
    }
  }, 30_000);
});
