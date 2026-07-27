import { PdfReportRenderer } from './pdf-report-renderer';
import { ReportDataset } from '../report.interfaces';

function dataset(overrides: Partial<ReportDataset> = {}): ReportDataset {
  return {
    title: 'Test Report',
    generatedAt: new Date('2026-07-01T00:00:00.000Z'),
    parameters: {},
    columns: [
      { key: 'a', label: 'Column A' },
      { key: 'b', label: 'Column B' },
    ],
    rows: [{ a: '1', b: '2' }],
    ...overrides,
  };
}

describe('PdfReportRenderer', () => {
  let renderer: PdfReportRenderer;

  beforeEach(() => {
    renderer = new PdfReportRenderer();
  });

  it('reports the expected format metadata', () => {
    expect(renderer.format).toBe('pdf');
    expect(renderer.fileExtension).toBe('pdf');
    expect(renderer.contentType).toBe('application/pdf');
  });

  it('produces a well-formed PDF byte stream', async () => {
    const buffer = await renderer.render(dataset());

    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(100);
  });

  it('handles an empty rows array without throwing', async () => {
    const buffer = await renderer.render(dataset({ rows: [] }));
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('handles a wide dataset (many columns) without throwing', async () => {
    const columns = Array.from({ length: 10 }, (_, i) => ({ key: `c${i}`, label: `Column ${i}` }));
    const row = Object.fromEntries(columns.map((c) => [c.key, 'value']));
    const buffer = await renderer.render(dataset({ columns, rows: [row] }));
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('produces a larger document for many rows than for one row (pagination path exercised)', async () => {
    const manyRows = Array.from({ length: 200 }, (_, i) => ({ a: String(i), b: String(i * 2) }));
    const small = await renderer.render(dataset({ rows: [{ a: '1', b: '2' }] }));
    const large = await renderer.render(dataset({ rows: manyRows }));
    expect(large.length).toBeGreaterThan(small.length);
  });

  it('renders a summary section without throwing', async () => {
    const buffer = await renderer.render(dataset({ summary: [{ label: 'Total', value: 42 }] }));
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});
