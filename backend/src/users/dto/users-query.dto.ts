import { IsIn, IsOptional } from 'class-validator';
import { SortablePaginatedSearchQueryDto } from '../../common/dto/paginated-query.dto';
import { ApprovalStatus } from '../../schemas/user.schema';

export class UsersQueryDto extends SortablePaginatedSearchQueryDto {
  @IsOptional()
  @IsIn(Object.values(ApprovalStatus))
  approvalStatus?: ApprovalStatus;
}
