'use client';

import { MoonIcon, SunIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { useTheme } from '@/components/theme/ThemeProvider';

export default function ThemeToggle() {
  const t = useTranslations('common.theme');
  const { resolvedTheme, toggleTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const nextThemeLabel = isDark ? t('toggleToLight') : t('toggleToDark');

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="toolbar-control theme-toggle"
      aria-label={nextThemeLabel}
      title={nextThemeLabel}
    >
      {isDark ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
      <span className="hidden lg:inline" aria-hidden="true">{isDark ? t('dark') : t('light')}</span>
    </button>
  );
}