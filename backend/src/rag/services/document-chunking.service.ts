import { Injectable } from '@nestjs/common';
import { RAG_CHUNK_OVERLAP_WORDS, RAG_CHUNK_TARGET_WORDS } from '../rag.constants';
import type { ExtractedPage } from './document-extraction.service';

export type TextChunk = { content: string; chunkIndex: number; pageNumber?: number; section?: string };

@Injectable()
export class DocumentChunkingService {
  chunk(pages: ExtractedPage[]): TextChunk[] {
    const chunks: TextChunk[] = [];
    let words: string[] = [];
    let pageNumber: number | undefined;
    let section: string | undefined;
    const flush = () => {
      if (!words.length) return;
      chunks.push({ content: words.join(' ').trim(), chunkIndex: chunks.length, pageNumber, section });
      words = words.slice(Math.max(0, words.length - RAG_CHUNK_OVERLAP_WORDS));
    };
    for (const page of pages) {
      pageNumber = page.pageNumber ?? pageNumber;
      for (const paragraph of page.text.split(/\n{2,}/).map((value) => value.trim()).filter(Boolean)) {
        if (/^(#{1,6}|[A-Z][A-Z0-9 /&_-]{3,80})$/.test(paragraph)) section = paragraph;
        const paragraphWords = paragraph.split(/\s+/);
        if (words.length + paragraphWords.length > RAG_CHUNK_TARGET_WORDS && words.length) flush();
        words.push(...paragraphWords);
        if (words.length >= RAG_CHUNK_TARGET_WORDS) flush();
      }
    }
    flush();
    return chunks.filter((chunk) => chunk.content.length >= 40);
  }
}

