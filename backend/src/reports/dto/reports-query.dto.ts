import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginatedQueryDto } from '../../common/dto/paginated-query.dto';
import {
  ReportFormat,
  ReportStatus,
  ReportType,
} from '../../schemas/generated-report.schema';

export class ReportsQueryDto extends PaginatedQueryDto {
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
