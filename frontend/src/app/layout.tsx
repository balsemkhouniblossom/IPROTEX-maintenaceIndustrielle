import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";
import { Montserrat, Source_Sans_3 } from "next/font/google";
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

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

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
      const preference = storedTheme || cookieTheme || root.dataset.themePreference || 'system';
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
}: {
  children: React.ReactNode;
}) {
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
      <body className={`${montserrat.variable} ${sourceSans.variable}`}>
        <script dangerouslySetInnerHTML={{ __html: buildThemeInitScript() }} />
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



