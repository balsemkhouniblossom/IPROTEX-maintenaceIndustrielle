export type EmailVerificationCode =
  | 'EMAIL_VERIFIED_PENDING_APPROVAL'
  | 'EMAIL_ALREADY_VERIFIED_PENDING_APPROVAL'
  | 'EMAIL_VERIFIED'
  | 'EMAIL_ALREADY_VERIFIED'
  | 'EMAIL_VERIFIED_ACCOUNT_REJECTED';

export type EmailVerificationRedirectState =
  | 'pending-approval'
  | 'already'
  | 'verified'
  | 'rejected'
  | 'failed';

export function getEmailVerificationRedirectState(
  code?: string,
): EmailVerificationRedirectState {
  if (
    code === 'EMAIL_VERIFIED_PENDING_APPROVAL' ||
    code === 'EMAIL_ALREADY_VERIFIED_PENDING_APPROVAL'
  ) {
    return 'pending-approval';
  }

  if (code === 'EMAIL_ALREADY_VERIFIED') {
    return 'already';
  }

  if (code === 'EMAIL_VERIFIED_ACCOUNT_REJECTED') {
    return 'rejected';
  }

  if (code === 'EMAIL_VERIFIED') {
    return 'verified';
  }

  return 'failed';
}

export function buildEmailVerificationRedirect(locale: string, code?: string): string {
  const state = getEmailVerificationRedirectState(code);
  return `/${locale}/auth/login?verified=${state}`;
}
