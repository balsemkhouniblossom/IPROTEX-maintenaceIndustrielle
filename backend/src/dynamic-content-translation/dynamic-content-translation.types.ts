export const SUPPORTED_CONTENT_LOCALES = [
  'en',
  'fr',
  'ar',
  'es',
  'de',
  'it',
] as const;

export type SupportedContentLocale = (typeof SUPPORTED_CONTENT_LOCALES)[number];

export type TranslatableEntityType = 'workOrder';

export type WorkOrderTranslatableField =
  | 'description'
  | 'reschedule_reason'
  | 'lifecycle_history.reason';

export type TranslatableField = WorkOrderTranslatableField;

export type TranslationActor = {
  userId: string;
  role: string;
};

export type TranslationStatus =
  | 'original'
  | 'cache_hit'
  | 'translated'
  | 'fallback';

export type TranslationResultItem = {
  entityType: TranslatableEntityType;
  entityId: string;
  field: string;
  sourceLocale: SupportedContentLocale;
  targetLocale: SupportedContentLocale;
  originalText: string;
  translatedText: string;
  status: TranslationStatus;
  provider?: string;
  model?: string;
  automaticallyTranslated: boolean;
  safetyNotice: boolean;
};

export type DynamicTranslationProviderResult = {
  translatedText: string;
  provider: string;
  model: string;
};

export interface DynamicTranslationProvider {
  readonly name: string;
  translate(input: {
    text: string;
    sourceLocale: SupportedContentLocale;
    targetLocale: SupportedContentLocale;
    protectedTokens: string[];
    signal: AbortSignal;
  }): Promise<DynamicTranslationProviderResult>;
}
