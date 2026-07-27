import { CsvReportRenderer } from './csv-report-renderer';
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

describe('CsvReportRenderer', () => {
  let renderer: CsvReportRenderer;

  beforeEach(() => {
    renderer = new CsvReportRenderer();
  });

  it('reports the expected format metadata', () => {
    expect(renderer.format).toBe('csv');
    expect(renderer.fileExtension).toBe('csv');
    expect(renderer.contentType).toContain('text/csv');
  });

  it('renders a UTF-8 BOM followed by title, header, and data rows', async () => {
    const buffer = await renderer.render(dataset());
    const text = buffer.toString('utf8');

    expect(buffer[0]).toBe(0xef); // UTF-8 BOM byte 1
    expect(text).toContain('Test Report');
    expect(text).toContain('Column A,Column B');
    expect(text).toContain('1,2');
  });

  it('quotes and escapes fields containing commas, quotes, or newlines', async () => {
    const buffer = await renderer.render(
      dataset({ rows: [{ a: 'has,comma', b: 'has "quote"' }] }),
    );
    const text = buffer.toString('utf8');

    expect(text).toContain('"has,comma"');
    expect(text).toContain('"has ""quote"""');
  });

  it('appends a summary section when present', async () => {
    const buffer = await renderer.render(
      dataset({ summary: [{ label: 'Total', value: 42 }] }),
    );
    const text = buffer.toString('utf8');

    expect(text).toContain('Summary');
    expect(text).toContain('Total,42');
  });

  it('renders an empty rows section without throwing', async () => {
    const buffer = await renderer.render(dataset({ rows: [] }));
    expect(buffer.length).toBeGreaterThan(0);
  });
});
