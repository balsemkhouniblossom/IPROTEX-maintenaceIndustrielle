'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import api from '@/services/api';
import LanguageSwitcher from '@/components/LanguageSwitcher';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params.locale || 'en';
  const t = useTranslations('auth');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const response = await api.post('/auth/forgot-password', {
        email,
        locale,
        frontendOrigin: window.location.origin,
      });
      setMessage(response.data.message || 'If the email exists, reset instructions were sent.');
    } catch (err: unknown) {
      setError('Unable to process request. Please try again.');
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
            <h1 className="auth-logo-title text-3xl font-bold mb-2">{t('forgotPasswordTitle') || 'Forgot Password'}</h1>
            <p className="auth-logo-subtitle text-sm">{t('forgotPasswordDescription') || 'Enter your email to reset your password.'}</p>
          </div>

          <div className="auth-card rounded-4xl p-8">
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
                <label htmlFor="email" className="auth-label block text-sm font-medium mb-2">
                  {t('email')}
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="auth-input"
                  placeholder={t('enterEmail')}
                />
              </div>

              <div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                >
                  {loading ? t('sending') || 'Sending...' : t('sendResetLink') || 'Send reset link'}
                </button>
              </div>
            </form>

            <div className="text-center mt-6">
              <p className="auth-muted text-sm">
                <Link href={`/${locale}/auth/login`} className="auth-link font-semibold transition-colors">
                  {t('signInHere') || 'Back to login'}
                </Link>
              </p>
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
