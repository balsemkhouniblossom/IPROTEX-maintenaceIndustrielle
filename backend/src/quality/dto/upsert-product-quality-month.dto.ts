import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpsertProductQualityMonthDto {
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  resolvedDefects!: number;

  @IsInt()
  @Min(1)
  @Max(100_000_000)
  totalResolutionMinutes!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
