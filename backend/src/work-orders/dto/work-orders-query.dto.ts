import { Transform } from 'class-transformer';
import { IsDateString, IsInt, IsMongoId, IsOptional, IsString, Max, Min } from 'class-validator';

export class WorkOrdersQueryDto {
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

  /** `field` for ascending, `-field` for descending; restricted server-side to an allow-list. */
  @IsOptional()
  @IsString()
  sort?: string;
}
