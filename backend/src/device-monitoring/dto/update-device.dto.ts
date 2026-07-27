import { IsBoolean, IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

export class UpdateDeviceDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsInt()
  @IsPositive()
  heartbeat_interval_seconds?: number;
}
