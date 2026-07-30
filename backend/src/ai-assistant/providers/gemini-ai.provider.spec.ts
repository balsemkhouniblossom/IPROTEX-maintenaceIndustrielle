const mockGenerateContent = jest.fn();

jest.mock('@google/genai', () => {
  class ApiError extends Error {
    status: number;

    constructor(options: { message: string; status: number }) {
      super(options.message);
      this.status = options.status;
    }
  }

  return {
    ApiError,
    GoogleGenAI: jest.fn().mockImplementation(() => ({
      models: { generateContent: mockGenerateContent },
    })),
    Type: {
      ARRAY: 'ARRAY',
      OBJECT: 'OBJECT',
      STRING: 'STRING',
    },
  };
});

import { ApiError } from '@google/genai';
import { AiAssistantRequest, AiProviderError } from '../ai-provider.interface';
import {
  GeminiAiProvider,
  MisconfiguredAiProvider,
} from './gemini-ai.provider';

function request(): AiAssistantRequest {
  return {
    question: 'Why does the motor trip?',
    locale: 'en',
    context: { activeAlarms: [], maintenanceHistory: [], knowledgeArticles: [] },
  };
}

describe('GeminiAiProvider', () => {
  let provider: GeminiAiProvider;

  beforeEach(() => {
    mockGenerateContent.mockReset();
    provider = new GeminiAiProvider({
      apiKey: 'test-key',
      model: 'gemini-2.5-flash',
    });
  });

  it('is named "gemini"', () => {
    expect(provider.name).toBe('gemini');
  });

  it('reports configured diagnostics without exposing the API key', () => {
    expect(provider.getDiagnostics()).toEqual({
      enabled: true,
      configured: true,
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      status: 'ready',
      message: 'AI assistant is enabled and configured for Google Gemini',
    });
    expect(JSON.stringify(provider.getDiagnostics())).not.toContain('test-key');
  });

  it('parses a well-formed structured JSON response into an answer', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        knownFacts: ['Motor tripped twice today'],
        probableCauses: ['Overcurrent'],
        recommendedChecks: ['Inspect bearing'],
        safetyWarnings: ['Lock out before inspection'],
        uncertainty: 'Cannot confirm without a technician visit',
      }),
    });

    const result = await provider.generate(request(), new AbortController().signal);

    expect(result.model).toBe('gemini-2.5-flash');
    expect(result.answer.knownFacts).toEqual(['Motor tripped twice today']);
    expect(result.answer.safetyWarnings).toEqual(['Lock out before inspection']);
  });

  it('requests Gemini JSON mode with the shared response schema and abort signal', async () => {
    const controller = new AbortController();
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        knownFacts: [],
        probableCauses: [],
        recommendedChecks: [],
        safetyWarnings: [],
        uncertainty: '',
      }),
    });

    await provider.generate(request(), controller.signal);

    const [params] = mockGenerateContent.mock.calls[0];
    expect(params.model).toBe('gemini-2.5-flash');
    expect(params.config.responseMimeType).toBe('application/json');
    expect(params.config.responseSchema.required).toContain('knownFacts');
    expect(params.config.abortSignal).toBe(controller.signal);
  });

  it('maps invalid credentials from Gemini', async () => {
    mockGenerateContent.mockRejectedValue(
      new ApiError({ message: 'bad key', status: 401 }),
    );

    await expect(
      provider.generate(request(), new AbortController().signal),
    ).rejects.toMatchObject<Partial<AiProviderError>>({
      code: 'invalid_credentials',
    });

    mockGenerateContent.mockRejectedValue(
      new ApiError({ message: 'API key not valid', status: 400 }),
    );
    await expect(
      provider.generate(request(), new AbortController().signal),
    ).rejects.toMatchObject<Partial<AiProviderError>>({
      code: 'invalid_credentials',
    });
  });

  it('maps Gemini quota limits', async () => {
    mockGenerateContent.mockRejectedValue(
      new ApiError({ message: 'quota', status: 429 }),
    );

    await expect(
      provider.generate(request(), new AbortController().signal),
    ).rejects.toMatchObject<Partial<AiProviderError>>({
      code: 'quota_limited',
    });
  });

  it('maps unavailable Gemini models to missing configuration', async () => {
    mockGenerateContent.mockRejectedValue(
      new ApiError({ message: 'model is not available', status: 404 }),
    );

    await expect(
      provider.generate(request(), new AbortController().signal),
    ).rejects.toMatchObject<Partial<AiProviderError>>({
      code: 'missing_configuration',
    });
  });

  it('maps temporary Gemini failures and malformed output', async () => {
    mockGenerateContent.mockRejectedValue(
      new ApiError({ message: 'unavailable', status: 503 }),
    );

    await expect(
      provider.generate(request(), new AbortController().signal),
    ).rejects.toMatchObject<Partial<AiProviderError>>({
      code: 'temporary_failure',
    });

    mockGenerateContent.mockResolvedValue({ text: 'not json at all' });
    await expect(
      provider.generate(request(), new AbortController().signal),
    ).rejects.toMatchObject<Partial<AiProviderError>>({
      code: 'temporary_failure',
    });
  });

  it('parses JSON when Gemini wraps it in a markdown code fence', async () => {
    mockGenerateContent.mockResolvedValue({
      text: [
        '```json',
        JSON.stringify({
          knownFacts: ['Machine stopped'],
          probableCauses: [],
          recommendedChecks: ['Check emergency stop'],
          safetyWarnings: ['Apply lockout/tagout before inspection'],
          uncertainty: 'No machine telemetry was provided',
        }),
        '```',
      ].join('\n'),
    });

    const result = await provider.generate(request(), new AbortController().signal);

    expect(result.answer.knownFacts).toEqual(['Machine stopped']);
    expect(result.answer.recommendedChecks).toEqual(['Check emergency stop']);
  });
});

describe('MisconfiguredAiProvider', () => {
  it('reports missing Gemini configuration and rejects with that code', async () => {
    const provider = new MisconfiguredAiProvider('gemini', 'missing Gemini config');

    expect(provider.getDiagnostics()).toEqual({
      enabled: true,
      configured: false,
      provider: 'gemini',
      status: 'missing_configuration',
      message: 'missing Gemini config',
    });
    await expect(provider.generate()).rejects.toMatchObject<Partial<AiProviderError>>({
      code: 'missing_configuration',
    });
  });
});
