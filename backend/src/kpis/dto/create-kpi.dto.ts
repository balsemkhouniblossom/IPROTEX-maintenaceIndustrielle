import {
  IsDateString,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateKpiDto {
  @IsString()
  @IsNotEmpty()
  kpi_id: string;

  @IsMongoId()
  machine_id: string;

  @IsOptional()
  @IsNumber()
  mtbf_value?: number;

  @IsOptional()
  @IsNumber()
  mttr_value?: number;

  @IsOptional()
  @IsNumber()
  availability_rate?: number;

  @IsDateString()
  date_calcul: string;

  @IsDateString()
  periode_debut: string;

  @IsDateString()
  periode_fin: string;
}
