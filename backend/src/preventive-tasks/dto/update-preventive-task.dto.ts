import { PartialType } from '@nestjs/mapped-types';
import { IsDateString, IsOptional } from 'class-validator';
import { CreatePreventiveTaskDto } from './create-preventive-task.dto';

export class UpdatePreventiveTaskDto extends PartialType(
  CreatePreventiveTaskDto,
) {
  @IsDateString() @IsOptional() completed_at?: string;
}
