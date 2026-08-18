'use client';

import { useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { reportClientError } from '@/services/errorReporting';

export default function LocaleRouteError({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  const t = useTranslations('errors.route');
  const locale = useLocale();

  useEffect(() => {
    reportClientError(error, { boundary: 'locale-route', digest: error.digest });
  }, [error]);

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-6 text-center"
      style={{ background: 'var(--color-background)', color: 'var(--color-text-primary)' }}
    >
      <ExclamationTriangleIcon
        className="mb-4 h-12 w-12"
        style={{ color: 'var(--color-error)' }}
        aria-hidden="true"
      />
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <p className="mt-2 max-w-md text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        {t('description')}
      </p>
      {error.digest && (
        <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {t('digest', { digest: error.digest })}
        </p>
      )}
      <div className="mt-6 flex gap-3">
        <button type="button" onClick={reset} className="btn-primary">
          {t('retry')}
        </button>
        <a href={`/${locale}`} className="btn-secondary">
          {t('home')}
        </a>
      </div>
    </div>
  );
}
