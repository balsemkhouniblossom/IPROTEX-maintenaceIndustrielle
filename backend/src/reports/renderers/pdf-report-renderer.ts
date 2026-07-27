import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { ReportFormat } from '../../schemas/generated-report.schema';
import { ReportDataset, ReportRenderer } from '../report.interfaces';

const ROW_HEIGHT = 14;
const HEADER_HEIGHT = 16;

/**
 * A simple, hand-drawn table layout rather than pulling in a PDF table
 * library — pdfkit gives text positioning primitives only, so this method
 * tracks its own row cursor and page breaks. Wide datasets (more than 6
 * columns) render landscape, since a fixed page width divided across many
 * columns gets illegibly narrow in portrait.
 */
@Injectable()
export class PdfReportRenderer implements ReportRenderer {
  readonly format = ReportFormat.PDF;
  readonly fileExtension = 'pdf';
  readonly contentType = 'application/pdf';

  async render(dataset: ReportDataset): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        margin: 40,
        size: 'A4',
        layout: dataset.columns.length > 6 ? 'landscape' : 'portrait',
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = doc.page.margins.left;
      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const bottomLimit = doc.page.height - doc.page.margins.bottom;
      const colWidth = pageWidth / Math.max(dataset.columns.length, 1);

      doc.fontSize(16).font('Helvetica-Bold').text(dataset.title);
      doc.fontSize(9).font('Helvetica').fillColor('#555555').text(
        `Generated: ${dataset.generatedAt.toISOString()}`,
      );
      doc.fillColor('#000000');
      doc.moveDown();

      let y = doc.y;

      const drawRow = (values: unknown[], bold: boolean) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
        values.forEach((value, index) => {
          doc.text(value === null || value === undefined ? '' : String(value), left + index * colWidth, y, {
            width: colWidth - 4,
            height: ROW_HEIGHT,
            ellipsis: true,
          });
        });
      };

      const ensureSpace = (needed: number) => {
        if (y + needed > bottomLimit) {
          doc.addPage();
          y = doc.page.margins.top;
        }
      };

      ensureSpace(HEADER_HEIGHT);
      drawRow(dataset.columns.map((c) => c.label), true);
      y += HEADER_HEIGHT;

      for (const row of dataset.rows) {
        ensureSpace(ROW_HEIGHT);
        drawRow(dataset.columns.map((c) => row[c.key]), false);
        y += ROW_HEIGHT;
      }

      if (dataset.summary?.length) {
        ensureSpace(ROW_HEIGHT * 2);
        y += ROW_HEIGHT;
        doc.font('Helvetica-Bold').fontSize(10).text('Summary', left, y);
        y += ROW_HEIGHT;
        for (const entry of dataset.summary) {
          ensureSpace(ROW_HEIGHT);
          doc.font('Helvetica').fontSize(9).text(`${entry.label}: ${entry.value}`, left, y);
          y += ROW_HEIGHT;
        }
      }

      doc.end();
    });
  }
}
