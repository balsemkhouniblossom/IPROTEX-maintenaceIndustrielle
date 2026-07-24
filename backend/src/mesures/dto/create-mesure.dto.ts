import {
  IsDateString,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsString,
} from 'class-validator';

export class CreateMesureDto {
  @IsString()
  @IsNotEmpty()
  mesure_id!: string;

  @IsMongoId()
  capteur_id!: string;

  @IsNumber()
  valeur!: number;

  @IsDateString()
  timestamp!: string;

  @IsString()
  @IsNotEmpty()
  status!: string;
}
