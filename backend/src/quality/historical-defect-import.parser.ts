import { createHash } from 'node:crypto';
import { Workbook, Worksheet, CellValue } from 'exceljs';

export const HISTORICAL_SHEETS = [
  'Janv',
  'Fev',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Aout',
  'Sept',
  'Oct',
  'Nov',
  'Dec',
] as const;

export interface HistoricalOccurrence {
  sourceDefectCode: string;
  canonicalDefectCode: string;
  process: string;
  defectName?: string;
  occurrenceDate: string;
  quantityAffected: number;
  source: 'HISTORICAL_IMPORT';
  sourceYear: number;
  sourceSheet: string;
  sourceRow: number;
  sourceCell: string;
  importIdentity: string;
}

export interface HistoricalImportReport {
  workbook: string;
  year: number;
  sheetsProcessed: string[];
  rowsInspected: number;
  validOccurrenceCells: number;
  totalOccurrenceQuantity: number;
  occurrencesByMonth: Record<string, number>;
  occurrencesBySourceSheet: Record<string, number>;
  occurrencesByProcess: Record<string, number>;
  occurrencesByDefectCode: Record<string, number>;
  skippedCells: number;
  warnings: string[];
  errors: string[];
  occurrences: HistoricalOccurrence[];
  annualReconciliation: {
    available: boolean;
    dailyTotal: number;
    annualTotal?: number;
    discrepancy?: number;
    note?: string;
  };
}

function text(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'richText' in value)
    return value.richText.map((part) => part.text).join('');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).trim();
}

function excelDate(value: CellValue): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  return null;
}

function canonicalCode(source: string): string {
  const normalized = source.trim();
  return /^\d+$/.test(normalized)
    ? `F${normalized.padStart(3, '0')}`
    : normalized;
}

function increment(
  target: Record<string, number>,
  key: string,
  amount: number,
): void {
  target[key] = (target[key] ?? 0) + amount;
}

export function importIdentity(
  input: Pick<
    HistoricalOccurrence,
    | 'sourceSheet'
    | 'sourceRow'
    | 'sourceCell'
    | 'sourceDefectCode'
    | 'process'
    | 'occurrenceDate'
  >,
): string {
  return createHash('sha256')
    .update(
      [
        'iproflex-2025',
        input.sourceSheet,
        input.sourceRow,
        input.sourceCell,
        input.sourceDefectCode,
        input.process,
        input.occurrenceDate,
      ].join('|'),
    )
    .digest('hex');
}

function dateColumns(sheet: Worksheet): number[] {
  const columns: number[] = [];
  for (let column = 1; column <= sheet.columnCount; column += 1) {
    if (excelDate(sheet.getCell(3, column).value)) columns.push(column);
  }
  return columns;
}

interface OccurrenceCellInput {
  report: HistoricalImportReport;
  sheet: Worksheet;
  sheetName: string;
  rowNumber: number;
  column: number;
  process: string;
  sourceCode: string;
  defectName: string;
}

function addOccurrence({
  report,
  sheet,
  sheetName,
  rowNumber,
  column,
  process,
  sourceCode,
  defectName,
}: OccurrenceCellInput): void {
  const cell = sheet.getCell(rowNumber, column);
  const value = cell.value;
  if (typeof value !== 'number') {
    if (value !== null && value !== undefined && value !== '')
      report.skippedCells += 1;
    return;
  }
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    report.errors.push(
      `Invalid occurrence value ${cell.address}: ${String(value)}`,
    );
    return;
  }
  if (value === 0) return;
  const date = excelDate(sheet.getCell(3, column).value);
  if (!date) {
    report.errors.push(
      `Occurrence without a valid date at ${sheetName}!${cell.address}`,
    );
    return;
  }
  const occurrenceDate = date.toISOString().slice(0, 10);
  if (date.getUTCFullYear() !== report.year)
    report.warnings.push(
      `Date outside source year at ${sheetName}!${cell.address}: ${occurrenceDate}`,
    );
  const actualMonth = occurrenceDate.slice(0, 7);
  if (!actualMonth.endsWith(sheetMonthSuffix(sheetName)))
    report.warnings.push(
      `Cross-month date: source sheet ${sheetName}, actual date month ${actualMonth}`,
    );
  const occurrence: HistoricalOccurrence = {
    sourceDefectCode: sourceCode,
    canonicalDefectCode: canonicalCode(sourceCode),
    process,
    defectName: defectName || undefined,
    occurrenceDate,
    quantityAffected: value,
    source: 'HISTORICAL_IMPORT',
    sourceYear: report.year,
    sourceSheet: sheetName,
    sourceRow: rowNumber,
    sourceCell: cell.address,
    importIdentity: importIdentity({
      sourceSheet: sheetName,
      sourceRow: rowNumber,
      sourceCell: cell.address,
      sourceDefectCode: sourceCode,
      process,
      occurrenceDate,
    }),
  };
  report.occurrences.push(occurrence);
  report.validOccurrenceCells += 1;
  report.totalOccurrenceQuantity += value;
  increment(report.occurrencesByMonth, actualMonth, value);
  increment(report.occurrencesBySourceSheet, sheetName, value);
  increment(report.occurrencesByProcess, process, value);
  increment(
    report.occurrencesByDefectCode,
    occurrence.canonicalDefectCode,
    value,
  );
}

function processMonthlySheet(
  report: HistoricalImportReport,
  sheet: Worksheet,
  sheetName: string,
): void {
  report.sheetsProcessed.push(sheetName);
  const columns = dateColumns(sheet);
  report.rowsInspected += sheet.rowCount;
  for (let rowNumber = 4; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const process = text(row.getCell(1).value);
    const sourceCode = text(row.getCell(2).value);
    const defectName = text(row.getCell(3).value);
    if (
      !process ||
      !sourceCode ||
      /^total\b/i.test(sourceCode) ||
      /^total\b/i.test(defectName)
    )
      continue;
    for (const column of columns)
      addOccurrence({
        report,
        sheet,
        sheetName,
        rowNumber,
        column,
        process,
        sourceCode,
        defectName,
      });
  }
}

export async function parseHistoricalWorkbook(
  filePath: string,
): Promise<HistoricalImportReport> {
  const workbook = new Workbook();
  await workbook.xlsx.readFile(filePath);
  const report: HistoricalImportReport = {
    workbook: filePath,
    year: 2025,
    sheetsProcessed: [],
    rowsInspected: 0,
    validOccurrenceCells: 0,
    totalOccurrenceQuantity: 0,
    occurrencesByMonth: {},
    occurrencesBySourceSheet: {},
    occurrencesByProcess: {},
    occurrencesByDefectCode: {},
    skippedCells: 0,
    warnings: [],
    errors: [],
    occurrences: [],
    annualReconciliation: { available: false, dailyTotal: 0 },
  };

  for (const sheetName of HISTORICAL_SHEETS) {
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet) {
      report.errors.push(`Missing monthly sheet: ${sheetName}`);
      continue;
    }
    processMonthlySheet(report, sheet, sheetName);
  }

  const annual = workbook.getWorksheet("Cumul d'année");
  if (annual) {
    let annualTotal = 0;
    let cached = false;
    for (let row = 1; row <= annual.rowCount; row += 1) {
      const value = annual.getCell(row, 17).value;
      if (
        typeof value === 'object' &&
        value &&
        'result' in value &&
        typeof value.result === 'number'
      ) {
        annualTotal += value.result;
        cached = true;
      }
    }
    report.annualReconciliation = cached
      ? {
          available: true,
          dailyTotal: report.totalOccurrenceQuantity,
          annualTotal,
          discrepancy: report.totalOccurrenceQuantity - annualTotal,
        }
      : {
          available: false,
          dailyTotal: report.totalOccurrenceQuantity,
          note: "Cumul d'année contains formulas without cached results for all annual totals",
        };
  } else report.warnings.push("Missing reconciliation sheet: Cumul d'année");
  return report;
}

function sheetMonthSuffix(sheetName: string): string {
  const months: Record<string, string> = {
    Janv: '-01',
    Fev: '-02',
    Mars: '-03',
    Avril: '-04',
    Mai: '-05',
    Juin: '-06',
    Juillet: '-07',
    Aout: '-08',
    Sept: '-09',
    Oct: '-10',
    Nov: '-11',
    Dec: '-12',
  };
  return months[sheetName] ?? '';
}
