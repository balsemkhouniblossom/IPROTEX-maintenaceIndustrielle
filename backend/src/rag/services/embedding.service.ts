import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { RAG_EMBEDDING_DIMENSIONS, RAG_EMBEDDING_MODEL } from '../rag.constants';

@Injectable()
export class EmbeddingService {
  private readonly client?: GoogleGenAI;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.model = config.get<string>('GEMINI_EMBEDDING_MODEL')?.trim() || RAG_EMBEDDING_MODEL;
    const key = config.get<string>('GEMINI_API_KEY')?.trim();
    if (key) this.client = new GoogleGenAI({ apiKey: key });
  }

  async embedDocument(text: string, title?: string): Promise<number[]> {
    return this.embed(text, 'RETRIEVAL_DOCUMENT', title);
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.embed(text, 'RETRIEVAL_QUERY');
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    return Promise.all(texts.map((text) => this.embedDocument(text)));
  }

  getModel(): string { return this.model; }

  private async embed(text: string, taskType: string, title?: string): Promise<number[]> {
    if (!text.trim()) throw new InternalServerErrorException('Cannot embed empty text');
    if (!this.client) throw new InternalServerErrorException('Gemini embedding is not configured');
    try {
      const response = await this.client.models.embedContent({
        model: this.model,
        contents: text,
        config: { taskType, title, outputDimensionality: RAG_EMBEDDING_DIMENSIONS },
      });
      const values = response.embeddings?.[0]?.values;
      if (!values?.length || values.length !== RAG_EMBEDDING_DIMENSIONS || values.some((value) => !Number.isFinite(value))) {
        throw new Error(`Gemini returned an invalid ${RAG_EMBEDDING_DIMENSIONS}-dimension embedding`);
      }
      return values;
    } catch (error) {
      if (error instanceof InternalServerErrorException) throw error;
      throw new InternalServerErrorException('Gemini embedding request failed');
    }
  }
}

