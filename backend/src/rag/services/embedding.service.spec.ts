import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { EmbeddingService } from './embedding.service';
import { RAG_EMBEDDING_DIMENSIONS } from '../rag.constants';

describe('EmbeddingService', () => {
  let service: EmbeddingService;
  let config: { get: jest.Mock };

  beforeEach(() => {
    config = { get: jest.fn() };
    service = new EmbeddingService(config as unknown as ConfigService);
  });

  it('initializes with default model and dimensions', () => {
    expect(service).toBeDefined();
  });

  it('gets model name', () => {
    config.get.mockReturnValue('test-model');
    const svc = new EmbeddingService(config as unknown as ConfigService);
    expect(svc.getModel()).toBe('test-model');
  });

  it('gets dimensions', () => {
    expect(service.getDimensions()).toBe(RAG_EMBEDDING_DIMENSIONS);
  });

  it('throws on empty text', async () => {
    await expect(service.embedDocument('')).rejects.toThrow(
      'Cannot embed empty text',
    );
  });

  it('throws when client not configured', async () => {
    await expect(service.embedQuery('test')).rejects.toThrow(
      'Gemini embedding is not configured',
    );
  });
});
