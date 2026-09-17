import { parseHistoricalWorkbook } from '../src/quality/historical-defect-import.parser';

const file = process.argv[2] ?? '../resources/Reporting de Défauts internes  iproflex 2025.xlsx';

function printMap(title: string, values: Record<string, number>): void {
  console.log(`\n${title}`);
  for (const [key, value] of Object.entries(values)) console.log(`  ${key}: ${value}`);
}

async function main(): Promise<void> {
  const report = await parseHistoricalWorkbook(file);
  console.log('IPROTEX historical defect import dry run (NO DATABASE WRITES)');
  console.log(`Workbook: ${report.workbook}`);
  console.log(`Year: ${report.year}`);
  console.log(`Sheets processed: ${report.sheetsProcessed.join(', ')}`);
  console.log(`Rows inspected: ${report.rowsInspected}`);
  console.log(`Valid occurrence cells: ${report.validOccurrenceCells}`);
  console.log(`Total occurrence quantity: ${report.totalOccurrenceQuantity}`);
  printMap('Occurrences by source sheet', report.occurrencesBySourceSheet);
  printMap('Occurrences by actual calendar month', report.occurrencesByMonth);
  printMap('Occurrences by process', report.occurrencesByProcess);
  printMap('Occurrences by canonical defect code', report.occurrencesByDefectCode);
  console.log(`Skipped cells: ${report.skippedCells}`);
  console.log(`Warnings: ${report.warnings.length}`);
  report.warnings.forEach((warning) => console.log(`  - ${warning}`));
  console.log(`Errors: ${report.errors.length}`);
  report.errors.forEach((error) => console.log(`  - ${error}`));
  console.log(`Cumul d'année reconciliation: ${JSON.stringify(report.annualReconciliation)}`);
  if (report.errors.length > 0) process.exitCode = 2;
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });

