'use client';

import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import api from '@/services/api';
import {
  evaluateCompleteProfileAccess,
  getAuthenticatedAccountDestination,
} from '@/services/sessionGuard';

const ROLE_OPTIONS = [
  { value: 'operator', label: 'Operator' },
  { value: 'technician', label: 'Technician' },
];

const DEPARTMENT_OPTIONS = ['IT', 'Maintenance', 'Production', 'Administration'];
const CUSTOM_DEPARTMENT_VALUE = '__custom_department__';

const LANGUAGE_OPTIONS = [
  { value: 'ar', label: 'Arabic' },
  { value: 'de', label: 'German' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'it', label: 'Italian' },
];

function CompleteProfileShell({ children }: { children: ReactNode }) {
  const t = useTranslations('auth');

  return (
    <div className="auth-shell min-h-screen flex">
      <div className="absolute top-4 left-4 z-20">
        <LanguageSwitcher />
      </div>

      <main className="auth-side-panel w-full lg:w-2/5 flex items-center justify-center p-12">
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

          <div className="auth-card rounded-4xl p-8">{children}</div>
        </div>
      </main>

      <div className="hidden lg:flex lg:w-3/5 bg-[radial-gradient(circle_at_center,var(--tw-gradient-stops))] from-blue-800 via-blue-900 to-[#0F172A] relative overflow-hidden">
        <div className="absolute inset-0 hero-split-panel bg-cover bg-center opacity-80" />
        <div className="auth-hero-overlay absolute inset-0" />
      </div>
    </div>
  );
}

function CompleteProfileLoadingState() {
  const t = useTranslations('auth');

  return (
    <CompleteProfileShell>
      <div className="text-center py-6">
        <div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-b-2 border-blue-600" />
        <h2 className="auth-heading text-xl font-semibold">{t('googleSigninCompletingTitle')}</h2>
        <p className="auth-helper text-sm mt-2">{t('googleSigninCompletingDescription')}</p>
      </div>
    </CompleteProfileShell>
  );
}

export default function CompleteProfilePage() {
  const params = useParams<{ locale: string }>();
  const locale = params.locale || 'en';
  const t = useTranslations('auth');
  const tUsers = useTranslations('users');
  const { user, token, isLoading, clearSession } = useAuth();
  const [phone, setPhone] = useState(user?.phone || '');
  const [role, setRole] = useState<'operator' | 'technician'>(
    user?.role === 'technician' ? 'technician' : 'operator',
  );
  const [department, setDepartment] = useState(user?.department || '');
  const [useCustomDepartment, setUseCustomDepartment] = useState(
    () => !!user?.department && !DEPARTMENT_OPTIONS.includes(user.department),
  );
  const [language, setLanguage] = useState(user?.language || locale || 'en');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const navigatedRef = useRef(false);

  // Only evaluate authentication once AuthContext has finished restoring the
  // session (isLoading === false). Reacting to a transient token=null/user=null
  // state while restoration is still in flight is what caused this page to
  // flash and bounce back to login right after the Google exchange.
  useEffect(() => {
    if (submitted || navigatedRef.current) {
      return;
    }

    const decision = evaluateCompleteProfileAccess({ isLoading, token, user, locale });

    if (decision.status !== 'redirect') {
      return;
    }

    const currentPath = `/${locale}/auth/complete-profile`;
    if (decision.to !== currentPath) {
      navigatedRef.current = true;
      window.location.replace(decision.to);
    }
  }, [isLoading, locale, token, user, submitted]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || submitted) {
      return;
    }

    setError('');
    setSaving(true);

    try {
      const response = await api.post('/auth/complete-profile', {
        phone,
        role,
        department,
        language,
      });

      // profile_completed is now true and approval_status remains pending:
      // the centralized lifecycle rules send this user to the pending-approval
      // destination, never to a dashboard.
      const updatedUser = response?.data?.user;
      const destination = getAuthenticatedAccountDestination(locale, updatedUser ?? user);

      setSubmitted(true);
      navigatedRef.current = true;
      clearSession();
      window.location.replace(destination);
    } catch (err: any) {
      const message = err?.response?.data?.message;
      setError(Array.isArray(message) ? message.join(', ') : message || t('completeProfileSaveFailed'));
      setSaving(false);
    }
  };

  const decision = submitted
    ? ({ status: 'loading' } as const)
    : evaluateCompleteProfileAccess({ isLoading, token, user, locale });

  if (decision.status !== 'show-form') {
    return <CompleteProfileLoadingState />;
  }

  return (
    <CompleteProfileShell>
      <div className="text-center mb-6">
        <h2 className="auth-heading text-2xl font-semibold">{t('completeProfileTitle')}</h2>
        <p className="auth-helper text-sm mt-1">{t('completeProfileDescription')}</p>
      </div>

      {error && (
        <div className="bg-red-50/80 backdrop-blur-sm border border-red-200/50 text-red-700 px-4 py-3 rounded-xl text-sm mb-6">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="nom_complet" className="auth-label block text-sm font-medium mb-2">
            {t('fullName')}
          </label>
          <input
            id="nom_complet"
            value={user?.nom_complet || ''}
            readOnly
            className="auth-input disabled:opacity-60 disabled:cursor-not-allowed"
            disabled
          />
        </div>

        <div>
          <label htmlFor="email" className="auth-label block text-sm font-medium mb-2">
            {t('email')}
          </label>
          <input
            id="email"
            value={user?.email || ''}
            readOnly
            className="auth-input disabled:opacity-60 disabled:cursor-not-allowed"
            disabled
          />
        </div>

        <div>
          <label htmlFor="phone" className="auth-label block text-sm font-medium mb-2">
            {t('phone')}
          </label>
          <input
            id="phone"
            name="phone"
            type="text"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+21612345678"
            required
            className="auth-input"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="role" className="auth-label block text-sm font-medium mb-2">
              {t('completeProfileRequestedRole')}
            </label>
            <select
              id="role"
              name="role"
              value={role}
              onChange={(event) => setRole(event.target.value as 'operator' | 'technician')}
              className="auth-input"
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="department" className="auth-label block text-sm font-medium mb-2">
              {t('department')}
            </label>
            <select
              id="department"
              name="department"
              value={useCustomDepartment ? CUSTOM_DEPARTMENT_VALUE : department}
              onChange={(event) => {
                if (event.target.value === CUSTOM_DEPARTMENT_VALUE) {
                  setUseCustomDepartment(true);
                  setDepartment('');
                  return;
                }
                setUseCustomDepartment(false);
                setDepartment(event.target.value);
              }}
              required
              className="auth-input"
            >
              <option value="">{t('department')}</option>
              {DEPARTMENT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              <option value={CUSTOM_DEPARTMENT_VALUE}>
                {tUsers('form.customDepartment')}
              </option>
            </select>
            {useCustomDepartment && (
              <input
                type="text"
                value={department}
                onChange={(event) => setDepartment(event.target.value)}
                required
                className="auth-input mt-2"
                placeholder={tUsers('form.customDepartment')}
              />
            )}
          </div>
        </div>

        <div>
          <label htmlFor="language" className="auth-label block text-sm font-medium mb-2">
            {t('completeProfileLanguage')}
          </label>
          <select
            id="language"
            name="language"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            className="auth-input"
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-linear-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold py-3 px-4 rounded-xl transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none shadow-lg hover:shadow-xl"
        >
          {saving ? (
            <div className="flex items-center justify-center">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white me-2" />
              {t('completeProfileSaving')}
            </div>
          ) : (
            t('completeProfileSubmit')
          )}
        </button>
      </form>
    </CompleteProfileShell>
  );
}
