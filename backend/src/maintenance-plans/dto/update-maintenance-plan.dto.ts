import {
  IsInt,
  IsMongoId,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';

/**
 * Same field set as creation, but every field is optional (partial update)
 * plus `expected_version`. There is still no `status`/`lifecycle_history`
 * field: status only ever changes through the dedicated transition
 * endpoint, never through a plain field edit.
 */
export class UpdateMaintenancePlanDto {
  @IsString()
  @IsOptional()
  plan_id?: string;

  @IsMongoId()
  @IsOptional()
  module_id?: string;

  @IsString()
  @IsOptional()
  type_maintenance?: string;

  @IsInt()
  @IsPositive()
  @IsOptional()
  frequence?: number;

  @IsString()
  @IsOptional()
  unite_frequence?: string;

  @IsString()
  @IsOptional()
  instruction?: string;

  @IsString()
  @IsOptional()
  responsable?: string;

  @IsString()
  @IsOptional()
  huile_graisse?: string;

  @IsString()
  @IsOptional()
  documentation?: string;

  @IsString()
  @IsOptional()
  maintenance_code?: string;

  @IsString()
  @IsOptional()
  frequence_label?: string;

  /**
   * Required only once the plan has at least one validated occurrence —
   * enforced in the service layer, not here, since that check needs a
   * database read. When required, a mismatch means someone else changed the
   * plan since the caller last loaded it.
   */
  @IsInt()
  @IsOptional()
  expected_version?: number;
}
