import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  SUPPORTED_CONTENT_LOCALES,
  TRANSLATABLE_ENTITY_TYPES,
  TranslatableEntityType,
  WorkOrderTranslatableField,
  WORK_ORDER_TRANSLATABLE_FIELDS,
} from '../dynamic-content-translation.types';

export class BatchTranslationItemDto {
  @IsIn(TRANSLATABLE_ENTITY_TYPES)
  entityType: TranslatableEntityType;

  @IsString()
  entityId: string;

  @IsArray()
  @ArrayMaxSize(3)
  @IsIn(WORK_ORDER_TRANSLATABLE_FIELDS, {
    each: true,
  })
  fields: WorkOrderTranslatableField[];
}

export class BatchTranslationDto {
  @IsIn(SUPPORTED_CONTENT_LOCALES)
  targetLocale: (typeof SUPPORTED_CONTENT_LOCALES)[number];

  @IsOptional()
  @IsIn(SUPPORTED_CONTENT_LOCALES)
  sourceLocale?: (typeof SUPPORTED_CONTENT_LOCALES)[number];

  @IsArray()
  @ArrayMaxSize(25)
  @ValidateNested({ each: true })
  @Type(() => BatchTranslationItemDto)
  items: BatchTranslationItemDto[];
}
