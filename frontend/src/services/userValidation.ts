import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
} from 'libphonenumber-js';

const countryCodes = new Set(getCountries().map((country) => getCountryCallingCode(country)));

export const PASSWORD_POLICY = {
  minLength: 8,
  uppercase: /[A-Z]/,
  lowercase: /[a-z]/,
  number: /\d/,
  special: /[^A-Za-z0-9]/,
};

export function validatePasswordPolicy(password: string): boolean {
  return (
    password.length >= PASSWORD_POLICY.minLength &&
    PASSWORD_POLICY.uppercase.test(password) &&
    PASSWORD_POLICY.lowercase.test(password) &&
    PASSWORD_POLICY.number.test(password) &&
    PASSWORD_POLICY.special.test(password)
  );
}

export function validateInternationalPhone(phone?: string): boolean {
  if (!phone?.trim()) {
    return true;
  }

  const normalized = phone.trim();

  if (!/^\+\d{8,15}$/.test(normalized)) {
    return false;
  }

  const digits = normalized.slice(1);
  const hasValidCountryCode = [1, 2, 3].some((length) =>
    countryCodes.has(digits.slice(0, length)),
  );

  if (!hasValidCountryCode) {
    return false;
  }

  const parsed = parsePhoneNumberFromString(normalized);
  return parsed ? parsed.isValid() || parsed.isPossible() : true;
}
