import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateLubrifiantDto {
  @IsString()
  @IsNotEmpty()
  lubrifiant_id: string;

  @IsString()
  @IsNotEmpty()
  nom: string;

  @IsString()
  @IsNotEmpty()
  type: string;

  @IsOptional()
  @IsString()
  viscosite?: string;

  @IsOptional()
  @IsString()
  usage?: string;
}
