import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ManualProductMttrValueDto {
  @IsMongoId()
  machineTypeId!: string;

  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(10_000_000)
  mttrMinutes!: number | null;
}

export class SaveManualProductMttrDto {
  @IsInt()
  @Min(2000)
  @Max(9999)
  year!: number;

  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ManualProductMttrValueDto)
  entries!: ManualProductMttrValueDto[];
}
