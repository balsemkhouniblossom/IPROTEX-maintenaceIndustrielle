import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateSavedViewDto {
  @IsString()
  @MinLength(1)
  pageKey!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsObject()
  query!: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
