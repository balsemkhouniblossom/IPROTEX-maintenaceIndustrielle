import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  ReportFormat,
  ReportStatus,
  ReportType,
} from '../../schemas/generated-report.schema';

export class ReportsQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsIn(Object.values(ReportType))
  type?: ReportType;

  @IsOptional()
  @IsIn(Object.values(ReportStatus))
  status?: ReportStatus;

  @IsOptional()
  @IsIn(Object.values(ReportFormat))
  format?: ReportFormat;

  /** `field` for ascending, `-field` for descending; restricted server-side to an allow-list. */
  @IsOptional()
  @IsString()
  sort?: string;
}
