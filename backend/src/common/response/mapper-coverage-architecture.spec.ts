import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const srcDir = join(__dirname, '..', '..');

const PRIORITY_FILES = [
  'operator/operator.controller.ts',
  'operator/operator.service.ts',
  'technician/technician.controller.ts',
  'technician/technician.service.ts',
  'work-orders/work-orders.controller.ts',
  'work-orders/work-orders.service.ts',
  'machines/machines.controller.ts',
  'machines/machines.service.ts',
  'machine-timeline/machine-timeline.controller.ts',
  'machine-timeline/machine-timeline.service.ts',
];

/**
 * Extracts the return-type annotation text of every method whose signature
 * ends `): <ReturnType> {` — covers every `async method(...): Promise<X> {`
 * in these files without needing a full TypeScript AST, which is precise
 * enough here because every public/private method in these files is
 * written in exactly that Prettier-formatted shape.
 */
function extractReturnTypeAnnotations(source: string): string[] {
  const matches = source.matchAll(/\)\s*:\s*([^{;]+?)\s*\{/g);
  return Array.from(matches, (match) => match[1]);
}

describe('mapper coverage architecture (Operator/Technician/Work Orders/Machines/Machine Timeline)', () => {
  it('declares no method return type of Promise<any>', () => {
    for (const relPath of PRIORITY_FILES) {
      const source = readFileSync(join(srcDir, relPath), 'utf8');
      const returnTypes = extractReturnTypeAnnotations(source);
      const offenders = returnTypes.filter((type) => /Promise<any>/.test(type));
      expect({ file: relPath, offenders }).toEqual({
        file: relPath,
        offenders: [],
      });
    }
  });

  it('declares no method return type of bare Promise<unknown>', () => {
    for (const relPath of PRIORITY_FILES) {
      const source = readFileSync(join(srcDir, relPath), 'utf8');
      const returnTypes = extractReturnTypeAnnotations(source);
      const offenders = returnTypes.filter((type) =>
        /^Promise<unknown>$/.test(type.trim()),
      );
      expect({ file: relPath, offenders }).toEqual({
        file: relPath,
        offenders: [],
      });
    }
  });

  it('declares no method return type built directly from a Mongoose *Document type', () => {
    // `createInitialOccurrenceForPlan` is never reached from any Operator/
    // Technician/Machine-Timeline/calendar HTTP response — it is an
    // internal admin-preventive-scheduling trigger consumed only by
    // `MaintenancePlansService`, out of scope for this response-contract
    // continuation (see the task's restriction against touching scheduling
    // internals). Documented here rather than silently excluded.
    const KNOWN_OUT_OF_SCOPE_RAW_DOCUMENT_RETURNS = [
      'Promise<WorkOrderDocument | null>',
    ];
    for (const relPath of PRIORITY_FILES) {
      const source = readFileSync(join(srcDir, relPath), 'utf8');
      const returnTypes = extractReturnTypeAnnotations(source);
      // `FilterQuery<...Document>` is a MongoDB query filter fed into
      // `.find(...)` — an internal query-builder input, not a response
      // payload — so it is deliberately not flagged here.
      const offenders = returnTypes.filter(
        (type) =>
          /Document(?![A-Za-z])/.test(type) &&
          !/FilterQuery</.test(type) &&
          !KNOWN_OUT_OF_SCOPE_RAW_DOCUMENT_RETURNS.includes(type.trim()),
      );
      expect({ file: relPath, offenders }).toEqual({
        file: relPath,
        offenders: [],
      });
    }
  });

  it('declares no method return type of Record<string, unknown> as the public response shape', () => {
    for (const relPath of PRIORITY_FILES) {
      const source = readFileSync(join(srcDir, relPath), 'utf8');
      const returnTypes = extractReturnTypeAnnotations(source);
      const offenders = returnTypes.filter((type) =>
        /Promise<Record<string, unknown>/.test(type),
      );
      expect({ file: relPath, offenders }).toEqual({
        file: relPath,
        offenders: [],
      });
    }
  });

  it('never uses `as any` in controller/service response construction', () => {
    for (const relPath of PRIORITY_FILES) {
      const source = readFileSync(join(srcDir, relPath), 'utf8');
      expect(source).not.toMatch(/as any\b/);
    }
  });

  it('never uses `as unknown as {...}` response-shaping duck typing in controllers/services (that belongs in a contracts/*.mapper.ts file or a named serialization helper)', () => {
    for (const relPath of PRIORITY_FILES) {
      const source = readFileSync(join(srcDir, relPath), 'utf8');
      expect(source).not.toMatch(/as unknown as \{/);
    }
  });

  it('never returns a Mongoose `.toObject()` call directly from a controller/service without going through a mapper', () => {
    for (const relPath of PRIORITY_FILES) {
      const source = readFileSync(join(srcDir, relPath), 'utf8');
      expect(source).not.toMatch(/return[^;]*\.toObject\(/);
    }
  });
});
