'use client';

import { useEffect } from 'react';
import { isRtlLocale } from '@/i18n/config';

export default function LocaleDocumentAttributes({ locale }: { locale: string }) {
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtlLocale(locale) ? 'rtl' : 'ltr';
  }, [locale]);

  return null;
}
