import { getAuthErrorCode } from './authErrors.ts';
import { parseLocalLoginSession, type LoginSession } from './localLogin.ts';
import { getAuthenticatedAccountDestination } from './sessionGuard.ts';

export type GoogleResultStatus =
  | 'created-pending'
  | 'pending'
  | 'rejected'
  | 'inactive'
  | 'failed';

export async function exchangeGoogleLoginCode(
  code: string,
): Promise<LoginSession> {
  try {
    const { default: api } = await import('./api.ts');
    const response = await api.post(
      '/auth/google/exchange',
      { code },
      { withCredentials: true },
    );
    return parseLocalLoginSession(response.data);
  } catch (error) {
    const codeValue = getAuthErrorCode(error);
    throw new Error(codeValue || 'GOOGLE_LOGIN_EXCHANGE_INVALID_OR_EXPIRED');
  }
}

export function isGoogleResultStatus(
  status: string | null,
): status is GoogleResultStatus {
  return (
    status === 'created-pending' ||
    status === 'pending' ||
    status === 'rejected' ||
    status === 'inactive' ||
    status === 'failed'
  );
}

/**
 * Defers to the same centralized account-lifecycle destination used by
 * ProtectedRoute and the Complete Profile page, so the Google result page
 * doesn't maintain its own copy of the incomplete/pending/rejected/inactive
 * priority rules.
 */
export function getGooglePostExchangeRedirect(
  locale: string,
  user: LoginSession['user'],
): string {
  return getAuthenticatedAccountDestination(locale, user);
}
