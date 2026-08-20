'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  isThemePreference,
  resolveThemePreference,
  ResolvedTheme,
  THEME_COOKIE_NAME,
  THEME_STORAGE_KEY,
  ThemePreference,
} from '@/components/theme/theme-config';

type ThemeContextValue = {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') {
    return 'light';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readThemePreferenceFromDom(): ThemePreference {
  if (typeof document === 'undefined') {
    return 'system';
  }

  const value = document.documentElement.dataset.themePreference;
  return isThemePreference(value) ? value : 'system';
}

function readResolvedThemeFromDom(): ResolvedTheme {
  if (typeof document === 'undefined') {
    return 'light';
  }

  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function persistThemePreference(theme: ThemePreference) {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  document.cookie = `${THEME_COOKIE_NAME}=${theme}; path=/; max-age=31536000; SameSite=Lax`;
}

function applyTheme(theme: ThemePreference): ResolvedTheme {
  const resolvedTheme = resolveThemePreference(theme, getSystemTheme());
  const root = document.documentElement;

  root.dataset.themePreference = theme;
  root.dataset.theme = resolvedTheme;
  root.style.colorScheme = resolvedTheme;

  return resolvedTheme;
}

export function ThemeProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [theme, setTheme] = useState<ThemePreference>(() => readThemePreferenceFromDom());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => readResolvedThemeFromDom());

  useEffect(() => {
    const nextResolvedTheme = applyTheme(theme);
    setResolvedTheme(nextResolvedTheme);
    persistThemePreference(theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== 'system') {
      return undefined;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      setResolvedTheme(applyTheme('system'));
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      toggleTheme: () => {
        setTheme((currentTheme) =>
          resolveThemePreference(currentTheme, getSystemTheme()) === 'dark' ? 'light' : 'dark',
        );
      },
    }),
    [resolvedTheme, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new TypeError('useTheme must be used within ThemeProvider');
  }

  return context;
}
