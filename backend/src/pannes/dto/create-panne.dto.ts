import {
  IsBoolean,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreatePanneDto {
  @IsString()
  @IsNotEmpty()
  panne_id: string;

  @IsString()
  @IsNotEmpty()
  code_panne: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsMongoId()
  machine_type_id: string;

  @IsString()
  @IsNotEmpty()
  component: string;

  @IsOptional()
  @IsString()
  gravite?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
