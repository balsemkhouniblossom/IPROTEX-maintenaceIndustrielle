import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, Type } from '@google/genai';
import {
  DynamicTranslationProvider,
  DynamicTranslationProviderResult,
  SupportedContentLocale,
} from './dynamic-content-translation.types';

const TRANSLATION_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    translatedText: { type: Type.STRING },
  },
  required: ['translatedText'],
} as const;

@Injectable()
export class GeminiDynamicTranslationProvider
  implements DynamicTranslationProvider
{
  readonly name = 'gemini';
  private readonly client?: GoogleGenAI;
  private readonly model?: string;
  private readonly enabled: boolean;

  constructor(private readonly configService: ConfigService) {
    this.enabled =
      this.configService.get<string>('DYNAMIC_TRANSLATION_ENABLED') === 'true';
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    this.model =
      this.configService.get<string>('DYNAMIC_TRANSLATION_GEMINI_MODEL') ??
      this.configService.get<string>('GEMINI_MODEL');
    if (this.enabled && apiKey && this.model) {
      this.client = new GoogleGenAI({ apiKey });
    }
  }

  async translate(input: {
    text: string;
    sourceLocale: SupportedContentLocale;
    targetLocale: SupportedContentLocale;
    protectedTokens: string[];
    signal: AbortSignal;
  }): Promise<DynamicTranslationProviderResult> {
    if (!this.enabled || !this.client || !this.model) {
      throw new Error('Dynamic translation provider is disabled');
    }

    const response = await this.client.models.generateContent({
      model: this.model,
      contents: buildTranslationPrompt(input),
      config: {
        systemInstruction:
          'Translate maintenance-management display content only. Preserve every protected token exactly. Return JSON only.',
        responseMimeType: 'application/json',
        responseSchema: TRANSLATION_RESPONSE_SCHEMA,
        maxOutputTokens: 512,
        abortSignal: input.signal,
      },
    });
    const text = extractJsonText(response.text);
    if (!text) throw new Error('Gemini returned no translation text');
    const parsed = JSON.parse(text) as { translatedText?: unknown };
    if (typeof parsed.translatedText !== 'string' || !parsed.translatedText.trim()) {
      throw new Error('Gemini returned malformed translation data');
    }

    return {
      translatedText: parsed.translatedText,
      provider: this.name,
      model: this.model,
    };
  }
}

function buildTranslationPrompt(input: {
  text: string;
  sourceLocale: SupportedContentLocale;
  targetLocale: SupportedContentLocale;
  protectedTokens: string[];
}): string {
  return JSON.stringify({
    task: 'translate_display_only_dynamic_content',
    sourceLocale: input.sourceLocale,
    targetLocale: input.targetLocale,
    rules: [
      'Do not translate machine names, models, references, serial numbers, fault codes, usernames, emails, IDs, URLs, filenames, dates, numbers, measurements, units, brands, enum values, or technical abbreviations.',
      'Preserve protectedTokens exactly, with identical spelling and punctuation.',
      'Do not add advice or diagnostics.',
    ],
    protectedTokens: input.protectedTokens,
    text: input.text,
  });
}

function extractJsonText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  return firstBrace >= 0 && lastBrace > firstBrace
    ? trimmed.slice(firstBrace, lastBrace + 1)
    : undefined;
}
