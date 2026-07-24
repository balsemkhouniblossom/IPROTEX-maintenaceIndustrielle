'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import api from '@/services/api';

const ROLE_OPTIONS = [
  { value: 'operator', label: 'Operator' },
  { value: 'technician', label: 'Technician' },
];

const LANGUAGE_OPTIONS = [
  { value: 'ar', label: 'Arabic' },
  { value: 'de', label: 'German' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'it', label: 'Italian' },
];

export default function CompleteProfilePage() {
  const params = useParams<{ locale: string }>();
  const locale = params.locale || 'en';
  const t = useTranslations('auth');
  const { user, token, clearSession } = useAuth();
  const [phone, setPhone] = useState(user?.phone || '');
  const [role, setRole] = useState<'operator' | 'technician'>(
    user?.role === 'technician' ? 'technician' : 'operator',
  );
  const [department, setDepartment] = useState(user?.department || '');
  const [position, setPosition] = useState(user?.position || '');
  const [language, setLanguage] = useState(user?.language || locale || 'en');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token || !user) {
      window.location.replace(`/${locale}/auth/login`);
      return;
    }

    if (user.profile_completed !== false) {
      window.location.replace(`/${locale}/auth/login?error=pending-approval`);
    }
  }, [locale, token, user]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSaving(true);

    try {
      await api.post('/auth/complete-profile', {
        phone,
        role,
        department,
        position,
        language,
      });
      clearSession();
      window.location.replace(`/${locale}/auth/google-result?status=pending`);
    } catch (err: any) {
      const message = err?.response?.data?.message;
      setError(Array.isArray(message) ? message.join(', ') : message || t('completeProfileSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <section className="mx-auto w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">{t('completeProfileTitle')}</h1>
          <p className="mt-2 text-sm text-slate-600">
            {t('completeProfileDescription')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            {t('fullName')}
            <input
              value={user?.nom_complet || ''}
              readOnly
              className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-700"
            />
          </label>

          <label className="grid gap-1 text-sm font-medium text-slate-700">
            {t('email')}
            <input
              value={user?.email || ''}
              readOnly
              className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-700"
            />
          </label>

          <label className="grid gap-1 text-sm font-medium text-slate-700">
            {t('phone')}
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+21612345678"
              required
              className="rounded-md border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="grid gap-1 text-sm font-medium text-slate-700">
            {t('completeProfileRequestedRole')}
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as 'operator' | 'technician')}
              className="rounded-md border border-slate-300 px-3 py-2"
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm font-medium text-slate-700">
            {t('department')}
            <input
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              required
              className="rounded-md border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="grid gap-1 text-sm font-medium text-slate-700">
            {t('completeProfilePosition')}
            <input
              value={position}
              onChange={(event) => setPosition(event.target.value)}
              required
              className="rounded-md border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="grid gap-1 text-sm font-medium text-slate-700">
            {t('completeProfileLanguage')}
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2"
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {error && (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {saving ? t('completeProfileSaving') : t('completeProfileSubmit')}
          </button>
        </form>
      </section>
    </main>
  );
}
