'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/contexts/AuthContext';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import InternationalPhoneInput from '@/components/InternationalPhoneInput';
import {
  buildInternationalPhone,
  DEFAULT_PHONE_COUNTRY,
  validateNationalPhone,
} from '@/services/phoneNumber';
import { validatePasswordPolicy } from '@/services/userValidation';
import {
  buildPublicRegistrationPayload,
  getRegistrationSuccessRedirect,
  PUBLIC_REGISTRATION_ROLES,
} from '@/services/publicRegistration';

export default function RegisterPage() {
  const departmentOptions = ['IT', 'Maintenance', 'Production', 'Administration'];
  const [formData, setFormData] = useState({
    nom_complet: '',
    email: '',
    phone: {
      country: DEFAULT_PHONE_COUNTRY,
      nationalNumber: '',
    },
    password: '',
    confirmPassword: '',
    role: 'operator',
    department: ''
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params.locale || 'en';
  const { register } = useAuth();
  const t = useTranslations('auth');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (formData.password !== formData.confirmPassword) {
      setError(t('passwordsDoNotMatch'));
      setLoading(false);
      return;
    }

    if (!validatePasswordPolicy(formData.password)) {
      setError(
        t('passwordWeak', {
          default:
            'Password must contain at least 8 characters, one uppercase letter, one lowercase letter, one number, and one special character.',
        }),
      );
      setLoading(false);
      return;
    }

    if (!validateNationalPhone(formData.phone.country, formData.phone.nationalNumber)) {
      setError(
        t('invalidInternationalPhone', {
          default: 'Please enter a valid international phone number (e.g. +21612345678)',
        }),
      );
      setLoading(false);
      return;
    }

    const phone = buildInternationalPhone(formData.phone.country, formData.phone.nationalNumber);

    try {
      await register(buildPublicRegistrationPayload({
        nom_complet: formData.nom_complet,
        email: formData.email,
        phone,
        password: formData.password,
        role: formData.role,
        department: formData.department,
      }), { locale });

      router.push(getRegistrationSuccessRedirect(locale));

    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message === 'EMAIL_ALREADY_REGISTERED') {
          setError(t('emailAlreadyRegistered', { default: 'Email already registered.' }));
        } else if (err.message === 'PUBLIC_ROLE_NOT_ALLOWED') {
          setError(t('publicRoleNotAllowed', { default: 'This role is not available for public registration.' }));
        } else if (err.message === 'REGISTRATION_EMAIL_DELIVERY_FAILED') {
          setError(t('registrationEmailDeliveryFailed', { default: 'The account could not be created because the verification email could not be sent. Please try again later.' }));
        } else {
          setError(err.message);
        }
      }
      else setError(t('networkError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell min-h-screen flex">
      <div className="absolute top-4 left-8 z-20 sm:left-10">
        <LanguageSwitcher />
      </div>

      <main className="auth-side-panel w-full lg:w-2/5 flex items-center justify-center p-12 lg:p-16">
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
              <h2 className="auth-heading text-2xl font-semibold">{t('signUp')}</h2>
              <p className="auth-helper text-sm mt-1">{t('accessSystem')}</p>
            </div>

            {error && (
              <div className="bg-red-50/80 backdrop-blur-sm border border-red-200/50 text-red-700 px-4 py-3 rounded-xl text-sm mb-6">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="nom_complet" className="auth-label block text-sm font-medium mb-2">
                  {t('fullName')} *
                </label>
                <input
                  id="nom_complet"
                  name="nom_complet"
                  type="text"
                  required
                  value={formData.nom_complet}
                  onChange={(e) => setFormData({ ...formData, nom_complet: e.target.value })}
                  className="auth-input"
                  placeholder={t('enterFullName')}
                />
              </div>

              <div>
                <label htmlFor="email" className="auth-label block text-sm font-medium mb-2">
                  {t('email')} *
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
                <label htmlFor="phone" className="auth-label block text-sm font-medium mb-2">
                  {t('phone')}
                </label>
                <InternationalPhoneInput
                  name="phone"
                  value={formData.phone}
                  onChange={(phone) => setFormData({ ...formData, phone })}
                  placeholder={t('phoneHint', { default: 'Local number' })}
                />
                <p className="auth-muted mt-1 text-xs">
                  {t('phoneHint', { default: 'Use international format, e.g. +21612345678' })}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="role" className="auth-label block text-sm font-medium mb-2">
                    {t('role')} *
                  </label>
                  <select
                    id="role"
                    name="role"
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="auth-input"
                  >
                    {PUBLIC_REGISTRATION_ROLES.map((role) => (
                      <option key={role} value={role}>{t(role)}</option>
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
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    className="auth-input"
                  >
                    <option value="">{t('enterDepartment')}</option>
                    {departmentOptions.map((department) => (
                      <option key={department} value={department}>
                        {department}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="password" className="auth-label block text-sm font-medium mb-2">
                  {t('password')} *
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="auth-input pe-12"
                    placeholder={t('enterPassword')}
                  />
                  <button
                    type="button"
                    className="auth-icon-button absolute inset-y-0 inset-e-0 flex items-center justify-center p-2"
                    style={{ minWidth: 24, minHeight: 24 }}
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? (
                      <EyeSlashIcon className="h-5 w-5" />
                    ) : (
                      <EyeIcon className="h-5 w-5" />
                    )}
                  </button>
                </div>
                <p className="auth-muted mt-2 text-xs">
                  {t('passwordRequirements.title', { default: 'Password must contain:' })}
                </p>
                <ul className="auth-muted mt-1 text-xs list-disc list-inside">
                  <li>{t('passwordRequirements.minLength', { default: 'At least 8 characters' })}</li>
                  <li>{t('passwordRequirements.uppercase', { default: 'One uppercase letter' })}</li>
                  <li>{t('passwordRequirements.lowercase', { default: 'One lowercase letter' })}</li>
                  <li>{t('passwordRequirements.number', { default: 'One number' })}</li>
                  <li>{t('passwordRequirements.special', { default: 'One special character' })}</li>
                </ul>
              </div>

              <div>
                <label htmlFor="confirmPassword" className="auth-label block text-sm font-medium mb-2">
                  {t('confirmPassword')} *
                </label>
                <div className="relative">
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    value={formData.confirmPassword}
                    onChange={(e) =>
                      setFormData({ ...formData, confirmPassword: e.target.value })
                    }
                    className="auth-input pe-12"
                    placeholder={t('confirmPassword')}
                  />
                  <button
                    type="button"
                    className="auth-icon-button absolute inset-y-0 inset-e-0 flex items-center justify-center p-2"
                    style={{ minWidth: 24, minHeight: 24 }}
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={showConfirmPassword ? t('hidePassword') : t('showPassword')}
                    aria-pressed={showConfirmPassword}
                  >
                    {showConfirmPassword ? (
                      <EyeSlashIcon className="h-5 w-5" />
                    ) : (
                      <EyeIcon className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-linear-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold py-3 px-4 rounded-xl transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none shadow-lg hover:shadow-xl"
              >
                {loading ? (
                  <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white me-2" />
                    {t('creatingAccount')}
                  </div>
                ) : (
                  t('createAccount')
                )}
              </button>
            </form>

            <div className="text-center mt-6">
              <p className="auth-muted text-sm">
                {t('login')}{' '}
                <Link href={`/${locale}/auth/login`} className="auth-link font-semibold transition-colors">
                  {t('signInHere')}
                </Link>
              </p>
            </div>
          </div>
        </div>
      </main>

      <div className="hidden lg:flex lg:w-3/5 bg-[radial-gradient(circle_at_center,var(--tw-gradient-stops))] from-blue-800 via-blue-900 to-[#0F172A] relative overflow-hidden">
        <div className="absolute inset-0 hero-split-panel bg-cover bg-center opacity-80" />
        <div className="auth-hero-overlay absolute inset-0" />
        <div className="absolute bottom-0 inset-s-0 h-2 bg-linear-to-r from-transparent via-white/20 to-transparent" />
      </div>
    </div>
  );
}

