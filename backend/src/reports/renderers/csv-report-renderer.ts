import { Injectable } from '@nestjs/common';
import { ReportFormat } from '../../schemas/generated-report.schema';
import { ReportDataset, ReportRenderer } from '../report.interfaces';

/** RFC 4180 field quoting: wrap in quotes (doubling any embedded quote) whenever the value contains a comma, quote, or newline. */
function csvField(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function csvLine(values: Array<string | number | null | undefined>): string {
  return values.map(csvField).join(',');
}

/** No external dependency — CSV is simple enough that hand-writing a correctly-quoting serializer is less risk than a library for something this small. */
@Injectable()
export class CsvReportRenderer implements ReportRenderer {
  readonly format = ReportFormat.CSV;
  readonly fileExtension = 'csv';
  readonly contentType = 'text/csv; charset=utf-8';

  render(dataset: ReportDataset): Promise<Buffer> {
    const lines: string[] = [];
    lines.push(
      csvLine([dataset.title]),
      csvLine([`Generated: ${dataset.generatedAt.toISOString()}`]),
      '',
      csvLine(dataset.columns.map((c) => c.label)),
    );
    for (const row of dataset.rows) {
      lines.push(csvLine(dataset.columns.map((c) => row[c.key])));
    }
    if (dataset.summary?.length) {
      lines.push('', csvLine(['Summary']));
      for (const entry of dataset.summary) {
        lines.push(csvLine([entry.label, entry.value]));
      }
    }

    // UTF-8 BOM so Excel (which CSV exports are very often opened in)
    // correctly detects encoding instead of mangling non-ASCII text.
    return Promise.resolve(
      Buffer.concat([
        Buffer.from('﻿', 'utf8'),
        Buffer.from(lines.join('\r\n'), 'utf8'),
      ]),
    );
  }
}
