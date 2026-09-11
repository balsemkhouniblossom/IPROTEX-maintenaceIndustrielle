import { BadRequestException, Injectable } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import * as mammoth from 'mammoth';
import { extname } from 'node:path';
import { RAG_MAX_TEXT_CHARACTERS } from '../rag.constants';

export type ExtractedPage = { text: string; pageNumber?: number };
export type ExtractedDocument = { pages: ExtractedPage[]; text: string; language?: string };

@Injectable()
export class DocumentExtractionService {
  async extract(buffer: Buffer, filename: string): Promise<ExtractedDocument> {
    const extension = extname(filename).toLowerCase();
    if (extension === '.pdf') return this.extractPdf(buffer);
    if (extension === '.docx') return this.extractDocx(buffer);
    if (extension === '.txt') return this.extractText(buffer);
    throw new BadRequestException(`RAG text extraction does not support ${extension || 'this file type'}`);
  }

  private async extractPdf(buffer: Buffer): Promise<ExtractedDocument> {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return this.finish(result.pages.map((page) => ({ text: page.text, pageNumber: page.num })));
    } finally {
      await parser.destroy();
    }
  }

  private async extractDocx(buffer: Buffer): Promise<ExtractedDocument> {
    const result = await mammoth.extractRawText({ buffer });
    return this.finish([{ text: result.value }]);
  }

  private extractText(buffer: Buffer): ExtractedDocument {
    return this.finish([{ text: buffer.toString('utf8') }]);
  }

  private finish(pages: ExtractedPage[]): ExtractedDocument {
    const normalizedPages = pages.map((page) => ({ ...page, text: normalizeText(page.text) })).filter((page) => page.text);
    const text = normalizedPages.map((page) => page.text).join('\n\n');
    if (!text) throw new BadRequestException('The document contains no extractable text');
    if (text.length > RAG_MAX_TEXT_CHARACTERS) throw new BadRequestException('Document text exceeds the RAG extraction limit');
    return { pages: normalizedPages, text };
  }
}

export function normalizeText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

