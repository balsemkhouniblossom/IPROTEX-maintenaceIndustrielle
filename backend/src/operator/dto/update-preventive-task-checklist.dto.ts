import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePreventiveTaskChecklistDto {
  @IsOptional()
  @IsIn(['pending', 'completed'])
  status?: 'pending' | 'completed';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
