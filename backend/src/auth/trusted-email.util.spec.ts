import { isTrustedIprotexEmail } from './trusted-email.util';

describe('isTrustedIprotexEmail', () => {
  it.each([
    'employee@iprotex.com',
    'employee@IPROTEX.com',
    'Iprotex.employee@example.com',
    '  employee@Iprotex.example  ',
  ])('trusts %s regardless of casing or surrounding whitespace', (email) => {
    expect(isTrustedIprotexEmail(email)).toBe(true);
  });

  it.each([
    'employee@example.com',
    'ipro@example.com',
    'employee@company.test',
  ])('does not trust unrelated address %s', (email) => {
    expect(isTrustedIprotexEmail(email)).toBe(false);
  });
});
