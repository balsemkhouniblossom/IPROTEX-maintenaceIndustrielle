import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsDateString,
} from 'class-validator';

export class CreateWorkOrderDto {
  @IsString()
  @IsNotEmpty()
  ot_id: string;

  @IsString()
  @IsNotEmpty()
  machine_id: string;

  @IsString()
  @IsOptional()
  module_id?: string;

  @IsString()
  @IsOptional()
  technician_id?: string;

  @IsString()
  @IsOptional()
  plan_id?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  type_maintenance?: string;

  @IsString()
  @IsNotEmpty()
  status: string;

  @IsString()
  @IsOptional()
  priorite?: string;

  @IsString()
  @IsOptional()
  code_panne?: string;

  @IsDateString()
  @IsNotEmpty()
  date_created: string;

  @IsDateString()
  @IsOptional()
  date_start?: string;

  @IsDateString()
  @IsOptional()
  scheduled_date?: string;

  @IsDateString()
  @IsOptional()
  due_date?: string;

  @IsDateString()
  @IsOptional()
  execution_date?: string;

  @IsDateString()
  @IsOptional()
  date_end?: string;

  @IsDateString()
  @IsOptional()
  date_closed?: string;

  @IsString()
  @IsOptional()
  recurrence_source_occurrence_id?: string;

  @IsDateString()
  @IsOptional()
  original_due_date?: string;

  @IsString()
  @IsOptional()
  reschedule_reason?: string;

  @IsString()
  @IsOptional()
  rescheduled_by?: string;

  @IsDateString()
  @IsOptional()
  rescheduled_at?: string;
}
