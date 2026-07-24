import { IsEnum, IsIn, IsNotEmpty, IsString } from 'class-validator';
import { IsInternationalPhone } from '../../common/validators/is-international-phone.validator';
import { Role } from '../../schemas/user.schema';

export const SUPPORTED_PROFILE_LANGUAGES = [
  'ar',
  'de',
  'en',
  'es',
  'fr',
  'it',
] as const;

export class CompleteGoogleProfileDto {
  @IsInternationalPhone({
    message:
      'phone must be a valid international phone number (e.g. +21612345678)',
  })
  phone: string;

  @IsEnum(Role)
  @IsIn([Role.OPERATOR, Role.TECHNICIAN])
  role: Role.OPERATOR | Role.TECHNICIAN;

  @IsString()
  @IsNotEmpty()
  department: string;

  @IsString()
  @IsNotEmpty()
  position: string;

  @IsString()
  @IsIn(SUPPORTED_PROFILE_LANGUAGES)
  language: (typeof SUPPORTED_PROFILE_LANGUAGES)[number];
}
