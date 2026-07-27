import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const PAGE = "src/app/[locale]/preventive-task-checklist/page.tsx";
const LOCALES = ["en", "fr", "ar", "de", "es", "it"];

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return flatten(value as Record<string, unknown>, nextPrefix);
    }
    return [nextPrefix];
  });
}

test("the completion-rate stat card uses its own label, not the row-status column label", () => {
  const source = readSource(PAGE);

  // Regression guard: this stat card renders a percentage (completionRate),
  // it previously reused t("table.status") - the same key used for the
  // per-row Pending/Completed column header - which showed "Status" above
  // a percentage instead of a label describing the percentage.
  assert.match(source, /t\("completionRate"\)[\s\S]{0,80}completionRate\}%/);
});

test("all supported locales define the preventiveTaskChecklist translation namespace with matching keys", () => {
  const keysByLocale: Record<string, Set<string>> = {};

  for (const locale of LOCALES) {
    const messagesPath = path.join(process.cwd(), "messages", `${locale}.json`);
    const messages = JSON.parse(fs.readFileSync(messagesPath, "utf8"));
    assert.ok(
      messages.preventiveTaskChecklist,
      `${locale}.json must have a preventiveTaskChecklist namespace`,
    );
    assert.equal(
      typeof messages.preventiveTaskChecklist.completionRate,
      "string",
      `${locale}.json preventiveTaskChecklist.completionRate must be a non-empty string`,
    );
    assert.notEqual(messages.preventiveTaskChecklist.completionRate.trim(), "");
    keysByLocale[locale] = new Set(flatten(messages.preventiveTaskChecklist));
  }

  const referenceKeys = keysByLocale.en;
  for (const locale of LOCALES) {
    const keys = keysByLocale[locale];
    const missing = [...referenceKeys].filter((key) => !keys.has(key));
    const extra = [...keys].filter((key) => !referenceKeys.has(key));
    assert.deepEqual(missing, [], `${locale}.json is missing preventiveTaskChecklist keys: ${missing.join(", ")}`);
    assert.deepEqual(extra, [], `${locale}.json has extraneous preventiveTaskChecklist keys: ${extra.join(", ")}`);
  }
});
