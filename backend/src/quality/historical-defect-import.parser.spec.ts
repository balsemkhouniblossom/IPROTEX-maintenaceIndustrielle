import * as path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Workbook } from 'exceljs';
import {
  parseHistoricalWorkbook,
  importIdentity,
  HISTORICAL_SHEETS,
} from './historical-defect-import.parser';

describe('historical defect workbook parser', () => {
  async function buildWorkbook(): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), 'iproflex-quality-'));
    const file = path.join(directory, 'full.xlsx');
    const source = new Workbook();
    const sheetEntries: Record<string, Array<{ date: Date; code: string }>> = {
      Janv: [{ date: new Date('2025-01-15T00:00:00.000Z'), code: '101' }],
      Fev: [
        { date: new Date('2025-02-10T00:00:00.000Z'), code: '101' },
        { date: new Date('2025-02-20T00:00:00.000Z'), code: '101' },
      ],
      Mars: [
        { date: new Date('2025-03-10T00:00:00.000Z'), code: '101' },
        { date: new Date('2025-03-20T00:00:00.000Z'), code: '101' },
        { date: new Date('2025-03-25T00:00:00.000Z'), code: '101' },
      ],
      Avril: [{ date: new Date('2025-04-15T00:00:00.000Z'), code: '101' }],
      Mai: [{ date: new Date('2025-05-15T00:00:00.000Z'), code: '101' }],
      Juin: [{ date: new Date('2025-06-15T00:00:00.000Z'), code: '101' }],
      Juillet: [{ date: new Date('2025-07-15T00:00:00.000Z'), code: '101' }],
      Aout: [],
      Sept: [
        { date: new Date('2025-09-01T00:00:00.000Z'), code: '101' },
        { date: new Date('2025-09-08T00:00:00.000Z'), code: '101' },
        { date: new Date('2025-09-15T00:00:00.000Z'), code: '101' },
        { date: new Date('2025-09-22T00:00:00.000Z'), code: '101' },
      ],
      Oct: [
        { date: new Date('2025-10-01T00:00:00.000Z'), code: '101' },
        { date: new Date('2025-10-08T00:00:00.000Z'), code: '101' },
        { date: new Date('2025-10-15T00:00:00.000Z'), code: '101' },
        { date: new Date('2025-10-22T00:00:00.000Z'), code: '101' },
        { date: new Date('2025-10-29T00:00:00.000Z'), code: '101' },
        { date: new Date('2025-09-30T00:00:00.000Z'), code: '201' },
      ],
      Nov: [
        { date: new Date('2025-11-01T00:00:00.000Z'), code: '101' },
        { date: new Date('2025-11-08T00:00:00.000Z'), code: '101' },
        { date: new Date('2025-11-15T00:00:00.000Z'), code: '101' },
        { date: new Date('2025-11-22T00:00:00.000Z'), code: '101' },
        { date: new Date('2025-11-29T00:00:00.000Z'), code: '101' },
      ],
      Dec: [
        { date: new Date('2025-12-01T00:00:00.000Z'), code: '101' },
        { date: new Date('2025-12-08T00:00:00.000Z'), code: '101' },
        { date: new Date('2025-12-15T00:00:00.000Z'), code: '101' },
        { date: new Date('2025-12-22T00:00:00.000Z'), code: '101' },
        { date: new Date('2025-12-29T00:00:00.000Z'), code: '101' },
      ],
    };
    for (const sheetName of HISTORICAL_SHEETS) {
      const sheet = source.addWorksheet(sheetName);
      const entries = sheetEntries[sheetName] ?? [];
      entries.forEach((entry, index) => {
        sheet.getCell(3, 4 + index).value = entry.date;
      });
      entries.forEach((entry, index) => {
        const row = 4 + index;
        sheet.getCell(row, 1).value = 'Process A';
        sheet.getCell(row, 2).value = entry.code;
        sheet.getCell(row, 3).value = `Defect ${entry.code}`;
        sheet.getCell(row, 4 + index).value = 1;
      });
    }
    await source.xlsx.writeFile(file);
    return file;
  }

  it('parses only daily occurrence cells and preserves source dates', async () => {
    const workbook = await buildWorkbook();
    const result = await parseHistoricalWorkbook(workbook);
    expect(result.validOccurrenceCells).toBe(30);
    expect(result.totalOccurrenceQuantity).toBe(30);
    expect(result.occurrencesByMonth).toEqual({
      '2025-01': 1,
      '2025-02': 2,
      '2025-03': 3,
      '2025-04': 1,
      '2025-05': 1,
      '2025-06': 1,
      '2025-07': 1,
      '2025-09': 5,
      '2025-10': 5,
      '2025-11': 5,
      '2025-12': 5,
    });
    expect(
      result.occurrences.some(
        (item) =>
          item.sourceSheet === 'Oct' && item.occurrenceDate === '2025-09-30',
      ),
    ).toBe(true);
    expect(
      result.occurrences.find((item) => item.sourceDefectCode === '201')
        ?.canonicalDefectCode,
    ).toBe('F201');
    expect(
      result.occurrences.every((item) => item.source === 'HISTORICAL_IMPORT'),
    ).toBe(true);
  });

  it('creates a stable identity for repeat imports', () => {
    const input = {
      sourceSheet: 'Janv',
      sourceRow: 4,
      sourceCell: 'E4',
      sourceDefectCode: 'F103 ',
      process: 'Bobinage',
      occurrenceDate: '2025-01-06',
    } as const;
    expect(importIdentity(input)).toBe(importIdentity(input));
  });

  it('keeps a daily quantity of four as one aggregate historical record', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'iproflex-quality-'));
    const file = path.join(directory, 'aggregate.xlsx');
    try {
      const source = new Workbook();
      for (const sheetName of HISTORICAL_SHEETS) {
        const sheet = source.addWorksheet(sheetName);
        sheet.getCell('D3').value = new Date('2025-09-15T00:00:00.000Z');
        if (sheetName === 'Sept') {
          sheet.getCell('A4').value = 'Tressage';
          sheet.getCell('B4').value = '205';
          sheet.getCell('C4').value = 'Torn thread';
          sheet.getCell('D4').value = 4;
        }
      }
      await source.xlsx.writeFile(file);
      const parsed = await parseHistoricalWorkbook(file);
      expect(parsed.errors).toEqual([]);
      expect(parsed.validOccurrenceCells).toBe(1);
      expect(parsed.totalOccurrenceQuantity).toBe(4);
      expect(parsed.occurrences).toHaveLength(1);
      expect(parsed.occurrences[0]).toEqual(
        expect.objectContaining({
          sourceDefectCode: '205',
          canonicalDefectCode: 'F205',
          quantityAffected: 4,
          occurrenceDate: '2025-09-15',
        }),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('excludes formulas and process totals while reporting malformed values and cross-month dates', async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), 'iproflex-quality-cells-'),
    );
    const file = path.join(directory, 'daily-cells.xlsx');
    try {
      const source = new Workbook();
      for (const sheetName of HISTORICAL_SHEETS) {
        const sheet = source.addWorksheet(sheetName);
        sheet.getCell('D3').value = new Date('2025-09-30T00:00:00.000Z');
        if (sheetName === 'Sept' || sheetName === 'Oct') {
          for (const row of [4, 5, 6, 7, 8, 9]) {
            sheet.getCell(`A${row}`).value = 'Tressage';
            sheet.getCell(`B${row}`).value =
              row === 5 ? 'Total Tressage' : '205';
            sheet.getCell(`C${row}`).value = 'Torn thread';
          }
        }
        if (sheetName === 'Sept') {
          sheet.getCell('D4').value = 4;
          sheet.getCell('D5').value = 99;
          sheet.getCell('D6').value = { formula: 'D4', result: 4 };
          sheet.getCell('D7').value = 1.5;
          sheet.getCell('D8').value = 0;
        }
        if (sheetName === 'Oct') sheet.getCell('D4').value = 1;
      }
      await source.xlsx.writeFile(file);
      const first = await parseHistoricalWorkbook(file);
      const second = await parseHistoricalWorkbook(file);
      expect(first.validOccurrenceCells).toBe(2);
      expect(first.totalOccurrenceQuantity).toBe(5);
      expect(first.occurrencesByMonth).toEqual({ '2025-09': 5 });
      expect(first.occurrencesBySourceSheet).toEqual({ Sept: 4, Oct: 1 });
      expect(first.occurrences).toHaveLength(2);
      expect(
        first.occurrences.find((item) => item.sourceSheet === 'Oct'),
      ).toEqual(
        expect.objectContaining({
          occurrenceDate: '2025-09-30',
          quantityAffected: 1,
        }),
      );
      expect(first.warnings).toContain(
        'Cross-month date: source sheet Oct, actual date month 2025-09',
      );
      expect(
        first.errors.some(
          (message) => message.includes('D7') && message.includes('1.5'),
        ),
      ).toBe(true);
      expect(first.skippedCells).toBeGreaterThanOrEqual(1);
      expect(first.occurrences.map((item) => item.importIdentity)).toEqual(
        second.occurrences.map((item) => item.importIdentity),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
