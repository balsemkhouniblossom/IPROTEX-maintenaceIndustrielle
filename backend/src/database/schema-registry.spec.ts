import * as fs from 'node:fs';
import * as path from 'node:path';
import { Schema } from 'mongoose';
import { SCHEMA_REGISTRY } from './schema-registry';

/**
 * Structural guardrail for the MongoDB index-drift fix: every `*.schema.ts`
 * file under `src` must export at least one Mongoose `Schema` instance that
 * is registered in `SCHEMA_REGISTRY`, or `index-manager.ts` silently loses
 * visibility into that collection's declared indexes (this is exactly how
 * `document.schema.ts`'s indexes went unverified against production).
 */
describe('SCHEMA_REGISTRY completeness', () => {
  it('includes at least one exported schema from every schema.ts file under src', () => {
    const srcRoot = path.join(__dirname, '..');
    const schemaFiles: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(entryPath);
        } else if (
          entry.isFile() &&
          entry.name.endsWith('.schema.ts') &&
          !entry.name.endsWith('.spec.ts')
        ) {
          schemaFiles.push(entryPath);
        }
      }
    };
    walk(srcRoot);

    expect(schemaFiles.length).toBeGreaterThan(0);

    const registeredSchemas = new Set<Schema>(
      SCHEMA_REGISTRY.map((entry) => entry.schema),
    );

    const filesMissingFromRegistry = schemaFiles.filter((file) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const moduleExports = require(file) as Record<string, unknown>;
      const exportedSchemas = Object.values(moduleExports).filter(
        (value): value is Schema => value instanceof Schema,
      );
      return !exportedSchemas.some((schema) => registeredSchemas.has(schema));
    });

    expect(
      filesMissingFromRegistry.map((f) => path.relative(srcRoot, f)),
    ).toEqual([]);
  });

  it('has no duplicate model names', () => {
    const names = SCHEMA_REGISTRY.map((entry) => entry.modelName);
    expect(new Set(names).size).toBe(names.length);
  });
});
