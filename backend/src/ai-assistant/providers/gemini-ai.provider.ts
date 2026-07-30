import { ApiError, GoogleGenAI, Type } from '@google/genai';
import {
  AiAssistantRequest,
  AiProvider,
  AiProviderDiagnostics,
  AiProviderError,
  AiProviderResult,
} from '../ai-provider.interface';
import {
  AI_ANSWER_JSON_SCHEMA,
  buildSystemPrompt,
  buildUserPrompt,
  normalizeAnswer,
} from '../ai-prompt.util';

export type GeminiAiProviderOptions = {
  apiKey: string;
  model: string;
};

const GEMINI_RESPONSE_SCHEMA = {
  ...AI_ANSWER_JSON_SCHEMA,
  type: Type.OBJECT,
  properties: {
    knownFacts: { type: Type.ARRAY, items: { type: Type.STRING } },
    probableCauses: { type: Type.ARRAY, items: { type: Type.STRING } },
    recommendedChecks: { type: Type.ARRAY, items: { type: Type.STRING } },
    safetyWarnings: { type: Type.ARRAY, items: { type: Type.STRING } },
    uncertainty: { type: Type.STRING },
  },
} as const;

/**
 * Real Google Gemini provider. It is created only when the assistant is
 * enabled and Gemini has a backend-only API key plus model configured.
 */
export class GeminiAiProvider implements AiProvider {
  readonly name = 'gemini';
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor(options: GeminiAiProviderOptions) {
    this.client = new GoogleGenAI({ apiKey: options.apiKey });
    this.model = options.model;
  }

  getDiagnostics(): AiProviderDiagnostics {
    return {
      enabled: true,
      configured: true,
      provider: this.name,
      model: this.model,
      status: 'ready',
      message: 'AI assistant is enabled and configured for Google Gemini',
    };
  }

  async generate(
    request: AiAssistantRequest,
    signal: AbortSignal,
  ): Promise<AiProviderResult> {
    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: buildUserPrompt(request),
        config: {
          systemInstruction: buildSystemPrompt(request.locale),
          responseMimeType: 'application/json',
          responseSchema: GEMINI_RESPONSE_SCHEMA,
          maxOutputTokens: 1024,
          abortSignal: signal,
        },
      });

      const text = extractJsonText(response.text);
      if (!text) {
        throw new AiProviderError(
          'temporary_failure',
          'Gemini returned no text content',
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new AiProviderError(
          'temporary_failure',
          'Gemini returned malformed JSON',
        );
      }

      return { answer: normalizeAnswer(parsed), model: this.model };
    } catch (error) {
      throw classifyGeminiError(error);
    }
  }
}

export class MisconfiguredAiProvider implements AiProvider {
  readonly name: string;

  constructor(
    private readonly providerName: string,
    private readonly message: string,
  ) {
    this.name = providerName;
  }

  getDiagnostics(): AiProviderDiagnostics {
    return {
      enabled: true,
      configured: false,
      provider: this.providerName,
      status:
        this.providerName === 'invalid_provider'
          ? 'invalid_provider'
          : 'missing_configuration',
      message: this.message,
    };
  }

  async generate(): Promise<AiProviderResult> {
    throw new AiProviderError('missing_configuration', this.message);
  }
}

function classifyGeminiError(error: unknown): Error {
  if (error instanceof AiProviderError) {
    return error;
  }

  if (isAbortError(error)) {
    return error instanceof Error ? error : new Error('AI provider request timed out');
  }

  if (error instanceof ApiError) {
    if (error.status === 404 && /model|not found|not available/i.test(error.message)) {
      return new AiProviderError(
        'missing_configuration',
        'Gemini model is unavailable for the configured API key',
      );
    }

    if (
      error.status === 401 ||
      error.status === 403 ||
      (error.status === 400 && /api key|credential|permission/i.test(error.message))
    ) {
      return new AiProviderError(
        'invalid_credentials',
        'Gemini rejected the configured API key or permissions',
      );
    }
    if (error.status === 429) {
      return new AiProviderError(
        'quota_limited',
        'Gemini quota or rate limit was reached',
      );
    }
    if (error.status >= 500 || error.status === 408) {
      return new AiProviderError(
        'temporary_failure',
        'Gemini is temporarily unavailable',
      );
    }
  }

  return new AiProviderError(
    'temporary_failure',
    error instanceof Error ? error.message : 'Gemini request failed',
  );
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || /aborted|timed out/i.test(error.message))
  );
}

function extractJsonText(text: string | undefined): string | undefined {
  if (!text) {
    return undefined;
  }

  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]?.trim()) {
    return fenced[1].trim();
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}
