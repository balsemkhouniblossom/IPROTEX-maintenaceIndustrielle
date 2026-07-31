'use client';

import { Suspense, useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams, useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import api from '@/services/api';
import LanguageSwitcher from '@/components/LanguageSwitcher';

function ResetPasswordPageContent() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState('');

  const searchParams = useSearchParams();
  const params = useParams<{ locale: string }>();
  const locale = params.locale || 'en';
  const router = useRouter();
  const t = useTranslations('auth');

  useEffect(() => {
    const urlToken = searchParams?.get('token') || '';
    setToken(urlToken);
  }, [searchParams]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setMessage('');

    if (password !== confirmPassword) {
      setError(t('passwordsDoNotMatch') || 'Passwords do not match.');
      return;
    }

    if (password.length < 6) {
      setError(t('passwordMinLength') || 'Password must be at least 6 characters long.');
      return;
    }

    if (!token) {
      setError('Missing reset token.');
      return;
    }

    setLoading(true);
    try {
      const response = await api.post('/auth/reset-password', {
        token,
        password,
      }, {
        withCredentials: true,
      });
      setMessage(response.data.message || 'Password reset successfully.');
      setTimeout(() => {
        router.push(`/${locale}/auth/login`);
      }, 1500);
    } catch {
      setError('Unable to reset password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <div className="w-full lg:w-2/5 bg-white flex items-center justify-center p-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">{t('resetPasswordTitle') || 'Reset Password'}</h1>
            <p className="text-sm text-slate-500">{t('resetPasswordDescription') || 'Enter a new password to continue.'}</p>
          </div>

          <div className="rounded-4xl shadow-[0_20px_50px_rgba(0,0,0,0.08)] bg-white p-8">
            {message && (
              <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl mb-6 text-sm">
                {message}
              </div>
            )}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-6 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                  {t('password')}
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-white/50 backdrop-blur-sm hover:border-gray-300"
                  placeholder={t('enterPassword')}
                />
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
                  {t('confirmPassword')}
                </label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-white/50 backdrop-blur-sm hover:border-gray-300"
                  placeholder={t('confirmPassword')}
                />
              </div>

              <div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                >
                  {loading ? t('saving') || 'Saving...' : t('resetPassword') || 'Reset Password'}
                </button>
              </div>
            </form>

            <div className="text-center mt-6">
              <p className="text-sm text-gray-600">
                <Link href={`/${locale}/auth/login`} className="font-semibold text-blue-600 hover:text-blue-700 transition-colors">
                  {t('signInHere') || 'Back to login'}
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="hidden lg:flex lg:w-3/5 bg-[radial-gradient(circle_at_center,var(--tw-gradient-stops))] from-blue-800 via-blue-900 to-[#0F172A] relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('/BGsign_in.png')] bg-cover bg-center opacity-80" />
        <div className="absolute inset-0 bg-linear-to-r from-white via-transparent to-transparent" />
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <ResetPasswordPageContent />
    </Suspense>
  );
}
