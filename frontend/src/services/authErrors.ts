export const ACCOUNT_ACCESS_ERROR_CODES = [
  'INVALID_CREDENTIALS',
  'EMAIL_NOT_VERIFIED',
  'ACCOUNT_PENDING_APPROVAL',
  'ACCOUNT_REJECTED',
  'ACCOUNT_INACTIVE',
  'ACCOUNT_ROLE_NOT_ALLOWED',
  'PROFILE_COMPLETION_REQUIRED',
] as const;

export type AccountAccessErrorCode =
  (typeof ACCOUNT_ACCESS_ERROR_CODES)[number];

export const REFRESH_TOKEN_ERROR_CODES = [
  'REFRESH_TOKEN_MISSING',
  'REFRESH_TOKEN_INVALID',
  'REFRESH_TOKEN_EXPIRED',
  'REFRESH_TOKEN_INVALID_OR_EXPIRED',
  'REFRESH_TOKEN_REVOKED',
  'REFRESH_TOKEN_REUSE_DETECTED',
  'REFRESH_USER_NOT_FOUND',
  'REFRESH_TOKEN_SUBJECT_INVALID',
  'REFRESH_TOKEN_WRONG_TYPE',
] as const;

export type RefreshTokenErrorCode =
  (typeof REFRESH_TOKEN_ERROR_CODES)[number];

export type TerminalRefreshFailureCode =
  | RefreshTokenErrorCode
  | AccountAccessErrorCode;

const LOGIN_ERROR_MESSAGE_KEYS: Record<AccountAccessErrorCode, string> = {
  INVALID_CREDENTIALS: 'errors.invalidCredentials',
  EMAIL_NOT_VERIFIED: 'errors.emailNotVerified',
  ACCOUNT_PENDING_APPROVAL: 'errors.accountPendingApproval',
  ACCOUNT_REJECTED: 'errors.accountRejected',
  ACCOUNT_INACTIVE: 'errors.accountInactive',
  ACCOUNT_ROLE_NOT_ALLOWED: 'errors.accountRoleNotAllowed',
  PROFILE_COMPLETION_REQUIRED: 'errors.profileCompletionRequired',
};

export function isAccountAccessErrorCode(
  code: unknown,
): code is AccountAccessErrorCode {
  return (
    typeof code === 'string' &&
    ACCOUNT_ACCESS_ERROR_CODES.includes(code as AccountAccessErrorCode)
  );
}

export function getAuthErrorCode(error: unknown): AccountAccessErrorCode | null {
  const data = (
    error as { response?: { data?: { code?: unknown; message?: unknown } } }
  )?.response?.data;

  if (isAccountAccessErrorCode(data?.code)) {
    return data.code;
  }

  if (
    data?.message &&
    typeof data.message === 'object' &&
    'code' in data.message &&
    isAccountAccessErrorCode((data.message as { code?: unknown }).code)
  ) {
    return (data.message as { code: AccountAccessErrorCode }).code;
  }

  return null;
}

export function isRefreshTokenErrorCode(
  code: unknown,
): code is RefreshTokenErrorCode {
  return (
    typeof code === 'string' &&
    REFRESH_TOKEN_ERROR_CODES.includes(code as RefreshTokenErrorCode)
  );
}

export function getStableAuthFailureCode(
  error: unknown,
): TerminalRefreshFailureCode | null {
  const data = (
    error as { response?: { data?: { code?: unknown; message?: unknown } } }
  )?.response?.data;
  const code =
    data?.code ??
    (data?.message &&
    typeof data.message === 'object' &&
    'code' in data.message
      ? (data.message as { code?: unknown }).code
      : undefined);

  if (isRefreshTokenErrorCode(code)) {
    return code;
  }

  if (isAccountAccessErrorCode(code)) {
    return code;
  }

  return null;
}

export function isConfirmedRefreshAuthFailure(error: unknown): boolean {
  const response = (error as { response?: { status?: unknown } })?.response;
  const status = response?.status;
  const code = getStableAuthFailureCode(error);

  if (!code) {
    return false;
  }

  if (status === 401) {
    return true;
  }

  return status === 403 && isAccountAccessErrorCode(code);
}

export function getLoginRedirectForAuthFailure(
  locale: string,
  code: TerminalRefreshFailureCode | null,
): string {
  const safeLocale = locale || 'en';
  const stateByCode: Partial<Record<TerminalRefreshFailureCode, string>> = {
    EMAIL_NOT_VERIFIED: 'error=email-not-verified',
    ACCOUNT_PENDING_APPROVAL: 'error=pending-approval',
    ACCOUNT_REJECTED: 'error=rejected',
    ACCOUNT_INACTIVE: 'error=inactive',
    PROFILE_COMPLETION_REQUIRED: 'error=complete-profile',
    REFRESH_TOKEN_REVOKED: 'session=revoked',
    REFRESH_TOKEN_REUSE_DETECTED: 'session=revoked',
  };
  const state = (code && stateByCode[code]) || 'session=expired';

  return `/${safeLocale}/auth/login?${state}`;
}

export function getLoginErrorMessageKey(
  code: AccountAccessErrorCode | null,
): string {
  return code ? LOGIN_ERROR_MESSAGE_KEYS[code] : 'errors.authenticationFailed';
}
