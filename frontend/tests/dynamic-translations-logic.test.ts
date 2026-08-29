import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { translateEnumValue } from "../src/services/enumTranslations.ts";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("visible work-order translation references are deduplicated and send no source text", () => {
  const source = readSource("src/services/dynamicTranslations.ts");

  assert.match(source, /const seen = new Set<string>\(\)/);
  assert.match(source, /seen\.has\(workOrder\._id\)/);
  assert.match(source, /fields\.push\("description"\)/);
  assert.match(source, /fields\.push\("reschedule_reason"\)/);
  assert.match(source, /fields\.push\("lifecycle_history\.reason"\)/);
  assert.match(source, /entityId: workOrder\._id/);
  assert.doesNotMatch(source, /originalText:\s*workOrder/);
  assert.doesNotMatch(source, /translatedText:\s*workOrder/);
});

test("translation map supports show-original and translated display modes", () => {
  const source = readSource("src/services/dynamicTranslations.ts");

  assert.match(
    source,
    /if \(params\.showOriginal\) return params\.originalText \?\? ""/,
  );
  assert.match(
    source,
    /translation\?\.translatedText \|\| params\.originalText \|\| ""/,
  );
  assert.match(
    source,
    /dynamicTranslationKey\(result\.entityType, result\.entityId, result\.field\)/,
  );
});

test("hook cancels stale locale/page requests and resets display mode on locale change", () => {
  const source = readSource("src/hooks/useDynamicContentTranslations.ts");

  assert.match(source, /requestedKeys\.current\.clear\(\)/);
  assert.match(source, /setTranslations\(\{\}\)/);
  assert.match(source, /setShowOriginal\(false\)/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /return \(\) => controller\.abort\(\)/);
  assert.match(source, /requestSignature/);
});

test("work-order interfaces expose show-original controls and safety labels", () => {
  const files = [
    "src/app/[locale]/work-orders/page.tsx",
    "src/components/technician/TechnicianWorkspace.tsx",
    "src/components/technician/TechnicianWorkOrderDetail.tsx",
  ];

  for (const file of files) {
    const source = readSource(file);
    assert.match(source, /dynamicTranslations\.hasTranslationLocale/);
    assert.match(source, /dynamicTranslations\.showOriginal/);
    assert.match(source, /dynamicTranslations\.setShowOriginal/);
    assert.match(source, /dynamicTranslations\.isAutomaticallyTranslated/);
  }
});

test("unknown enum values fall back to the original value safely", () => {
  const tEnums = Object.assign((key: string) => `translated:${key}`, {
    has: () => false,
  });

  assert.equal(
    translateEnumValue(tEnums, "workOrderStatuses", "future_status"),
    "future_status",
  );
});

test("notification templates are rendered through next-intl params while free-form messages remain separate", () => {
  const source = readSource("src/components/NotificationBell.tsx");

  assert.match(source, /translationKey\?: string/);
  assert.match(
    source,
    /translationParams\?: Record<string, string \| number \| boolean \| null>/,
  );
  assert.match(
    source,
    /notificationTranslationParams\(item\.translationParams\)/,
  );
  assert.match(source, /typeof value === "boolean" \? String\(value\) : value/);
  assert.match(source, /return item\.title/);
  assert.match(source, /item\.message \?/);
});
