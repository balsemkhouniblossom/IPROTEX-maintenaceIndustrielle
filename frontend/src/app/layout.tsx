import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import GlobalApiErrorBanner from "@/components/GlobalApiErrorBanner";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { isRtlLocale } from "@/i18n/config";
import {
  isThemePreference,
  THEME_COOKIE_NAME,
  THEME_STORAGE_KEY,
} from "@/components/theme/theme-config";

export const metadata: Metadata = {
  title: "IPROTEX - Gestion de machines Industrielles",
  description: "IPROTEX - Gestion de machines Industrielles",
};

function buildThemeInitScript() {
  return `(() => {
    try {
      const storageKey = '${THEME_STORAGE_KEY}';
      const cookieName = '${THEME_COOKIE_NAME}';
      const root = document.documentElement;
      const storedTheme = window.localStorage.getItem(storageKey);
      const cookieTheme = document.cookie
        .split('; ')
        .find((entry) => entry.startsWith(cookieName + '='))
        ?.split('=')[1];
      const isThemePreference = (value) => value === 'light' || value === 'dark' || value === 'system';
      const preference = [storedTheme, cookieTheme, root.dataset.themePreference].find(isThemePreference) || 'system';
      const resolvedTheme = preference === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : preference;

      root.dataset.themePreference = preference;
      root.dataset.theme = resolvedTheme;
      root.style.colorScheme = resolvedTheme;
    } catch (error) {
      console.error('Theme initialization failed', error);
    }
  })();`;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const cookieTheme = cookieStore.get(THEME_COOKIE_NAME)?.value;
  const themePreference = isThemePreference(cookieTheme) ? cookieTheme : 'system';
  const initialTheme = themePreference === 'light' || themePreference === 'dark' ? themePreference : undefined;
  // Falls back to "en" outside a [locale] route (e.g. the bare "/" redirect
  // page), where next-intl's middleware never sets a request locale.
  const locale = await getLocale().catch(() => 'en');

  return (
    <html
      lang={locale}
      dir={isRtlLocale(locale) ? 'rtl' : 'ltr'}
      suppressHydrationWarning
      data-theme={initialTheme}
      data-theme-preference={themePreference}
      style={initialTheme ? { colorScheme: initialTheme } : undefined}
    >
      <head>
        <script
          id="theme-init"
          dangerouslySetInnerHTML={{ __html: buildThemeInitScript() }}
        />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>
            {children}
            <GlobalApiErrorBanner />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}



