import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function readMessages(locale: string): any {
  const messagesPath = path.join(process.cwd(), "messages", `${locale}.json`);
  return JSON.parse(fs.readFileSync(messagesPath, "utf8"));
}

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return flatten(value as Record<string, unknown>, nextPrefix);
    }
    return [nextPrefix];
  });
}

// --- API Service Contract ---

test("apiService.getMttrAnalytics calls GET /analytics/mttr with year/machineId/technicianId params and abort signal", () => {
  const source = readSource("src/services/api.ts");

  assert.match(
    source,
    /getMttrAnalytics:\s*\(\s*\n?\s*params:\s*\{[\s\S]*?year:\s*number[\s\S]*?machineId\?:\s*string[\s\S]*?technicianId\?:\s*string[\s\S]*?\},\s*\n?\s*options\?:\s*\{\s*signal\?:\s*AbortSignal\s*\},\s*\n?\s*\)\s*=>\s*api\.get\(["']\/analytics\/mttr["'],\s*\{\s*params,\s*signal:\s*options\?\.signal\s*\}\)/,
    "getMttrAnalytics must GET /analytics/mttr with params and signal",
  );
});

// --- MttrAnalytics Component Contract ---

test("MttrAnalytics uses response.months for the monthly table, feeding same data to table and chart", () => {
  const source = readSource("src/components/reports/MttrAnalytics.tsx");

  assert.match(source, /data\.months\.map\(/, "table must render from data.months");
  assert.match(source, /trendData\s*=\s*useMemo/, "trendData must be derived via useMemo");
  assert.match(source, /data\.months[\s\S]*?filter\([\s\S]*?m\.mttrMinutes[\s\S]*?null/, "trend chart must filter non-null MTTR values from months");
  assert.match(source, /selectedMonth\.repairs\.map\(/, "details modal must render month.repairs");
});

test("MttrAnalytics shows No repairs / dash for zero-repair months, never zero MTTR", () => {
  const source = readSource("src/components/reports/MttrAnalytics.tsx");

  assert.match(
    source,
    /hasRepairs\s*&&\s*month\.mttrMinutes[\s\S]*?\?\s*formatDuration[\s\S]*?:\s*['"]—['"]/,
    "zero-repair months must show em dash for MTTR, not 0h",
  );
  assert.match(
    source,
    /hasRepairs\s*\?\s*formatDuration\([\s\S]*\)\s*:\s*['"]—['"]/,
    "zero-repair months must show dash for total repair time",
  );
  assert.match(source, /details\.noRepairs/, "details modal must reference noRepairs translation");
});

test("MttrAnalytics summary cards read from response.summary only", () => {
  const source = readSource("src/components/reports/MttrAnalytics.tsx");

  assert.match(source, /summary\.mttrMinutes/, "KPI must read summary.mttrMinutes");
  assert.match(source, /summary\.completedRepairs/, "KPI must read summary.completedRepairs");
  assert.match(source, /summary\.totalRepairMinutes/, "KPI must read summary.totalRepairMinutes");
});

test("MttrAnalytics error state shows translated error message and Retry button", () => {
  const source = readSource("src/components/reports/MttrAnalytics.tsx");

  assert.match(source, /t\(['"]error['"]\)/, "must use translated error key");
  assert.match(source, /t\(['"]errorMachineAccess['"]\)/, "must handle forbidden machine access");
  assert.match(source, /response\?\.status === 403/, "must distinguish forbidden machine access");
  assert.match(source, /t\(['"]retry['"]\)/, "must use translated retry key");
  assert.doesNotMatch(
    source,
    /error.*summary\.|error.*0\.mttr/,
    "error state must not reference zero KPI values",
  );
});

test("MttrAnalytics loading state uses skeleton panels, not stale KPI values", () => {
  const source = readSource("src/components/reports/MttrAnalytics.tsx");

  assert.match(source, /animate-pulse/, "loading state must show skeleton animation");
  assert.match(
    source,
    /loading\s*&&\s*!data/,
    "loading skeleton should only show when no data yet",
  );
});

test("MttrAnalytics details modal links to work-orders and intervention-reports routes using recordIds", () => {
  const source = readSource("src/components/reports/MttrAnalytics.tsx");

  assert.match(
    source,
    /work-orders\/\$\{repair\.workOrderRecordId\}/,
    "must link to /work-orders/{workOrderRecordId}",
  );
  assert.match(
    source,
    /intervention-reports\/\$\{repair\.reportRecordId\}/,
    "must link to /intervention-reports/{reportRecordId}",
  );
});

test("MttrAnalytics details modal shows MTTR formula with actual values", () => {
  const source = readSource("src/components/reports/MttrAnalytics.tsx");

  assert.match(source, /details\.formula/, "must show formula translation key");
  assert.match(
    source,
    /totalRepairMinutes[\s\S]*?completedRepairs/,
    "must display formula with actual total / completed values",
  );
});

test("MttrAnalytics never displays MongoDB ObjectIds directly in links or labels", () => {
  const source = readSource("src/components/reports/MttrAnalytics.tsx");

  assert.match(
    source,
    /machine\.code|machine\.reference/,
    "machine column should show code/reference not recordId",
  );
  assert.match(source, /repair\.workOrderId/, "work order cell should display workOrderId");
  assert.match(source, /repair\.reportRecordId/, "repair key should use reportRecordId for React key");
});

test("MttrAnalytics handles null mttrMinutes in trend chart (filters nulls only)", () => {
  const source = readSource("src/components/reports/MttrAnalytics.tsx");

  assert.match(
    source,
    /filter\([\s\S]*?m\.mttrMinutes\s*!==\s*null[\s\S]*?undefined/,
    "trend chart must filter months with null mttrMinutes",
  );
  assert.doesNotMatch(
    source,
    /m\.mttrMinutes\s*\?\s*0\s*:|\.mttrMinutes\s*\|\|\s*0/,
    "trend chart must not invent missing MTTR values",
  );
});

// --- Translation Key Parity ---

test("all six locale files have a mttr namespace with identical key sets", () => {
  const locales = ["en", "fr", "ar", "es", "de", "it"];

  const keysByLocale: Record<string, Set<string>> = {};
  for (const locale of locales) {
    const messages = readMessages(locale);
    assert.ok(messages.mttr, `${locale}.json must have a mttr namespace`);
    keysByLocale[locale] = new Set(flatten(messages.mttr));
  }

  const englishKeys = keysByLocale.en;
  for (const locale of locales) {
    const missing = [...englishKeys].filter((key) => !keysByLocale[locale].has(key));
    assert.deepEqual(missing, [], `${locale}.json is missing mttr keys: ${missing.join(", ")}`);
    const extra = [...keysByLocale[locale]].filter((key) => !englishKeys.has(key));
    assert.deepEqual(extra, [], `${locale}.json has extra mttr keys not in en.json: ${extra.join(", ")}`);
  }
});

test("mttr namespace includes all required categories of keys", () => {
  const mttr: any = readMessages("en").mttr;

  assert.equal(typeof mttr.header, "string", "mttr.header must be a string");
  assert.equal(typeof mttr.description, "string", "mttr.description must be a string");

  assert.ok(mttr.filters, "mttr.filters must exist");
  for (const key of ["year", "machine", "allMachines", "technician", "allTechnicians"]) {
    assert.equal(typeof mttr.filters[key], "string", `mttr.filters.${key} must be a string`);
  }

  assert.ok(mttr.summary, "mttr.summary must exist");
  for (const key of ["mttr", "completedRepairs", "totalRepairTime"]) {
    assert.equal(typeof mttr.summary[key], "string", `mttr.summary.${key} must be a string`);
  }

  assert.ok(mttr.table, "mttr.table must exist");
  for (const key of ["month", "completedRepairs", "totalRepairTime", "mttr", "action"]) {
    assert.equal(typeof mttr.table[key], "string", `mttr.table.${key} must be a string`);
  }
  assert.equal(typeof mttr.table.viewDetails, "string", "mttr.table.viewDetails must be a string");

  assert.ok(mttr.trend, "mttr.trend must exist");
  assert.equal(typeof mttr.trend.title, "string", "mttr.trend.title must be a string");

  assert.ok(mttr.details, "mttr.details must exist");
  for (const key of ["title", "formula", "workOrder", "machine", "technician", "repairStart", "repairEnd", "repairDuration", "action", "noRepairs"]) {
    assert.equal(typeof mttr.details[key], "string", `mttr.details.${key} must be a string`);
  }
  assert.match(mttr.details.title, /\{monthName\}.*\{year\}/, "details.title must interpolate {monthName} and {year}");

  assert.ok(mttr.noData, "mttr.noData must exist");
  assert.equal(typeof mttr.noData.message, "string", "mttr.noData.message must be a string");
  assert.equal(typeof mttr.noData.repairs, "string", "mttr.noData.repairs must be a string");

  assert.equal(typeof mttr.error, "string", "mttr.error must be a string");
  assert.equal(typeof mttr.retry, "string", "mttr.retry must be a string");
  assert.equal(typeof mttr.exclusionNote, "string", "mttr.exclusionNote must be a string");
  assert.equal(typeof mttr.loading, "string", "mttr.loading must be a string");

  assert.equal(typeof mttr.errorMachineAccess, "string", "mttr.errorMachineAccess must be a string");
  assert.ok(mttr.excludedReasons, "mttr.excludedReasons must exist");
  for (const key of ["missingStartEnd", "endBeforeStart", "nonCorrective", "cancelledIncomplete", "missingUnresolvableWorkOrder"]) {
    assert.equal(typeof mttr.excludedReasons[key], "string", `mttr.excludedReasons.${key} must be a string`);
  }

  assert.ok(mttr.months, "mttr.months must exist");
  for (const key of ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]) {
    assert.equal(typeof mttr.months[key], "string", `mttr.months.${key} must be a string`);
  }

  assert.ok(mttr.durationUnits, "mttr.durationUnits must exist");
  assert.equal(typeof mttr.durationUnits.minutes, "string", "mttr.durationUnits.minutes must be a string");
  assert.equal(typeof mttr.durationUnits.hours, "string", "mttr.durationUnits.hours must be a string");
});

// --- Reports Page Integration ---

test("reports page integrates MttrAnalytics with machines and technicians props", () => {
  const source = readSource("src/app/[locale]/reports/page.tsx");

  assert.match(source, /MttrAnalytics/, "reports page must reference MttrAnalytics");
  assert.match(source, /machines=\{machines\}/, "reports page must pass machines prop");
  assert.match(source, /technicians=\{technicians\}/, "reports page must pass technicians prop");
  assert.match(
    source,
    /getMttrAnalytics|getUsers.*limit.*500/,
    "reports page must load MTTR data via the API service and users for technician filter",
  );
});

test("reports page does not break existing report builder or history behavior", () => {
  const source = readSource("src/app/[locale]/reports/page.tsx");

  assert.match(source, /builder\.type|builder\.format/, "report builder must still exist");
  assert.match(source, /history\.title/, "history section must still exist");
  assert.match(source, /schedules\.title/, "schedules section must still exist");
  assert.match(source, /BarChartCard/, "bar chart must still exist");
  assert.match(source, /VirtualizedDataTable/, "virtualized table must still exist");
  assert.match(source, /ProtectedRoute requiredRole="admin"/, "page must still be admin-gated");
});

test("MttrAnalytics localizes source timestamps and shows exclusion counts", () => {
  const source = readSource("src/components/reports/MttrAnalytics.tsx");

  assert.match(source, /formatDateTime\(repair\.startDate, locale\)/, "must localize repair start");
  assert.match(source, /formatDateTime\(repair\.endDate, locale\)/, "must localize repair end");
  assert.match(source, /data\.excluded\.total > 0/, "must show backed exclusion counts");
  assert.match(source, /excludedReasons\.\$\{reason\}/, "must label exclusion reasons");
});

test("MttrAnalytics imports types from the mttr types module", () => {
  const source = readSource("src/components/reports/MttrAnalytics.tsx");
  assert.match(source, /from ['"]@\/types\/mttr['"]/, "must import from @/types/mttr");
});
