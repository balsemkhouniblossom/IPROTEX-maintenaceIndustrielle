import { IsDateString, IsMongoId, IsOptional, IsString } from 'class-validator';
import { SortablePaginatedSearchQueryDto } from '../../common/dto/paginated-query.dto';

export class WorkOrdersQueryDto extends SortablePaginatedSearchQueryDto {
  /** Comma-separated `status` values, e.g. `open,in_progress`. */
  @IsOptional()
  @IsString()
  status?: string;

  /** Comma-separated `priorite` values, e.g. `high,critical`. */
  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsMongoId()
  machineId?: string;

  @IsOptional()
  @IsMongoId()
  technicianId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
