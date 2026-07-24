'use client';

import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import api, { getCsrfHeaders } from '../services/api';
import { clearAuthSession, getAuthSessionPersistence, saveAuthSession } from '../services/authStorage';
import { getAuthErrorCode } from '../services/authErrors';
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
}

interface AuthContextType {
  user: User | null;
  token: string | null;
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

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const establishSession = (authToken: string, authUser: User, refreshToken?: string, persistent = true) => {
    setToken(authToken);
    setUser(authUser);
    saveAuthSession(authToken, refreshToken, authUser, persistent);

    return authUser.role;
  };

  const clearLocalSession = () => {
    setToken(null);
    setUser(null);
    clearAuthSession();
  };

  // Browser storage is only a credential cache; the backend is the session authority.
  useEffect(() => {
    let active = true;

    const validateBackendSession = async () => {
      try {
        const response = await api.post(
          '/auth/refresh',
          {},
          { headers: getCsrfHeaders() },
        );
        const session = parseLocalLoginSession(response.data);

        if (!active) return;

        establishSession(
          session.authToken,
          session.user,
          session.refreshToken,
          getAuthSessionPersistence(),
        );
      } catch {
        if (!active) return;
        clearLocalSession();
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void validateBackendSession();

    return () => {
      active = false;
    };
  }, []);
  const login = async (email: string, password: string, keepLoggedIn = true) => {
    try {
      const response = await api.post('/auth/login', { email, password });
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
      .post('/auth/logout', {}, { headers: getCsrfHeaders() })
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

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
