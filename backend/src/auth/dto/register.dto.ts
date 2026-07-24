import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { IsInternationalPhone } from '../../common/validators/is-international-phone.validator';

export enum PublicRegistrationRole {
  OPERATOR = 'operator',
  TECHNICIAN = 'technician',
}

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  @Transform(({ value }: { value: unknown }) => normalizeOptionalString(value))
  nom_complet: string;

  @IsEmail()
  @IsNotEmpty()
  @Transform(({ value }: { value: unknown }) => normalizeEmail(value))
  email: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/, {
    message:
      'password must be at least 8 characters and include uppercase, lowercase, number, and special character',
  })
  password: string;

  @IsEnum(PublicRegistrationRole)
  @IsNotEmpty()
  role: PublicRegistrationRole;

  @IsOptional()
  @IsInternationalPhone({
    message:
      'phone must be a valid international phone number (e.g. +21612345678)',
  })
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) => normalizeOptionalString(value))
  department?: string;
}

function normalizeOptionalString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function normalizeEmail(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}
