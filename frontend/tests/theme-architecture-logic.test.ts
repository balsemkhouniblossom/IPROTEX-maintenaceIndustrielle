import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("theme config has one preference contract shared by storage, cookie, and provider", () => {
  const config = readSource("src/components/theme/theme-config.ts");
  assert.match(config, /THEME_STORAGE_KEY = 'gmao-theme-preference'/);
  assert.match(config, /THEME_COOKIE_NAME = 'gmao-theme'/);
  assert.match(config, /THEME_PREFERENCES = \['light', 'dark', 'system'\] as const/);
  assert.match(config, /THEME_PREFERENCES\.includes/);
});

test("root layout bootstraps data-theme before hydration and validates stored preferences", () => {
  const layout = readSource("src/app/layout.tsx");
  assert.match(layout, /suppressHydrationWarning/);
  assert.match(layout, /<Script id="theme-init" strategy="beforeInteractive">/);
  assert.match(layout, /\{buildThemeInitScript\(\)\}/);
  assert.match(layout, /const isThemePreference = \(value\) => value === 'light' \|\| value === 'dark' \|\| value === 'system';/);
  assert.match(layout, /\[storedTheme, cookieTheme, root\.dataset\.themePreference\]\.find\(isThemePreference\) \|\| 'system'/);
  assert.match(layout, /root\.dataset\.theme = resolvedTheme/);
  assert.match(layout, /root\.style\.colorScheme = resolvedTheme/);
});

test("Tailwind dark variants are bound to the data-theme source of truth", () => {
  const css = readSource("src/app/globals.css");
  assert.match(css, /@custom-variant dark \(&:where\(\[data-theme='dark'\], \[data-theme='dark'\] \*\)\);/);
  assert.match(css, /\[data-theme='dark'\]/);
});
