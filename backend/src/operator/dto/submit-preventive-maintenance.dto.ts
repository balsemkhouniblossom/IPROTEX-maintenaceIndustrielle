import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsMongoId,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

class LubricationInputDto {
  @IsMongoId()
  lubrifiant_id: string;

  @IsInt()
  @IsPositive()
  quantity: number;
}

/**
 * Intentionally has no author/technician/operator identity field, no status
 * field, and no execution/date field: those are always derived server-side
 * (identity from the authenticated request, execution date/time from the
 * server clock at the moment the transaction runs). The global ValidationPipe
 * (whitelist + forbidNonWhitelisted) rejects any request that tries to
 * smuggle one of those in alongside this DTO.
 */
export class SubmitPreventiveMaintenanceDto {
  @IsMongoId()
  work_order_id: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMinSize(1)
  @IsString({ each: true })
  tasks_completed: string[];

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  condition: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comments?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LubricationInputDto)
  lubrication?: LubricationInputDto;
}
