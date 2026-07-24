import {
  IsBoolean,
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  IsMongoId,
  ValidateIf,
} from 'class-validator';
import { Role } from '../../schemas/user.schema';
import { IsInternationalPhone } from '../../common/validators/is-international-phone.validator';

export class CreateUserDto {
  @IsString()
  @IsOptional() // Made optional since it will be auto-generated
  user_id?: string;

  @IsString()
  @IsNotEmpty()
  nom_complet: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ValidateIf((dto: CreateUserDto) => !dto.google_id)
  @IsString()
  @IsNotEmpty()
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/, {
    message:
      'password must be at least 8 characters and include uppercase, lowercase, number, and special character',
  })
  password?: string;

  @IsEnum(Role)
  @IsNotEmpty()
  role: Role;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;

  @IsBoolean()
  @IsOptional()
  is_verified?: boolean;

  @IsDateString()
  @IsOptional()
  last_login?: string;

  @IsDateString()
  @IsOptional()
  created_at?: string;

  @IsOptional()
  @IsInternationalPhone({
    message:
      'phone must be a valid international phone number (e.g. +21612345678)',
  })
  phone?: string;

  @IsString()
  @IsOptional()
  department?: string;

  @IsString()
  @IsOptional()
  position?: string;

  @IsString()
  @IsOptional()
  language?: string;

  @IsBoolean()
  @IsOptional()
  profile_completed?: boolean;

  @IsString()
  @IsOptional()
  photo?: string;

  @IsString()
  @IsOptional()
  photo_storage_path?: string;

  @IsString()
  @IsOptional()
  photo_url?: string;

  @IsArray()
  @IsMongoId({ each: true })
  @IsOptional()
  assigned_machine_ids?: string[];

  @IsString()
  @IsOptional()
  google_id?: string;
}
