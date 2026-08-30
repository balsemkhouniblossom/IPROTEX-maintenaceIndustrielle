import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { GeminiDynamicTranslationProvider } from './dynamic-translation.provider';

const mockGenerateContent = jest.fn();

jest.mock('@google/genai', () => ({
  Type: {
    OBJECT: 'object',
    STRING: 'string',
  },
  GoogleGenAI: jest.fn(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
}));

function config(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function input(signal = new AbortController().signal) {
  return {
    text: 'Inspect FAULT-77 on PMP-22',
    sourceLocale: 'en' as const,
    targetLocale: 'fr' as const,
    protectedTokens: ['FAULT-77', 'PMP-22'],
    signal,
  };
}

describe('GeminiDynamicTranslationProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateContent.mockReset();
  });

  it('stays disabled unless enabled, keyed, and configured with a model', async () => {
    for (const values of [
      {},
      { DYNAMIC_TRANSLATION_ENABLED: 'false', GEMINI_API_KEY: 'key' },
      { DYNAMIC_TRANSLATION_ENABLED: 'true' },
      { DYNAMIC_TRANSLATION_ENABLED: 'true', GEMINI_API_KEY: 'key' },
    ]) {
      const provider = new GeminiDynamicTranslationProvider(config(values));
      await expect(provider.translate(input())).rejects.toThrow(
        'Dynamic translation provider is disabled',
      );
    }

    expect(GoogleGenAI).not.toHaveBeenCalled();
  });

  it('translates with the dynamic translation model and preserves prompt rules', async () => {
    const signal = new AbortController().signal;
    mockGenerateContent.mockResolvedValue({
      text: '```json\n{"translatedText":"Inspecter FAULT-77 sur PMP-22"}\n```',
    });
    const provider = new GeminiDynamicTranslationProvider(
      config({
        DYNAMIC_TRANSLATION_ENABLED: 'true',
        GEMINI_API_KEY: 'secret',
        DYNAMIC_TRANSLATION_GEMINI_MODEL: 'gemini-dynamic',
        GEMINI_MODEL: 'gemini-default',
      }),
    );

    await expect(provider.translate(input(signal))).resolves.toEqual({
      translatedText: 'Inspecter FAULT-77 sur PMP-22',
      provider: 'gemini',
      model: 'gemini-dynamic',
    });

    expect(GoogleGenAI).toHaveBeenCalledWith({ apiKey: 'secret' });
    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-dynamic',
        config: expect.objectContaining({
          responseMimeType: 'application/json',
          maxOutputTokens: 512,
          abortSignal: signal,
        }),
      }),
    );
    const request = mockGenerateContent.mock.calls[0][0];
    const prompt = JSON.parse(request.contents);
    expect(prompt).toMatchObject({
      task: 'translate_display_only_dynamic_content',
      sourceLocale: 'en',
      targetLocale: 'fr',
      protectedTokens: ['FAULT-77', 'PMP-22'],
      text: 'Inspect FAULT-77 on PMP-22',
    });
    expect(prompt.rules.join(' ')).toContain('Preserve protectedTokens');
  });

  it('falls back to the shared Gemini model when no dynamic model is set', async () => {
    mockGenerateContent.mockResolvedValue({
      text: '{"translatedText":"Texte traduit"}',
    });
    const provider = new GeminiDynamicTranslationProvider(
      config({
        DYNAMIC_TRANSLATION_ENABLED: 'true',
        GEMINI_API_KEY: 'secret',
        GEMINI_MODEL: 'gemini-shared',
      }),
    );

    await expect(provider.translate(input())).resolves.toMatchObject({
      translatedText: 'Texte traduit',
      model: 'gemini-shared',
    });
    expect(mockGenerateContent.mock.calls[0][0].model).toBe('gemini-shared');
  });

  it('rejects empty, non-json, and malformed Gemini responses', async () => {
    const provider = new GeminiDynamicTranslationProvider(
      config({
        DYNAMIC_TRANSLATION_ENABLED: 'true',
        GEMINI_API_KEY: 'secret',
        DYNAMIC_TRANSLATION_GEMINI_MODEL: 'gemini-dynamic',
      }),
    );

    for (const response of [
      { text: undefined },
      { text: 'plain text only' },
      { text: '{"translatedText":""}' },
      { text: '{"translatedText":42}' },
    ]) {
      mockGenerateContent.mockResolvedValueOnce(response);
      await expect(provider.translate(input())).rejects.toThrow(
        /Gemini returned (no translation text|malformed translation data)/,
      );
    }
  });
});
