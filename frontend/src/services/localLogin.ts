import { getDashboardPath } from './authRedirect.ts';

export type LoginUser = {
  _id: string;
  user_id?: string;
  nom_complet: string;
  email: string;
  role: string;
  is_active: boolean;
  last_login?: string;
  created_at: string;
  phone?: string;
  department?: string;
  position?: string;
  language?: string;
  photo?: string;
  profile_completed?: boolean;
};

export type LoginSession = {
  authToken: string;
  refreshToken?: string;
  user: LoginUser;
};

export function parseLocalLoginSession(data: unknown): LoginSession {
  const loginData = data as {
    access_token?: unknown;
    token?: unknown;
    refresh_token?: unknown;
    user?: unknown;
  };
  const authToken = loginData.access_token ?? loginData.token;

  if (typeof authToken !== 'string' || !authToken || !loginData.user) {
    throw new Error('AUTHENTICATION_FAILED');
  }

  const user = loginData.user as LoginUser;

  if (user.profile_completed === false) {
    return {
      authToken,
      user,
      ...(typeof loginData.refresh_token === 'string'
        ? { refreshToken: loginData.refresh_token }
        : {}),
    };
  }

  if (!getDashboardPath('en', user.role)) {
    throw new Error('ACCOUNT_ROLE_NOT_ALLOWED');
  }

  return {
    authToken,
    user,
    ...(typeof loginData.refresh_token === 'string'
      ? { refreshToken: loginData.refresh_token }
      : {}),
  };
}
