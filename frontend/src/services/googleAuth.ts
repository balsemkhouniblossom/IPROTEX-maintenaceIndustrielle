import { getAuthErrorCode } from './authErrors.ts';
import { getDashboardPath } from './authRedirect.ts';
import { parseLocalLoginSession, type LoginSession } from './localLogin.ts';

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
    const response = await api.post('/auth/google/exchange', { code });
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

export function getGooglePostExchangeRedirect(
  locale: string,
  user: LoginSession['user'],
): string | null {
  if (user.profile_completed === false) {
    return `/${locale}/auth/complete-profile`;
  }

  return getDashboardPath(locale, user.role);
}
