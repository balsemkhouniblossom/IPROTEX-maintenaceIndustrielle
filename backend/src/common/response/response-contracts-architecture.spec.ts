import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory()
      ? tsFiles(path)
      : path.endsWith('.ts')
        ? [path]
        : [];
  });
}

const srcDir = join(__dirname, '..', '..');

const PRIORITY_CONTROLLERS = [
  'work-orders/work-orders.controller.ts',
  'machines/machines.controller.ts',
  'machine-types/machine-types.controller.ts',
  'operator/operator.controller.ts',
  'technician/technician.controller.ts',
  'machine-timeline/machine-timeline.controller.ts',
];

describe('response-contract architecture (priority modules)', () => {
  it('keeps no public Promise<any> in the priority controllers', () => {
    for (const relPath of PRIORITY_CONTROLLERS) {
      const source = readFileSync(join(srcDir, relPath), 'utf8');
      expect(source).not.toMatch(/Promise<any>/);
    }
  });

  it('keeps the priority controllers free of eslint-disable escape hatches for unsafe typing', () => {
    for (const relPath of PRIORITY_CONTROLLERS) {
      const source = readFileSync(join(srcDir, relPath), 'utf8');
      expect(source).not.toMatch(/eslint-disable.*no-unsafe/);
      expect(source).not.toMatch(/eslint-disable.*no-explicit-any/);
    }
  });

  it('keeps response-contract type/mapper files free of Nest controller imports', () => {
    const contractDirs = [
      join(srcDir, 'work-orders', 'contracts'),
      join(srcDir, 'machines', 'contracts'),
      join(srcDir, 'machine-types', 'contracts'),
      join(srcDir, 'technician', 'contracts'),
      join(srcDir, 'common', 'response'),
    ];
    for (const dir of contractDirs) {
      for (const file of tsFiles(dir)) {
        if (file.endsWith('.spec.ts') || file.includes('__type-tests__'))
          continue;
        const source = readFileSync(file, 'utf8');
        expect(source).not.toMatch(/from ['"].*\.controller['"]/);
        expect(source).not.toContain('@Controller');
      }
    }
  });

  it('keeps mapper files free of dependence on NestJS request/response decorators', () => {
    const mapperFiles = [
      join(srcDir, 'work-orders', 'contracts', 'work-order-response.mapper.ts'),
      join(srcDir, 'machines', 'contracts', 'machine-response.mapper.ts'),
      join(srcDir, 'common', 'response', 'intervention-report-response.ts'),
    ];
    for (const file of mapperFiles) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toContain('@nestjs/common');
      expect(source).not.toContain('@Injectable');
    }
  });

  it('keeps every priority controller method that returns a Work Order/Machine/Machine Type shape typed against a response contract, not the raw Mongoose Document', () => {
    const documentReturnPattern =
      /:\s*Promise<[^>]*(WorkOrderDocument|MachineDocument|MachineTypeDocument)[^>]*>/;
    for (const relPath of PRIORITY_CONTROLLERS.filter((p) =>
      /work-orders|machines|machine-types/.test(p),
    )) {
      const source = readFileSync(join(srcDir, relPath), 'utf8');
      expect(source).not.toMatch(documentReturnPattern);
    }
  });
});
