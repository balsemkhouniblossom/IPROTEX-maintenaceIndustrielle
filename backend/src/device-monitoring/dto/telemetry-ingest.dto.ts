import { IsISO8601, IsObject, IsOptional } from 'class-validator';

export class TelemetryIngestDto {
  @IsObject()
  metrics: Record<string, number>;

  @IsOptional()
  @IsISO8601()
  recorded_at?: string;
}
