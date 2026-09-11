import { Injectable } from '@nestjs/common';
import {
  RAG_CHUNK_OVERLAP_WORDS,
  RAG_CHUNK_TARGET_WORDS,
} from '../rag.constants';
import type { ExtractedPage } from './document-extraction.service';

export type TextChunk = {
  content: string;
  chunkIndex: number;
  pageNumber?: number;
  section?: string;
};

@Injectable()
export class DocumentChunkingService {
  chunk(pages: ExtractedPage[]): TextChunk[] {
    const chunks: TextChunk[] = [];
    let words: string[] = [];
    let pageNumber: number | undefined;
    let section: string | undefined;
    let addedSinceFlush = false;

    const flush = () => {
      if (!words.length || !addedSinceFlush) return;
      chunks.push({
        content: words.join(' ').trim(),
        chunkIndex: chunks.length,
        pageNumber,
        section,
      });
      words = words.slice(Math.max(0, words.length - RAG_CHUNK_OVERLAP_WORDS));
      addedSinceFlush = false;
    };

    const appendWords = (incoming: string[]) => {
      let cursor = 0;
      while (cursor < incoming.length) {
        const capacity = RAG_CHUNK_TARGET_WORDS - words.length;
        if (capacity <= 0) {
          flush();
          continue;
        }
        const take = Math.min(capacity, incoming.length - cursor);
        words.push(...incoming.slice(cursor, cursor + take));
        cursor += take;
        addedSinceFlush = true;
        if (words.length >= RAG_CHUNK_TARGET_WORDS) flush();
      }
    };

    for (const page of pages) {
      if (!words.length || !addedSinceFlush) {
        pageNumber = page.pageNumber ?? pageNumber;
      }
      for (const paragraph of page.text
        .split(/\n{2,}/)
        .map((value) => value.trim())
        .filter(Boolean)) {
        if (/^(#{1,6}\s+.{1,120}|[A-Z][A-Z0-9 /&_-]{3,80})$/.test(paragraph)) {
          section = paragraph.replace(/^#{1,6}\s+/, '');
        }
        const paragraphWords = paragraph.split(/\s+/);
        if (
          words.length > RAG_CHUNK_OVERLAP_WORDS &&
          words.length + paragraphWords.length > RAG_CHUNK_TARGET_WORDS
        ) {
          flush();
        }
        appendWords(paragraphWords);
      }
    }
    flush();
    return chunks.filter((chunk) => chunk.content.length >= 40);
  }
}
