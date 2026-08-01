import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateTechnicianReportDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  cause_racine?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description_action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  etat_final?: string;
}
