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
  TranslatableEntityType,
  TranslatableField,
} from '../dynamic-content-translation.types';

export class BatchTranslationItemDto {
  @IsIn(['workOrder'])
  entityType: TranslatableEntityType;

  @IsString()
  entityId: string;

  @IsArray()
  @ArrayMaxSize(3)
  @IsIn(['description', 'reschedule_reason', 'lifecycle_history.reason'], {
    each: true,
  })
  fields: TranslatableField[];
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
