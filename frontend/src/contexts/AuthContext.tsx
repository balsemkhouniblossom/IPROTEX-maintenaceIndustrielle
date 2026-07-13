'use client';

import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import api from '../services/api';
import { clearAuthSession, getAuthItem, saveAuthSession } from '../services/authStorage';

interface User {
  _id: string;
  user_id: string;
  nom_complet: string;
  email: string;
  role: string;
  is_active: boolean;
  last_login?: string;
  created_at: string;
  phone?: string;
  department?: string;
  photo?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (email: string, password: string, keepLoggedIn?: boolean) => Promise<string>;
  completeSocialLogin: (authToken: string, authUser: User) => string;
  register: (userData: Record<string, unknown>) => Promise<void>;
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

  // auth state initialized from localStorage synchronously
  useEffect(() => {
    try {
      const storedUser = getAuthItem('user');
      const storedToken = getAuthItem('token');

      if (storedUser) {
        setUser(JSON.parse(storedUser));
      }

      if (storedToken) {
        setToken(storedToken);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, []);
  const login = async (email: string, password: string, keepLoggedIn = true) => {
    try {
      const response = await api.post('/auth/login', { email, password });

      const data = response.data;
      const authToken = data.access_token ?? data.token;

      return establishSession(authToken, data.user, data.refresh_token, keepLoggedIn);
    } catch (error: any) {
      const status = error?.response?.status;
      const responseData = error?.response?.data;
      const responseMessage = responseData?.message;

      if (status === 401) {
        throw new Error('Invalid credentials');
      }

      if (Array.isArray(responseMessage)) {
        throw new Error(responseMessage.join(', '));
      }

      if (typeof responseMessage === 'string' && responseMessage.trim()) {
        throw new Error(responseMessage);
      }

      throw new Error(error?.message || 'Login failed');
    }
  };

  const register = async (userData: Record<string, unknown>) => {
    try {
      await api.post('/auth/register', userData);
      // Registration successful, but don't auto-login
    } catch (error: unknown) {
      const msg = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      throw new Error(msg || 'Registration failed');
    }
  };

  const completeSocialLogin = (authToken: string, authUser: User) => {
    return establishSession(authToken, authUser);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    clearAuthSession();
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
    logout,
    isLoading,
    isAuthenticated: !!token && !!user,
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        Loading...
      </div>
    );
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
