import { IsDateString, IsOptional, IsString } from 'class-validator';
import { PaginatedSearchQueryDto } from '../../common/dto/paginated-query.dto';

/** Mirrors work-orders/dto/work-orders-query.dto.ts's shape/decorator conventions. No `sort` param — the timeline is always newest-first. */
export class MachineTimelineQueryDto extends PaginatedSearchQueryDto {
  limit?: number = 20;

  /** Comma-separated `MachineTimelineCategory` values, e.g. `preventive,corrective`. */
  @IsOptional()
  @IsString()
  types?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
