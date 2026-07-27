import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class MaintenancePlansQueryDto {
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

  /** Comma-separated `status` values, e.g. `active,paused`. */
  @IsOptional()
  @IsString()
  status?: string;

  /** Comma-separated `type_maintenance` values, e.g. `preventive,corrective`. */
  @IsOptional()
  @IsString()
  typeMaintenance?: string;

  /** `field` for ascending, `-field` for descending; restricted server-side to an allow-list. */
  @IsOptional()
  @IsString()
  sort?: string;
}
