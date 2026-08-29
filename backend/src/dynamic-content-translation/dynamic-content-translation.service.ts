import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { WorkOrder, WorkOrderDocument } from '../schemas/work-order.schema';
import {
  TranslationCache,
  TranslationCacheDocument,
} from '../schemas/translation-cache.schema';
import { BatchTranslationDto } from './dto/batch-translation.dto';
import {
  SupportedContentLocale,
  SUPPORTED_CONTENT_LOCALES,
  TranslatableEntityType,
  TranslationActor,
  TranslationResultItem,
  WorkOrderTranslatableField,
  WORK_ORDER_TRANSLATABLE_FIELDS,
} from './dynamic-content-translation.types';
import { GeminiDynamicTranslationProvider } from './dynamic-translation.provider';

const MAX_BATCH_ITEMS = 25;
const MAX_FIELD_RESULTS = 75;
const MAX_TEXT_LENGTH = 4000;
const DEFAULT_SOURCE_LOCALE: SupportedContentLocale = 'en';
const PROTECTED_TOKEN_FILE_EXTENSIONS = [
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.zip',
] as const;
const PROTECTED_TOKEN_UNITS = new Set([
  'mm',
  'cm',
  'm',
  'kg',
  'g',
  'l',
  'L',
  'bar',
  'psi',
  'V',
  'A',
  'kW',
  'W',
  'Hz',
  'rpm',
  '\u00b0C',
  'C',
]);

const ALLOWED_FIELDS: Record<
  TranslatableEntityType,
  readonly WorkOrderTranslatableField[]
> = {
  workOrder: WORK_ORDER_TRANSLATABLE_FIELDS,
};

@Injectable()
export class DynamicContentTranslationService {
  private readonly logger = new Logger(DynamicContentTranslationService.name);

  constructor(
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
    @InjectModel(TranslationCache.name)
    private readonly cacheModel: Model<TranslationCacheDocument>,
    private readonly provider: GeminiDynamicTranslationProvider,
    private readonly configService: ConfigService,
  ) {}

  async batch(
    actor: TranslationActor,
    dto: BatchTranslationDto,
  ): Promise<{ items: TranslationResultItem[] }> {
    const targetLocale = this.assertLocale(dto.targetLocale, 'targetLocale');
    const sourceLocale = this.assertLocale(
      dto.sourceLocale ?? DEFAULT_SOURCE_LOCALE,
      'sourceLocale',
    );
    if (!dto.items.length) return { items: [] };
    if (dto.items.length > MAX_BATCH_ITEMS) {
      throw new BadRequestException(
        `Batch limit is ${MAX_BATCH_ITEMS} entities`,
      );
    }

    const results: TranslationResultItem[] = [];
    const seenRequests = new Set<string>();
    for (const item of dto.items) {
      const itemResults = await this.translateBatchItem(
        actor,
        item,
        sourceLocale,
        targetLocale,
        seenRequests,
      );
      for (const result of itemResults) {
        if (results.length >= MAX_FIELD_RESULTS) {
          throw new BadRequestException(
            `Translation field result limit is ${MAX_FIELD_RESULTS}`,
          );
        }
        results.push(result);
      }
    }

    return { items: results };
  }

  private async translateBatchItem(
    actor: TranslationActor,
    item: BatchTranslationDto['items'][number],
    sourceLocale: SupportedContentLocale,
    targetLocale: SupportedContentLocale,
    seenRequests: Set<string>,
  ): Promise<TranslationResultItem[]> {
    if (item.entityType !== 'workOrder') {
      throw new BadRequestException('Unsupported entityType');
    }
    this.assertAllowedFields(item.entityType, item.fields);
    const workOrder = await this.loadAccessibleWorkOrder(actor, item.entityId);

    const results: TranslationResultItem[] = [];
    for (const requestField of new Set(item.fields)) {
      const requestKey = `${item.entityType}:${workOrder._id.toString()}:${requestField}`;
      if (seenRequests.has(requestKey)) continue;
      seenRequests.add(requestKey);

      const fieldResults = await this.translateExtractedFields(
        workOrder,
        requestField,
        sourceLocale,
        targetLocale,
      );
      results.push(...fieldResults);
    }
    return results;
  }

  private async translateExtractedFields(
    workOrder: WorkOrderDocument,
    requestField: WorkOrderTranslatableField,
    sourceLocale: SupportedContentLocale,
    targetLocale: SupportedContentLocale,
  ): Promise<TranslationResultItem[]> {
    const results: TranslationResultItem[] = [];
    const entityId = workOrder._id.toString();
    const extracted = this.extractWorkOrderField(workOrder, requestField);
    for (const fieldValue of extracted) {
      results.push(
        await this.translateField({
          entityType: 'workOrder',
          entityId,
          field: fieldValue.field,
          originalText: fieldValue.text,
          sourceLocale,
          targetLocale,
        }),
      );
    }
    return results;
  }

  private assertLocale(value: string, field: string): SupportedContentLocale {
    if (!SUPPORTED_CONTENT_LOCALES.includes(value as SupportedContentLocale)) {
      throw new BadRequestException(`Invalid ${field}`);
    }
    return value as SupportedContentLocale;
  }

  private assertAllowedFields(
    entityType: TranslatableEntityType,
    fields: readonly string[],
  ): void {
    const allowed = ALLOWED_FIELDS[entityType] ?? [];
    for (const field of fields) {
      if (!allowed.includes(field as WorkOrderTranslatableField)) {
        throw new BadRequestException(`Field "${field}" is not translatable`);
      }
    }
  }

  private async loadAccessibleWorkOrder(
    actor: TranslationActor,
    entityId: string,
  ): Promise<WorkOrderDocument> {
    if (!Types.ObjectId.isValid(entityId)) {
      throw new BadRequestException('Invalid workOrder entityId');
    }
    const workOrder = await this.workOrderModel.findById(entityId).exec();
    if (!workOrder) {
      throw new ForbiddenException('Work order is not accessible');
    }
    if (actor.role === 'admin') return workOrder;

    const technicianId = this.referenceToString(workOrder.technician_id);
    if (technicianId && technicianId === actor.userId) return workOrder;

    throw new ForbiddenException('Work order is not accessible');
  }

  private extractWorkOrderField(
    workOrder: WorkOrderDocument,
    field: WorkOrderTranslatableField,
  ): Array<{ field: string; text: string }> {
    if (field === 'description') {
      return typeof workOrder.description === 'string' &&
        workOrder.description.trim()
        ? [{ field, text: workOrder.description }]
        : [];
    }
    if (field === 'reschedule_reason') {
      return typeof workOrder.reschedule_reason === 'string' &&
        workOrder.reschedule_reason.trim()
        ? [{ field, text: workOrder.reschedule_reason }]
        : [];
    }

    return (workOrder.lifecycle_history ?? [])
      .map((entry, index) => ({
        field: `lifecycle_history.${index}.reason`,
        text: entry.reason,
      }))
      .filter((entry): entry is { field: string; text: string } =>
        Boolean(entry.text?.trim()),
      );
  }

  private async translateField(input: {
    entityType: 'workOrder';
    entityId: string;
    field: string;
    originalText: string;
    sourceLocale: SupportedContentLocale;
    targetLocale: SupportedContentLocale;
  }): Promise<TranslationResultItem> {
    const originalText = input.originalText;
    const sourceHash = hashSource(originalText);
    if (input.sourceLocale === input.targetLocale) {
      return this.result(input, originalText, 'original', {
        translatedText: originalText,
      });
    }
    if (originalText.length > MAX_TEXT_LENGTH) {
      return this.result(input, originalText, 'fallback', {
        translatedText: originalText,
      });
    }

    const cached = await this.cacheModel
      .findOne({
        entityType: input.entityType,
        entityId: input.entityId,
        field: input.field,
        targetLocale: input.targetLocale,
        sourceHash,
      })
      .exec();
    if (cached?.translatedText) {
      return this.result(input, originalText, 'cache_hit', {
        translatedText: cached.translatedText,
        provider: cached.provider,
        model: cached.model,
      });
    }

    const protectedTokens = extractProtectedTokens(originalText);
    try {
      const translated = await this.withTimeout((signal) =>
        this.provider.translate({
          text: originalText,
          sourceLocale: input.sourceLocale,
          targetLocale: input.targetLocale,
          protectedTokens,
          signal,
        }),
      );
      if (
        !isValidTranslation(
          originalText,
          translated.translatedText,
          protectedTokens,
        )
      ) {
        throw new Error('Invalid translated content');
      }
      await this.cacheModel.findOneAndUpdate(
        {
          entityType: input.entityType,
          entityId: input.entityId,
          field: input.field,
          targetLocale: input.targetLocale,
          sourceHash,
        },
        {
          $setOnInsert: {
            entityType: input.entityType,
            entityId: input.entityId,
            field: input.field,
            sourceLocale: input.sourceLocale,
            targetLocale: input.targetLocale,
            sourceHash,
            translatedText: translated.translatedText,
            provider: translated.provider,
            model: translated.model,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      return this.result(input, originalText, 'translated', translated);
    } catch (error) {
      this.logger.warn(
        `Dynamic translation fallback for ${input.entityType}/${input.entityId}/${input.field}: ${errorToLogMessage(
          error,
        )}`,
      );
      return this.result(input, originalText, 'fallback', {
        translatedText: originalText,
      });
    }
  }

  private async withTimeout<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const timeoutMs =
      Number(
        this.configService.get<string>('DYNAMIC_TRANSLATION_TIMEOUT_MS'),
      ) || 3500;
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation(controller.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('Dynamic translation provider timed out'));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private result(
    input: {
      entityType: 'workOrder';
      entityId: string;
      field: string;
      sourceLocale: SupportedContentLocale;
      targetLocale: SupportedContentLocale;
    },
    originalText: string,
    status: TranslationResultItem['status'],
    translated: { translatedText: string; provider?: string; model?: string },
  ): TranslationResultItem {
    return {
      entityType: input.entityType,
      entityId: input.entityId,
      field: input.field,
      sourceLocale: input.sourceLocale,
      targetLocale: input.targetLocale,
      originalText,
      translatedText: translated.translatedText,
      status,
      provider: translated.provider,
      model: translated.model,
      automaticallyTranslated:
        status === 'translated' || status === 'cache_hit',
      safetyNotice: status === 'translated' || status === 'cache_hit',
    };
  }

  private referenceToString(value: unknown): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (value instanceof Types.ObjectId) return value.toHexString();
    if (typeof value === 'object' && '_id' in value) {
      return this.referenceToString((value as { _id?: unknown })._id);
    }
    return '';
  }
}

function hashSource(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function errorToLogMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'number') return error.toString();
  if (typeof error === 'boolean') return error ? 'true' : 'false';
  if (typeof error === 'bigint') return error.toString();
  return 'Unknown dynamic translation error';
}

function extractProtectedTokens(text: string): string[] {
  const tokens = new Set<string>();
  const words = text.split(/\s+/);
  for (let index = 0; index < words.length; index += 1) {
    const word = trimToken(words[index]);
    if (!word) continue;
    collectStandaloneProtectedToken(tokens, word);

    const nextWord = trimToken(words[index + 1] ?? '');
    if (isMeasurementToken(word, nextWord)) {
      tokens.add(`${word} ${nextWord}`);
    }
  }
  return Array.from(tokens);
}

function collectStandaloneProtectedToken(tokens: Set<string>, word: string) {
  if (
    isUppercaseCodeToken(word) ||
    isUrlToken(word) ||
    isEmailToken(word) ||
    isFileToken(word)
  ) {
    tokens.add(word);
  }
}

function trimToken(value: string): string {
  const trimCharacters = '.,;:!?()[]{}<>"\'';
  let start = 0;
  let end = value.length;
  while (start < end && trimCharacters.includes(value[start])) {
    start += 1;
  }
  while (end > start && trimCharacters.includes(value[end - 1])) {
    end -= 1;
  }
  return value.slice(start, end);
}

function isUppercaseCodeToken(value: string): boolean {
  if (value.length < 2 || !isUppercaseAscii(value[0])) return false;
  let uppercaseCount = 0;
  for (const character of value) {
    if (isUppercaseAscii(character)) {
      uppercaseCount += 1;
      continue;
    }
    if (!isDigit(character) && character !== '-' && character !== '_') {
      return false;
    }
  }
  return uppercaseCount >= 2;
}

function isMeasurementToken(value: string, unit: string): boolean {
  return PROTECTED_TOKEN_UNITS.has(unit) && isDecimalNumber(value);
}

function isUrlToken(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

function isEmailToken(value: string): boolean {
  const atIndex = value.indexOf('@');
  const dotIndex = value.lastIndexOf('.');
  return atIndex > 0 && dotIndex > atIndex + 1 && dotIndex < value.length - 1;
}

function isFileToken(value: string): boolean {
  const lowerValue = value.toLowerCase();
  return PROTECTED_TOKEN_FILE_EXTENSIONS.some((extension) =>
    lowerValue.endsWith(extension),
  );
}

function isDecimalNumber(value: string): boolean {
  if (!value) return false;
  const decimalSeparator = value.includes(',') ? ',' : '.';
  const parts = value.split(decimalSeparator);
  if (parts.length > 2) return false;
  return parts.every(
    (part) => part.length > 0 && everyCharacter(part, isDigit),
  );
}

function isUppercaseAscii(value: string): boolean {
  const code = value.codePointAt(0);
  if (code === undefined) return false;
  return code >= 65 && code <= 90;
}

function isDigit(value: string): boolean {
  const code = value.codePointAt(0);
  if (code === undefined) return false;
  return code >= 48 && code <= 57;
}

function everyCharacter(
  value: string,
  predicate: (character: string) => boolean,
): boolean {
  for (const character of value) {
    if (!predicate(character)) return false;
  }
  return true;
}

function isValidTranslation(
  original: string,
  translated: string,
  protectedTokens: string[],
): boolean {
  if (!translated.trim()) return false;
  if (translated.length > Math.max(MAX_TEXT_LENGTH, original.length * 4)) {
    return false;
  }
  return protectedTokens.every((token) => translated.includes(token));
}
