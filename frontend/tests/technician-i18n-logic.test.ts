import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

type Messages = Record<string, unknown>;

function readMessages(locale: "en" | "ar"): Messages {
  return JSON.parse(
    fs.readFileSync(path.join(process.cwd(), `messages/${locale}.json`), "utf8"),
  ) as Messages;
}

function flatten(value: unknown, prefix = "", output = new Map<string, unknown>()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    output.set(prefix, value);
    return output;
  }
  for (const [key, child] of Object.entries(value)) {
    flatten(child, prefix ? `${prefix}.${key}` : key, output);
  }
  return output;
}

test("English and Arabic Technician catalogues expose the same complete key set", () => {
  const english = flatten(readMessages("en").technician);
  const arabic = flatten(readMessages("ar").technician);

  assert.deepEqual([...arabic.keys()].sort(), [...english.keys()].sort());
  for (const [key, value] of english) {
    assert.equal(typeof value, "string", `English Technician key ${key} must be text`);
    assert.ok(String(value).trim(), `English Technician key ${key} must not be empty`);
    assert.ok(String(arabic.get(key)).trim(), `Arabic Technician key ${key} must not be empty`);
  }
});

test("Arabic Technician workflow labels are translated rather than English placeholders", () => {
  const arabic = flatten(readMessages("ar").technician);
  const requiredArabicKeys = [
    "dashboard.sections.todaysPriority",
    "dashboard.sections.upcomingWork",
    "dashboard.sections.recentlyCompleted",
    "workOrders.myTitle",
    "workOrderTabs.assigned",
    "workOrderTabs.inProgress",
    "workOrderTabs.waitingParts",
    "actions.viewWorkOrder",
    "actions.continueIntervention",
    "filters.searchPlaceholder",
    "fields.due",
    "parts.requestPart",
    "detailTabs.overview",
    "overview.title",
    "machineContext.title",
    "aiInsight.title",
    "intervention.diagnosis",
    "completion.completedMessage",
    "history.statusChanged",
    "errors.forbiddenMachine",
  ];

  for (const key of requiredArabicKeys) {
    const value = String(arabic.get(key));
    assert.match(value, /[\u0600-\u06ff]/, `${key} must contain Arabic text`);
    assert.doesNotMatch(value, /\?{2,}/, `${key} must not contain replacement placeholders`);
  }
});

test("Technician detail maps forbidden API responses to localized safe copy", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/components/technician/TechnicianWorkOrderDetail.tsx"),
    "utf8",
  );

  assert.match(source, /apiErrorStatus\(error\) === 403/);
  assert.match(source, /t\("errors\.forbiddenMachine"\)/);
  assert.doesNotMatch(source, /response\?\.data\s*\?\.message/);
});

test("Technician search and detail controls use logical RTL-safe spacing", () => {
  const files = [
    "src/components/technician/TechnicianWorkspace.tsx",
    "src/components/technician/TechnicianDocumentBrowser.tsx",
    "src/components/technician/TechnicianWorkOrderDetail.tsx",
    "src/components/technician/MachineHealthDetail.tsx",
    "src/components/technician/MachineHealthCard.tsx",
    "src/app/[locale]/technician/machine-health/page.tsx",
  ];
  const source = files
    .map((file) => fs.readFileSync(path.join(process.cwd(), file), "utf8"))
    .join("\n");

  assert.doesNotMatch(source, /absolute left-3 top-1\/2/);
  assert.doesNotMatch(source, /py-2 pl-9 pr-3/);
  assert.doesNotMatch(source, /\btext-left\b/);
  assert.doesNotMatch(source, /className="ml-3"/);
  assert.doesNotMatch(source, /\bmr-2 inline-block/);
  assert.match(source, /absolute inset-s-3 top-1\/2/);
  assert.match(source, /py-2 ps-9 pe-3/);
});

test("Shared pagination is localized and reverses navigation icons in Arabic", () => {
  const paginationSource = fs.readFileSync(
    path.join(process.cwd(), "src/components/Pagination.tsx"),
    "utf8",
  );
  const english = readMessages("en") as { common: { pagination: Messages } };
  const arabic = readMessages("ar") as { common: { pagination: Messages } };

  for (const key of ["label", "previous", "next", "page", "showing"]) {
    assert.ok(english.common.pagination[key], `English pagination.${key} is required`);
    assert.ok(arabic.common.pagination[key], `Arabic pagination.${key} is required`);
  }
  assert.match(paginationSource, /useTranslations\('common\.pagination'\)/);
  assert.match(paginationSource, /const isRtl = locale === 'ar'/);
  assert.doesNotMatch(paginationSource, />Previous<|>Next<|Showing <span/);
});
