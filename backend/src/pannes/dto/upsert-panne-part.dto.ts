import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';
import { PannePartPriority } from '../../schemas/panne-part.schema';

export class UpsertPannePartDto {
  @IsMongoId()
  part_id: string;

  @IsInt()
  @IsPositive()
  recommended_quantity: number;

  @IsEnum(PannePartPriority)
  priority: PannePartPriority;

  @IsOptional()
  @IsString()
  note?: string;
}
