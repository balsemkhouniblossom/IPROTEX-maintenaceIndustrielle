'use client';

import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import api, { getCsrfHeaders, resetAuthRefreshState } from '../services/api';
import {
  AUTH_SESSION_REFRESHED_EVENT,
  requestAuthRefresh,
} from '../services/authRefreshCoordinator';
import {
  clearAuthSession,
  saveAuthSession,
} from '../services/authStorage';
import { getAuthErrorCode, isConfirmedRefreshAuthFailure } from '../services/authErrors';
import { SESSION_EXPIRED_EVENT } from '../services/authSessionEvents';
import { getRegistrationErrorCode } from '../services/publicRegistration';
import { parseLocalLoginSession } from '../services/localLogin';

interface User {
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
  approval_status?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  status: AuthStatus;
  login: (email: string, password: string, keepLoggedIn?: boolean) => Promise<string>;
  completeSocialLogin: (
    authToken: string,
    authUser: User,
    refreshToken?: string,
  ) => string;
  register: (
    userData: Record<string, unknown>,
    options?: { locale?: string },
  ) => Promise<void>;
  clearSession: () => void;
  logout: () => void;
  isLoading: boolean;
  isAuthenticated: boolean;
}

type AuthStatus =
  | 'initializing'
  | 'authenticated'
  | 'unauthenticated'
  | 'incomplete_profile'
  | 'pending_approval'
  | 'rejected'
  | 'inactive'
  | 'error';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState<AuthStatus>('initializing');

  const establishSession = (authToken: string, authUser: User, refreshToken?: string, persistent = true) => {
    setToken(authToken);
    setUser(authUser);
    saveAuthSession(authToken, refreshToken, authUser, persistent);
    setStatus(getAuthStatusForUser(authUser));

    return authUser.role;
  };

  const clearLocalSession = () => {
    setToken(null);
    setUser(null);
    setStatus('unauthenticated');
    clearAuthSession();
    resetAuthRefreshState();
  };

  // Browser storage is only a credential cache; the backend is the session authority.
  useEffect(() => {
    let active = true;

    const validateBackendSession = async () => {
      try {
        const session = await requestAuthRefresh();

        if (!active) return;

        establishSession(
          session.authToken,
          session.user,
          session.refreshToken,
          true,
        );
      } catch (error) {
        if (!active) return;
        if (isConfirmedRefreshAuthFailure(error)) {
          clearLocalSession();
          return;
        }

        setStatus('error');
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void validateBackendSession();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleSessionExpired = () => {
      setToken(null);
      setUser(null);
      setStatus('unauthenticated');
    };
    const handleSessionRefreshed = (event: Event) => {
      const session = (event as CustomEvent).detail;
      if (!session?.authToken || !session?.user) return;
      setToken(session.authToken);
      setUser(session.user);
      setStatus(getAuthStatusForUser(session.user));
    };

    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    window.addEventListener(AUTH_SESSION_REFRESHED_EVENT, handleSessionRefreshed);
    return () =>
      {
        window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
        window.removeEventListener(AUTH_SESSION_REFRESHED_EVENT, handleSessionRefreshed);
      };
  }, []);
  const login = async (email: string, password: string, keepLoggedIn = true) => {
    try {
      const response = await api.post(
        '/auth/login',
        { email, password },
        { withCredentials: true },
      );
      const session = parseLocalLoginSession(response.data);

      return establishSession(
        session.authToken,
        session.user,
        session.refreshToken,
        keepLoggedIn,
      );
    } catch (error: any) {
      clearLocalSession();
      const code = getAuthErrorCode(error);
      if (code) {
        throw new Error(code);
      }

      const responseData = error?.response?.data;
      const responseMessage = responseData?.message;

      if (Array.isArray(responseMessage)) {
        throw new Error(responseMessage.join(', '));
      }

      if (typeof responseMessage === 'string' && responseMessage.trim()) {
        throw new Error(responseMessage);
      }

      throw new Error(error?.message || 'Login failed');
    }
  };

  const register = async (
    userData: Record<string, unknown>,
    options?: { locale?: string },
  ) => {
    try {
      await api.post('/auth/register', userData, {
        withCredentials: true,
        headers: options?.locale
          ? { 'X-App-Locale': options.locale }
          : undefined,
      });
      // Registration successful, but don't auto-login
    } catch (error: unknown) {
      const msg = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      const code = getRegistrationErrorCode(error);
      throw new Error(code || msg || 'Registration failed');
    }
  };

  const completeSocialLogin = (
    authToken: string,
    authUser: User,
    refreshToken?: string,
  ) => {
    parseLocalLoginSession({
      access_token: authToken,
      refresh_token: refreshToken,
      user: authUser,
    });
    return establishSession(authToken, authUser, refreshToken);
  };

  const clearSession = () => {
    clearLocalSession();
  };

  const logout = () => {
    void api
      .post('/auth/logout', {}, { withCredentials: true, headers: getCsrfHeaders() })
      .catch(() => undefined);
    clearSession();
    // Redirect with locale-based routing (Next-intl expects /{locale}/...)
    const path = typeof window !== 'undefined' ? window.location.pathname : '';
    const locale = path.split('/')[1] || 'en';
    window.location.href = `/${locale}/auth/login`;
  };

  const value = {
    user,
    token,
    status,
    login,
    completeSocialLogin,
    register,
    clearSession,
    logout,
    isLoading,
    isAuthenticated: !!token && !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function getAuthStatusForUser(user: User): AuthStatus {
  if (user.profile_completed === false) return 'incomplete_profile';
  if (user.approval_status === 'pending') return 'pending_approval';
  if (user.approval_status === 'rejected') return 'rejected';
  if (user.is_active !== true) return 'inactive';
  return 'authenticated';
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
