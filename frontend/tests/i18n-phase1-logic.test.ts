import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const LOCALES = ["en", "fr", "ar", "es", "de", "it"] as const;
const compareStrings = (left: string, right: string): number => left.localeCompare(right);

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function readMessages(locale: string): Record<string, unknown> {
  return JSON.parse(readSource(path.join("messages", `${locale}.json`)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function flatten(value: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const entries: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (isRecord(nested)) {
      Object.assign(entries, flatten(nested, nextKey));
    } else {
      entries[nextKey] = nested;
    }
  }
  return entries;
}

function leaf(messages: Record<string, unknown>, dottedKey: string): unknown {
  return dottedKey.split(".").reduce<unknown>((acc, part) => {
    return isRecord(acc) ? acc[part] : undefined;
  }, messages);
}

test("all locale files have exactly the same translation key structure", () => {
  const flattened = Object.fromEntries(
    LOCALES.map((locale) => [locale, Object.keys(flatten(readMessages(locale))).sort(compareStrings)]),
  ) as Record<(typeof LOCALES)[number], string[]>;

  for (const locale of LOCALES) {
    assert.deepEqual(flattened[locale], flattened.en, `${locale}.json keys must match en.json exactly`);
  }
});

test("all locale leaves are non-empty strings, numbers, booleans, or null values", () => {
  for (const locale of LOCALES) {
    const leaves = flatten(readMessages(locale));
    for (const [key, value] of Object.entries(leaves)) {
      if (typeof value === "string") {
        assert.ok(value.trim().length > 0, `${locale}.json ${key} must not be empty`);
        continue;
      }
      assert.ok(
        value === null || ["number", "boolean"].includes(typeof value),
        `${locale}.json ${key} must be a primitive translation leaf`,
      );
    }
  }
});

test("shared database enum display mappings exist in every locale", () => {
  const categories = [
    "roles",
    "permissions",
    "workOrderStatuses",
    "priorities",
    "maintenanceTypes",
    "machineStates",
    "reportTypes",
    "notificationTypes",
  ];
  const requiredKeys = [
    "roles.admin",
    "roles.technician",
    "roles.operator",
    "workOrderStatuses.pending",
    "workOrderStatuses.in_progress",
    "workOrderStatuses.waiting_parts",
    "priorities.urgent",
    "priorities.high",
    "maintenanceTypes.preventive",
    "maintenanceTypes.corrective",
    "machineStates.operational",
    "machineStates.offline",
    "reportTypes.preventive_compliance",
    "notificationTypes.work_order_assigned",
  ];

  for (const locale of LOCALES) {
    const messages = readMessages(locale);
    for (const category of categories) {
      assert.ok(isRecord(leaf(messages, `common.enums.${category}`)), `${locale}.json common.enums.${category} must exist`);
    }
    for (const key of requiredKeys) {
      assert.equal(typeof leaf(messages, `common.enums.${key}`), "string", `${locale}.json common.enums.${key} must be translated`);
    }
  }
});

test("important visible hardcoded text is not rendered directly in protected interfaces", () => {
  const dashboardLayout = readSource("src/components/DashboardLayout.tsx");
  const dashboard = readSource("src/app/Dashboard.tsx");

  assert.doesNotMatch(dashboardLayout, /name:\s*['"]Digital Twin['"]/);
  assert.match(dashboardLayout, /t\('navigation\.digitalTwin'\)/);
  assert.doesNotMatch(dashboard, />\s*\{wo\.status\}\s*</);
  assert.match(dashboard, /translateEnumValue\(tEnums, 'workOrderStatuses', wo\.status\)/);
});

test("language switcher replaces or inserts the locale while preserving the path and query string", () => {
  const source = readSource("src/components/LanguageSwitcher.tsx");

  assert.match(source, /const segments = pathname\.split\('\/'\)\.filter\(Boolean\)/);
  assert.match(source, /nextSegments\[0\] = locale/);
  assert.match(source, /nextSegments\.unshift\(locale\)/);
  assert.match(source, /window\.location\.search\.replace/);
  assert.match(source, /router\.replace\(nextPath\)/);
  assert.match(source, /NEXT_LOCALE=\$\{locale\}/);
});

test("Arabic locale uses RTL document direction through the locale layout", () => {
  const config = readSource("src/i18n/config.ts");
  const layout = readSource("src/app/[locale]/layout.tsx");
  const rootLayout = readSource("src/app/layout.tsx");

  assert.match(config, /startsWith\("ar"\)/);
  assert.match(layout, /const isRtl = isRtlLocale\(locale\)/);
  assert.match(layout, /<div dir=\{isRtl \? "rtl" : "ltr"\}>/);
  assert.match(rootLayout, /dir=\{isRtlLocale\(locale\) \? 'rtl' : 'ltr'\}/);
});
