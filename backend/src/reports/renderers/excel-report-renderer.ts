import { Injectable } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { ReportFormat } from '../../schemas/generated-report.schema';
import { ReportDataset, ReportRenderer } from '../report.interfaces';

/** Excel worksheet names are capped at 31 characters and can't contain \ / ? * [ ]. */
function sheetName(title: string): string {
  return title.replace(/[\\/?*[\]]/g, ' ').slice(0, 31) || 'Report';
}

@Injectable()
export class ExcelReportRenderer implements ReportRenderer {
  readonly format = ReportFormat.EXCEL;
  readonly fileExtension = 'xlsx';
  readonly contentType =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  async render(dataset: ReportDataset): Promise<Buffer> {
    const workbook = new Workbook();
    workbook.creator = 'GMAO Reports';
    workbook.created = dataset.generatedAt;

    const sheet = workbook.addWorksheet(sheetName(dataset.title));

    sheet.addRow([dataset.title]).font = { bold: true, size: 14 };
    sheet.addRow([`Generated: ${dataset.generatedAt.toISOString()}`]);
    sheet.addRow([]);

    const headerRow = sheet.addRow(dataset.columns.map((c) => c.label));
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE5E7EB' },
      };
    });

    for (const row of dataset.rows) {
      sheet.addRow(dataset.columns.map((c) => row[c.key] ?? ''));
    }

    if (dataset.summary?.length) {
      sheet.addRow([]);
      const summaryHeader = sheet.addRow(['Summary']);
      summaryHeader.font = { bold: true };
      for (const entry of dataset.summary) {
        sheet.addRow([entry.label, entry.value]);
      }
    }

    sheet.columns.forEach((column) => {
      column.width = 22;
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
