import {
  IsISO8601,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateMachineMaintenanceMttrDto {
  @IsMongoId()
  machineId: string;

  @IsISO8601({ strict: true })
  startedAt: string;

  @IsISO8601({ strict: true })
  endedAt: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpdateMachineMaintenanceMttrDto {
  @IsOptional()
  @IsMongoId()
  machineId?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  startedAt?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  endedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
