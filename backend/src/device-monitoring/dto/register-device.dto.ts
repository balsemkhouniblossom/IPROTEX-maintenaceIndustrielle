import { IsEnum, IsInt, IsMongoId, IsOptional, IsPositive, IsString } from 'class-validator';
import { DeviceType } from '../../schemas/device.schema';

export class RegisterDeviceDto {
  @IsString()
  device_id: string;

  @IsMongoId()
  machine_id: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsEnum(DeviceType)
  device_type: DeviceType;

  @IsOptional()
  @IsInt()
  @IsPositive()
  heartbeat_interval_seconds?: number;
}
