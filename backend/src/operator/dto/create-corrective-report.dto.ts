import {
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export const CORRECTIVE_REPORT_PRIORITIES = [
  'low',
  'medium',
  'high',
  'urgent',
] as const;

/**
 * Intentionally has no author/technician/operator identity field and no
 * status/validation field: those are always derived server-side from the
 * authenticated request, never trusted from the client body. The global
 * ValidationPipe (whitelist + forbidNonWhitelisted) rejects any request that
 * tries to smuggle extra fields such as technician_id in alongside this DTO.
 */
export class CreateCorrectiveReportDto {
  @IsMongoId()
  machine_id: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  code_panne: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  fault_description?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMinSize(1)
  @IsString({ each: true })
  actions: string[];

  @IsOptional()
  @IsIn(CORRECTIVE_REPORT_PRIORITIES)
  priority?: string;
}
