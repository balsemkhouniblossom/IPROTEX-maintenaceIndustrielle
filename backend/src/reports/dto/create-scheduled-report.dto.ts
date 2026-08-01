import { IsEnum, IsObject, IsOptional } from 'class-validator';
import {
  ReportFormat,
  ReportType,
} from '../../schemas/generated-report.schema';
import { ScheduleFrequency } from '../../schemas/scheduled-report.schema';

export class CreateScheduledReportDto {
  @IsEnum(ReportType)
  type!: ReportType;

  @IsEnum(ReportFormat)
  format!: ReportFormat;

  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;

  @IsEnum(ScheduleFrequency)
  frequency!: ScheduleFrequency;
}
