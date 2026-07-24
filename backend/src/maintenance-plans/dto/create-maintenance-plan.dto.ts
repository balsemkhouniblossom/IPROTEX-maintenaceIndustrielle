import {
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';

/**
 * There is intentionally no `status`/`version`/`lifecycle_history` field
 * here: every new plan always starts life as Draft at version 1 with a
 * single "created" history entry — that is derived server-side, never
 * accepted from the client.
 */
export class CreateMaintenancePlanDto {
  @IsString()
  @IsNotEmpty()
  plan_id: string;

  @IsMongoId()
  module_id: string;

  @IsString()
  @IsNotEmpty()
  type_maintenance: string;

  @IsInt()
  @IsPositive()
  frequence: number;

  @IsString()
  @IsNotEmpty()
  unite_frequence: string;

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
}

export const MAINTENANCE_PLAN_TRANSITION_ACTIONS = [
  'activate',
  'pause',
  'resume',
  'archive',
  'complete',
] as const;

export type MaintenancePlanTransitionAction =
  (typeof MAINTENANCE_PLAN_TRANSITION_ACTIONS)[number];

export class TransitionMaintenancePlanDto {
  @IsIn(MAINTENANCE_PLAN_TRANSITION_ACTIONS)
  action: MaintenancePlanTransitionAction;

  @IsString()
  @IsOptional()
  reason?: string;
}
