'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { locales, type AppLocale } from '@/i18n/config';

export default function LanguageSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('language');

  const segments = pathname.split('/').filter(Boolean);
  const currentLocale = locales.includes(segments[0] as AppLocale)
    ? (segments[0] as AppLocale)
    : 'en';

  const handleLocaleChange = (locale: AppLocale) => {
    const nextSegments = [...segments];

    if (locales.includes(nextSegments[0] as AppLocale)) {
      nextSegments[0] = locale;
    } else {
      nextSegments.unshift(locale);
    }

    const queryString = typeof window !== 'undefined' ? window.location.search.replace(/^\?/, '') : '';
    const querySuffix = queryString ? `?${queryString}` : '';
    const nextPath = `/${nextSegments.join('/')}${querySuffix}`;

    document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=31536000; SameSite=Lax`;
    router.replace(nextPath);
  };

  return (
    <label className="toolbar-control">
      <span className="sr-only">{t('label')}</span>
      <select
        value={currentLocale}
        onChange={(event) => handleLocaleChange(event.target.value as AppLocale)}
        className="toolbar-select"
        aria-label={t('label')}
      >
        {locales.map((locale) => (
          <option key={locale} value={locale}>
            {t(locale)}
          </option>
        ))}
      </select>
    </label>
  );
}

