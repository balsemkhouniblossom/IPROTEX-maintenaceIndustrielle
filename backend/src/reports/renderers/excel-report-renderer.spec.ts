import { Workbook } from 'exceljs';
import { ExcelReportRenderer } from './excel-report-renderer';
import { ReportDataset } from '../report.interfaces';

// exceljs's own type definitions declare a local `Buffer extends ArrayBuffer`
// that shadows Node's real `Buffer` (which extends `Uint8Array`) — a purely
// type-level mismatch; `workbook.xlsx.load()` accepts a real Node Buffer
// fine at runtime, so this helper isolates the one necessary cast.
async function loadWorkbook(buffer: Buffer): Promise<Workbook> {
  const workbook = new Workbook();
  await workbook.xlsx.load(buffer as never);
  return workbook;
}

function dataset(overrides: Partial<ReportDataset> = {}): ReportDataset {
  return {
    title: 'Machine History Report',
    generatedAt: new Date('2026-07-01T00:00:00.000Z'),
    parameters: {},
    columns: [
      { key: 'a', label: 'Column A' },
      { key: 'b', label: 'Column B' },
    ],
    rows: [
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ],
    ...overrides,
  };
}

describe('ExcelReportRenderer', () => {
  let renderer: ExcelReportRenderer;

  beforeEach(() => {
    renderer = new ExcelReportRenderer();
  });

  it('reports the expected format metadata', () => {
    expect(renderer.format).toBe('excel');
    expect(renderer.fileExtension).toBe('xlsx');
    expect(renderer.contentType).toContain('spreadsheetml');
  });

  it('produces a workbook that can be read back with the header row and every data row', async () => {
    const buffer = await renderer.render(dataset());
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.worksheets[0];

    const headerRow = sheet.getRow(4).values as unknown[];
    expect(headerRow).toEqual(expect.arrayContaining(['Column A', 'Column B']));

    expect(sheet.getRow(5).getCell(1).value).toBe('1');
    expect(sheet.getRow(6).getCell(1).value).toBe('3');
  });

  it('truncates and sanitizes an overlong or invalid sheet name', async () => {
    const buffer = await renderer.render(
      dataset({ title: 'A'.repeat(50) + '/weird[name]' }),
    );

    const workbook = await loadWorkbook(buffer);
    expect(workbook.worksheets[0].name.length).toBeLessThanOrEqual(31);
    expect(workbook.worksheets[0].name).not.toMatch(/[\\/?*[\]]/);
  });

  it('appends a summary section beneath the data rows', async () => {
    const buffer = await renderer.render(dataset({ summary: [{ label: 'Total rows', value: 2 }] }));

    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.worksheets[0];
    const values = sheet
      .getSheetValues()
      .flat()
      .filter((v): v is string | number => v !== undefined && v !== null);

    expect(values).toContain('Total rows');
  });
});
