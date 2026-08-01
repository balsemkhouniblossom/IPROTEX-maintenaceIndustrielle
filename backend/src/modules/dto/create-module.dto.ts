import { IsMongoId, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateModuleDto {
  @IsString()
  @IsNotEmpty()
  module_id: string;

  @IsMongoId()
  machine_id: string;

  @IsMongoId()
  mod_type_id: string;

  @IsOptional()
  @IsMongoId()
  parent_module_id?: string;

  @IsOptional()
  @IsString()
  localisation?: string;
}
