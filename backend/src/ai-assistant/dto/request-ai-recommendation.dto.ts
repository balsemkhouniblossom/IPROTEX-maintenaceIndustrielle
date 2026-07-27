import {
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const SUPPORTED_LOCALES = ['en', 'fr', 'es', 'de', 'it', 'ar'];

export class RequestAiRecommendationDto {
  @IsOptional()
  @IsMongoId()
  machineId?: string;

  @IsOptional()
  @IsMongoId()
  workOrderId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  faultCode?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  question: string;

  @IsIn(SUPPORTED_LOCALES)
  locale: string;
}
