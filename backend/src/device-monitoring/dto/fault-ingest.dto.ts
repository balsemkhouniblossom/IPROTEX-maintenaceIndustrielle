import { IsEnum, IsISO8601, IsOptional, IsString } from 'class-validator';
import { FaultEventSeverity } from '../../schemas/fault-event.schema';

export class FaultIngestDto {
  @IsString()
  code_panne: string;

  @IsOptional()
  @IsEnum(FaultEventSeverity)
  severity?: FaultEventSeverity;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsISO8601()
  raised_at?: string;
}
