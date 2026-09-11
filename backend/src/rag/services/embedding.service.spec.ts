import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { EmbeddingService } from './embedding.service';
import { RAG_EMBEDDING_DIMENSIONS } from '../rag.constants';

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn(),
}));

describe('EmbeddingService', () => {
  const embedContent = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (GoogleGenAI as jest.Mock).mockImplementation(() => ({
      models: { embedContent },
    }));
  });

  it('requests and validates 768-dimensional Gemini document embeddings', async () => {
    embedContent.mockResolvedValue({
      embeddings: [{ values: Array(RAG_EMBEDDING_DIMENSIONS).fill(0.25) }],
    });
    const service = new EmbeddingService(
      new ConfigService({ GEMINI_API_KEY: 'unit-test-key' }),
    );

    await expect(
      service.embedDocument('Bearing inspection', 'Manual'),
    ).resolves.toHaveLength(RAG_EMBEDDING_DIMENSIONS);
    expect(embedContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-embedding-001',
        config: expect.objectContaining({
          taskType: 'RETRIEVAL_DOCUMENT',
          outputDimensionality: RAG_EMBEDDING_DIMENSIONS,
        }),
      }),
    );
  });

  it('rejects missing configuration and malformed provider output', async () => {
    await expect(
      new EmbeddingService(new ConfigService()).embedQuery('bearing vibration'),
    ).rejects.toThrow('not configured');

    embedContent.mockResolvedValue({ embeddings: [{ values: [1, 2] }] });
    await expect(
      new EmbeddingService(
        new ConfigService({ GEMINI_API_KEY: 'unit-test-key' }),
      ).embedQuery('bearing vibration'),
    ).rejects.toThrow('Gemini embedding request failed');
  });
});
