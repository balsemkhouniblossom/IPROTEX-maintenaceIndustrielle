import { getTranslations, getLocale } from 'next-intl/server';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';

export default async function LocaleNotFound() {
  const t = await getTranslations('errors.notFound');
  const locale = await getLocale().catch(() => 'en');

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-6 text-center"
      style={{ background: 'var(--color-background)', color: 'var(--color-text-primary)' }}
    >
      <MagnifyingGlassIcon
        className="mb-4 h-12 w-12"
        style={{ color: 'var(--color-text-muted)' }}
        aria-hidden="true"
      />
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <p className="mt-2 max-w-md text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        {t('description')}
      </p>
      <a href={`/${locale}`} className="btn-primary mt-6">
        {t('home')}
      </a>
    </div>
  );
}
