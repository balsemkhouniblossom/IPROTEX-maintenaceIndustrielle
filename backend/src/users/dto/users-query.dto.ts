import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApprovalStatus } from '../../schemas/user.schema';

export class UsersQueryDto {
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
  limit?: number = 10;

  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  search?: string;

  @IsOptional()
  @IsIn(Object.values(ApprovalStatus))
  approvalStatus?: ApprovalStatus;

  /** `field` for ascending, `-field` for descending; restricted server-side to an allow-list (see `USERS_SORT_ALLOWED_FIELDS`). */
  @IsOptional()
  @IsString()
  sort?: string;
}
