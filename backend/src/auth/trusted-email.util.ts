/**
 * IPROTEX accounts are trusted for automatic account approval.
 * Email addresses are normalized before matching, so the check is
 * intentionally case-insensitive (IPROTEX, Iprotex, iprotex, etc.).
 */
export function isTrustedIprotexEmail(email: string): boolean {
  return email.trim().toLowerCase().includes('iprotex');
}
