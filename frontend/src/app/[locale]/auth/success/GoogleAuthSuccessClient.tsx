'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export default function GoogleAuthSuccessClient() {
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const t = useTranslations('auth');

  const locale = params.locale || 'en';

  useEffect(() => {
    router.replace(`/${locale}/auth/google-result?status=failed`);
  }, [locale, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.16),transparent_40%),linear-gradient(180deg,#f8fafc_0%,#e2e8f0_100%)] px-6">
      <div className="w-full max-w-md rounded-3xl border border-white/70 bg-white/90 p-8 text-center shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur-sm">
        <div className="mx-auto mb-5 h-14 w-14 animate-pulse rounded-full bg-blue-100" />
        <h1 className="text-2xl font-semibold text-slate-900">{t('googleSigninCompletingTitle')}</h1>
        <p className="mt-2 text-sm text-slate-600">{t('googleSigninCompletingDescription')}</p>
      </div>
    </div>
  );
}
