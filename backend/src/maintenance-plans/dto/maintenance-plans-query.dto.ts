import { IsOptional, IsString } from 'class-validator';
import { SortablePaginatedSearchQueryDto } from '../../common/dto/paginated-query.dto';

export class MaintenancePlansQueryDto extends SortablePaginatedSearchQueryDto {
  /** Comma-separated `status` values, e.g. `active,paused`. */
  @IsOptional()
  @IsString()
  status?: string;

  /** Comma-separated `type_maintenance` values, e.g. `preventive,corrective`. */
  @IsOptional()
  @IsString()
  typeMaintenance?: string;
}
