import { AsYouType, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js';

export const PHONE_COUNTRY_OPTIONS = [
  { country: 'TN', label: 'Tunisia', dialCode: '+216', digitsHint: '8 digits' },
  { country: 'FR', label: 'France', dialCode: '+33', digitsHint: '9 digits' },
  { country: 'DE', label: 'Germany', dialCode: '+49', digitsHint: '10 to 11 digits' },
  { country: 'IT', label: 'Italy', dialCode: '+39', digitsHint: '9 to 10 digits' },
  { country: 'ES', label: 'Spain', dialCode: '+34', digitsHint: '9 digits' },
  { country: 'GB', label: 'United Kingdom', dialCode: '+44', digitsHint: '10 digits' },
  { country: 'US', label: 'United States', dialCode: '+1', digitsHint: '10 digits' },
  { country: 'CA', label: 'Canada', dialCode: '+1', digitsHint: '10 digits' },
  { country: 'MA', label: 'Morocco', dialCode: '+212', digitsHint: '9 digits' },
  { country: 'DZ', label: 'Algeria', dialCode: '+213', digitsHint: '9 digits' },
  { country: 'BE', label: 'Belgium', dialCode: '+32', digitsHint: '8 to 9 digits' },
  { country: 'CH', label: 'Switzerland', dialCode: '+41', digitsHint: '9 digits' },
] as const;

export type PhoneCountryCode = (typeof PHONE_COUNTRY_OPTIONS)[number]['country'];

export interface PhoneInputValue {
  country: PhoneCountryCode;
  nationalNumber: string;
}

export const DEFAULT_PHONE_COUNTRY: PhoneCountryCode = 'TN';

function normalizeDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export function getPhoneCountryOption(country: PhoneCountryCode) {
  return PHONE_COUNTRY_OPTIONS.find((option) => option.country === country) ?? PHONE_COUNTRY_OPTIONS[0];
}

export function formatNationalPhone(country: PhoneCountryCode, nationalNumber: string): string {
  const digits = normalizeDigits(nationalNumber);
  if (!digits) return '';

  const formatter = new AsYouType(country);
  return formatter.input(digits);
}

export function validateNationalPhone(country: PhoneCountryCode, nationalNumber: string): boolean {
  const digits = normalizeDigits(nationalNumber);
  if (!digits) return true;

  const parsed = parsePhoneNumberFromString(digits, country);
  return Boolean(parsed?.isValid() || parsed?.isPossible());
}

export function buildInternationalPhone(country: PhoneCountryCode, nationalNumber: string): string {
  const digits = normalizeDigits(nationalNumber);
  if (!digits) return '';

  const parsed = parsePhoneNumberFromString(digits, country);
  if (parsed?.number) {
    return parsed.number;
  }

  return `+${getCountryCallingCode(country)}${digits}`;
}

export function parseInternationalPhoneValue(phone?: string | null): PhoneInputValue {
  if (!phone?.trim()) {
    return {
      country: DEFAULT_PHONE_COUNTRY,
      nationalNumber: '',
    };
  }

  const normalized = phone.trim();
  const parsed = parsePhoneNumberFromString(normalized);

  if (parsed?.country) {
    return {
      country: parsed.country as PhoneCountryCode,
      nationalNumber: String(parsed.nationalNumber ?? normalizeDigits(parsed.formatNational())),
    };
  }

  return {
    country: DEFAULT_PHONE_COUNTRY,
    nationalNumber: normalizeDigits(normalized),
  };
}

