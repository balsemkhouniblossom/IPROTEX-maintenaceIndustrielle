import { IsEnum, IsObject, IsOptional } from 'class-validator';
import { ReportFormat, ReportType } from '../../schemas/generated-report.schema';

export class RequestReportDto {
  @IsEnum(ReportType)
  type!: ReportType;

  @IsEnum(ReportFormat)
  format!: ReportFormat;

  /** Raw filter values as given by the caller (ISO date strings, ids) — normalized into real `Date`s by `ReportsService.normalizeParams` right before a data provider runs. Stored verbatim on the `GeneratedReport` row for reproducibility. */
  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;
}
