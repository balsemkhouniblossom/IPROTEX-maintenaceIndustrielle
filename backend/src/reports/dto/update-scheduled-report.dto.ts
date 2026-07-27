import { IsBoolean, IsEnum, IsObject, IsOptional } from 'class-validator';
import { ScheduleFrequency } from '../../schemas/scheduled-report.schema';

export class UpdateScheduledReportDto {
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsEnum(ScheduleFrequency)
  frequency?: ScheduleFrequency;

  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;
}
