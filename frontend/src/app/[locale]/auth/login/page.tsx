'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/contexts/AuthContext';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { getApiBaseUrl } from '@/config/api-base-url';
import { getDashboardPath } from '@/services/authRedirect';

const GOOGLE_ICON = (
  <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24">
    <path
      d="M21.805 10.023h-9.72v3.955h5.576c-.24 1.274-.959 2.353-2.037 3.078v2.554h3.305c1.936-1.783 3.056-4.408 3.056-7.526 0-.688-.062-1.35-.18-1.987Z"
      fill="#4285F4"
    />
    <path
      d="M12.084 22c2.763 0 5.081-.914 6.774-2.468l-3.305-2.554c-.915.614-2.084.977-3.469.977-2.663 0-4.92-1.798-5.726-4.215H2.947v2.633A10.227 10.227 0 0 0 12.084 22Z"
      fill="#34A853"
    />
    <path
      d="M6.358 13.74a6.144 6.144 0 0 1-.32-1.94c0-.673.116-1.328.32-1.94V7.227H2.947A10.229 10.229 0 0 0 1.857 11.8c0 1.653.397 3.218 1.09 4.573l3.41-2.633Z"
      fill="#FBBC05"
    />
    <path
      d="M12.084 5.645c1.503 0 2.853.517 3.916 1.533l2.937-2.937C17.16 2.59 14.842 1.6 12.084 1.6 7.247 1.6 3.08 4.366 2.947 7.227l3.41 2.633c.806-2.417 3.063-4.215 5.727-4.215Z"
      fill="#EA4335"
    />
  </svg>
);

export default function LoginPage() {
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [keepLoggedIn, setKeepLoggedIn] = useState(true);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');

  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params.locale || 'en';
  const { login } = useAuth();
  const t = useTranslations('auth');

  const handleGoogleLogin = () => {
    setError('');
    setGoogleLoading(true);
    window.location.href = `${getApiBaseUrl()}/auth/google?locale=${encodeURIComponent(locale)}&frontendOrigin=${encodeURIComponent(window.location.origin)}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const userRole = await login(formData.email, formData.password, keepLoggedIn);
      router.replace(getDashboardPath(locale, userRole));

    } catch (err: unknown) {
      if (err instanceof Error) {
        const normalizedMessage = err.message.toLowerCase();
        if (
          normalizedMessage.includes('invalid credentials') ||
          normalizedMessage.includes('unauthorized') ||
          normalizedMessage.includes('status code 401')
        ) {
          setError(t('loginFailed'));
        } else {
          setError(err.message);
        }
      } else {
        setError(t('networkError'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell min-h-screen flex">
      <div className="absolute top-4 left-4 z-20">
        <LanguageSwitcher />
      </div>


      <div className="auth-side-panel w-full lg:w-2/5 flex items-center justify-center p-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="mx-auto h-16 w-16 flex items-center justify-center mb-6">
              <Image
                src="/Iprotex%20logo.png"
                alt="IPROTEX Logo"
                width={48}
                height={48}
                className="h-12 w-12 object-contain"
              />
            </div>
            <h1 className="auth-logo-title text-4xl font-bold mb-2">{t('welcomeIprotex')}</h1>
            <p className="auth-logo-subtitle text-lg">{t('advancedMaintenance')}</p>
          </div>

          <div className="auth-card rounded-4xl p-8">
            <div className="text-center mb-6">
              <h2 className="auth-heading text-2xl font-semibold">{t('signIn')}</h2>
              <p className="auth-helper text-sm mt-1">{t('accessSystem')}</p>
            </div>

            {error && (
              <div className="bg-red-50/80 backdrop-blur-sm border border-red-200/50 text-red-700 px-4 py-3 rounded-xl text-sm mb-6">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="email" className="auth-label block text-sm font-medium mb-2">
                  {t('email')}
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="auth-input"
                  placeholder={t('enterEmail')}
                />
              </div>

              <div>
                <label htmlFor="password" className="auth-label block text-sm font-medium mb-2">
                  {t('password')}
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="auth-input pe-12"
                    placeholder={t('enterPassword')}
                  />
                  <button
                    type="button"
                    className="auth-icon-button absolute inset-y-0 pe-4 flex items-center"
                    style={{ insetInlineEnd: 0 }}
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeSlashIcon className="h-5 w-5" />
                    ) : (
                      <EyeIcon className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>

              <label className="auth-label flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={keepLoggedIn}
                  onChange={(event) => setKeepLoggedIn(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>{t('keepLoggedIn')}</span>
              </label>

              <div>
                <button
                  type="submit"
                  disabled={loading || googleLoading}
                  className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                >
                  {loading ? t('signingIn') : t('signIn')}
                </button>
              </div>
            </form>

            <div className="auth-divider my-5 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.24em]">
              <span className="auth-divider-line h-px flex-1" />
              <span>{t('orContinueWith')}</span>
              <span className="auth-divider-line h-px flex-1" />
            </div>

            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={loading || googleLoading}
              className="auth-google-button w-full inline-flex items-center justify-center gap-3 rounded-xl border px-4 py-3 text-sm font-semibold shadow-sm transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {GOOGLE_ICON}
              <span>
                {googleLoading ? t('redirectingToGoogle') : t('continueWithGoogle')}
              </span>
            </button>

      <div className="text-center mt-6">
              <p className="auth-muted text-sm">
                {t('signup')} {' '}
                  <Link
                  href={`/${locale}/auth/register`}
                  className="auth-link font-semibold transition-colors"
                >
                  {t('signUp')}
                </Link>
              </p>
            </div>
            <div className="text-center mt-2">
              <Link href={`/${locale}/auth/forgot-password`} className="auth-link text-sm font-semibold transition-colors">
                {t('forgotPasswordLink') || 'Forgot password?'}
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="hidden lg:flex lg:w-3/5 bg-[radial-gradient(circle_at_center,var(--tw-gradient-stops))] from-blue-800 via-blue-900 to-[#0F172A] relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('/BGsign_in.png')] bg-cover bg-center opacity-80" />
        <div className="auth-hero-overlay absolute inset-0" />
      </div>
    </div>
  );
}

