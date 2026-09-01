import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsEnum,
  IsISO8601,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  AiAnomalyInputSource,
  AiAnomalyValidationStatus,
} from '../../schemas/ai-anomaly-analysis.schema';

export const AI_ANOMALY_MAX_REQUEST_ROWS = 512;

export class ImsAnomalyFeatureRowDto {
  @IsISO8601({ strict: true })
  timestamp: string;

  @IsString()
  experiment: string;

  @IsInt()
  @Min(1)
  sensor_channel: number;

  @IsInt()
  @Min(1)
  bearing: number;

  @IsString()
  axis: string;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  rms: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  standard_deviation: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  peak_to_peak: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  kurtosis: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  skewness: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  crest_factor: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  spectral_energy: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  dominant_frequency_hz: number;
}

export class CreateAiAnomalyAnalysisDto {
  @IsMongoId()
  machine_id: string;

  @IsOptional()
  @IsMongoId()
  capteur_id?: string;

  @IsEnum(AiAnomalyInputSource)
  input_source: AiAnomalyInputSource;

  @ValidateNested({ each: true })
  @Type(() => ImsAnomalyFeatureRowDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(AI_ANOMALY_MAX_REQUEST_ROWS)
  rows: ImsAnomalyFeatureRowDto[];
}

export class CreateAiAnomalyBatchDto extends CreateAiAnomalyAnalysisDto {}

export class AiAnomalyQueryDto {
  @IsOptional()
  page?: string;

  @IsOptional()
  limit?: string;

  @IsOptional()
  @IsMongoId()
  machine_id?: string;

  @IsOptional()
  @IsEnum(AiAnomalyValidationStatus)
  validation_status?: AiAnomalyValidationStatus;

  @IsOptional()
  @IsString()
  risk_level?: string;

  @IsOptional()
  @IsEnum(AiAnomalyInputSource)
  input_source?: AiAnomalyInputSource;

  @IsOptional()
  @IsISO8601({ strict: true })
  dateFrom?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  dateTo?: string;
}

export class ValidateAiAnomalyAnalysisDto {
  @IsIn([
    AiAnomalyValidationStatus.CONFIRMED,
    AiAnomalyValidationStatus.REJECTED,
  ])
  validation_status:
    | AiAnomalyValidationStatus.CONFIRMED
    | AiAnomalyValidationStatus.REJECTED;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  validation_comment?: string;
}
