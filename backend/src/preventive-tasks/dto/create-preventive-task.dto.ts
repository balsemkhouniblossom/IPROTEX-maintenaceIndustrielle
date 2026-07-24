import {
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreatePreventiveTaskDto {
  @IsString() @IsNotEmpty() task_id!: string;
  @IsMongoId() @IsOptional() plan_id?: string;
  @IsString() @IsOptional() plan_code?: string;
  @IsMongoId() @IsOptional() module_id?: string;
  @IsString() @IsNotEmpty() instruction!: string;
  @IsString() @IsOptional() responsable?: string;
  @IsIn(['pending', 'completed']) @IsOptional() status?:
    | 'pending'
    | 'completed';
  @IsString() @IsOptional() notes?: string;
}
