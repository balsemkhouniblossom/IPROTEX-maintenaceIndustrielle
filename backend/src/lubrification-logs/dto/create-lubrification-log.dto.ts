import {
  IsDateString,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsString,
  Min,
} from 'class-validator';

export class CreateLubrificationLogDto {
  @IsString()
  @IsNotEmpty()
  log_id: string;

  @IsMongoId()
  module_id: string;

  @IsMongoId()
  lubrifiant_id: string;

  @IsDateString()
  date_application: string;

  @IsInt()
  @Min(1)
  quantite: number;

  @IsMongoId()
  technician_id: string;
}
