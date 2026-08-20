import { IsIn, IsOptional } from 'class-validator';
import { PaginatedSearchQueryDto } from '../../common/dto/paginated-query.dto';
import { Role } from '../../schemas/user.schema';

export class PendingApprovalsQueryDto extends PaginatedSearchQueryDto {
  limit?: number = 20;

  @IsOptional()
  @IsIn([Role.OPERATOR, Role.TECHNICIAN])
  role?: Role.OPERATOR | Role.TECHNICIAN;

  @IsOptional()
  @IsIn(['verified', 'unverified', 'all'])
  emailVerified?: 'verified' | 'unverified' | 'all' = 'all';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'asc';
}
