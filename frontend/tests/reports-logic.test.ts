import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const API = "src/services/api.ts";
const PAGE = "src/app/[locale]/reports/page.tsx";
const BAR_CHART = "src/components/charts/BarChartCard.tsx";
const LINE_CHART = "src/components/charts/LineChartCard.tsx";
const DASHBOARD_LAYOUT = "src/components/DashboardLayout.tsx";

test("apiService exposes the reports read, write, and schedule endpoints", () => {
  const source = readSource(API);

  assert.match(source, /getReportTypes:\s*\(\)\s*=>\s*api\.get\(["']\/reports\/types["']\)/);
  assert.match(
    source,
    /getReports:\s*\(\s*\n?\s*params\?:[\s\S]*?\n?\s*options\?:\s*\{\s*signal\?:\s*AbortSignal\s*\},?\s*\n?\s*\)\s*=>\s*\n?\s*api\.get\(["']\/reports["'],\s*\{\s*params,\s*signal:\s*options\?\.signal\s*\}\)/,
    "apiService.getReports must GET /reports with optional pagination/filter params and an abortable signal",
  );
  assert.match(
    source,
    /getAllReports:\s*\(\s*\n?\s*params\?:[\s\S]*?\n?\s*options\?:\s*\{\s*signal\?:\s*AbortSignal\s*\},?\s*\n?\s*\)\s*=>\s*\n?\s*api\.get\(["']\/reports\/all["'],\s*\{\s*params,\s*signal:\s*options\?\.signal\s*\}\)/,
    "apiService.getAllReports must GET /reports/all with optional pagination/filter params and an abortable signal",
  );
  assert.match(
    source,
    /getReport:\s*\(id:\s*string\)\s*=>\s*api\.get\(`\/reports\/\$\{id\}`\)/,
    "apiService.getReport must GET /reports/:id",
  );
  assert.match(
    source,
    /requestReport:\s*\(data:\s*\{[\s\S]*?\}\)\s*=>\s*api\.post\(["']\/reports["'],\s*data\)/,
    "apiService.requestReport must POST /reports",
  );
  assert.match(
    source,
    /deleteReport:\s*\(id:\s*string\)\s*=>\s*api\.delete\(`\/reports\/\$\{id\}`\)/,
    "apiService.deleteReport must DELETE /reports/:id",
  );
  assert.match(
    source,
    /downloadReportFile:\s*\(id:\s*string\)\s*=>\s*\n?\s*api\.get\(`\/reports\/\$\{id\}\/download`,\s*\{[\s\S]*?responseType:\s*["']blob["'][\s\S]*?\}\)/,
    "apiService.downloadReportFile must GET /reports/:id/download as a blob",
  );
  assert.match(source, /getReportSchedules:\s*\(\)\s*=>\s*api\.get\(["']\/reports\/schedules["']\)/);
  assert.match(
    source,
    /createReportSchedule:\s*\(data:\s*\{[\s\S]*?\}\)\s*=>\s*api\.post\(["']\/reports\/schedules["'],\s*data\)/,
  );
  assert.match(
    source,
    /updateReportSchedule:\s*\(\s*\n?\s*id:\s*string,[\s\S]*?\)\s*=>\s*api\.patch\(`\/reports\/schedules\/\$\{id\}`,\s*data\)/,
  );
  assert.match(
    source,
    /deleteReportSchedule:\s*\(id:\s*string\)\s*=>\s*api\.delete\(`\/reports\/schedules\/\$\{id\}`\)/,
  );
});

test("the Reports page is gated to Admin via ProtectedRoute, matching the users/Dashboard pattern", () => {
  const source = readSource(PAGE);

  assert.match(source, /import ProtectedRoute from '@\/components\/auth\/ProtectedRoute';/);
  assert.match(
    source,
    /<ProtectedRoute requiredRole="admin">\s*\n\s*<ReportsPageContent \/>/,
    "the default export must wrap the page content in an Admin-only ProtectedRoute",
  );
});

test("report downloads go through an authenticated blob fetch, never a plain <a href> to the API", () => {
  const source = readSource(PAGE);

  assert.match(
    source,
    /apiService\.downloadReportFile\(report\.\_id\)/,
    "must call the authenticated blob-download endpoint",
  );
  assert.match(
    source,
    /URL\.createObjectURL\(response\.data as Blob\)/,
    "must build a local object URL from the fetched blob, same pattern as DocumentAttachmentViewer",
  );
  assert.doesNotMatch(
    source,
    /href=\{`\$\{.*\/reports\//,
    "must never render a raw API URL as an anchor href — the download route sits behind JwtAuthGuard and needs the Authorization header",
  );
});

test("report generation status is polled only while something is still pending/processing", () => {
  const source = readSource(PAGE);

  assert.match(
    source,
    /const hasInFlight = reportsTable\.items\.some\(\(r\) => r\.status === 'pending' \|\| r\.status === 'processing'\);/,
  );
  assert.match(source, /if \(!hasInFlight\) return;/, "must stop polling once nothing is in flight");
  assert.match(source, /window\.setInterval\(\(\) => \{\s*\n\s*void reportsTable\.reload\(\);/);
});

test("the machine picker only appears for report types the backend actually scopes by machine", () => {
  const source = readSource(PAGE);

  assert.match(
    source,
    /const MACHINE_SCOPED_TYPES = new Set<ReportType>\(\[\s*\n\s*'machine_history',\s*\n\s*'preventive_compliance',\s*\n\s*'corrective_downtime',\s*\n\s*'mttr_mtbf_trends',\s*\n\s*'fault_frequency',\s*\n\s*'predictive_risk',\s*\n\s*\]\);/,
    "must mirror backend REPORT_TYPE_ROLES machine-scoping exactly",
  );
  assert.match(source, /const MACHINE_REQUIRED_TYPES = new Set<ReportType>\(\['machine_history'\]\);/);
});

test("BarChartCard and LineChartCard are generic reusable components, not report-specific", () => {
  for (const file of [BAR_CHART, LINE_CHART]) {
    const source = readSource(file);
    assert.match(source, /from 'recharts'/, `${file} must be built on recharts`);
    assert.doesNotMatch(
      source,
      /report|Report/,
      `${file} must stay generic — no report-specific naming, so other features can reuse it`,
    );
    assert.match(source, /(interface|type) \w+CardProps/, `${file} must expose a typed props contract`);
    assert.match(source, /emptyLabel/, `${file} must support an empty state`);
  }
});

test("DashboardLayout adds an Analytics & Reports nav entry for Admin", () => {
  const source = readSource(DASHBOARD_LAYOUT);

  assert.match(
    source,
    /\{ name: t\('navigation\.analyticsAndReports'\), href: '\/reports', icon: ChartBarIcon,/, 
    "Admin nav must include an Analytics & Reports link",
  );
});

test("all supported locales define the reports translation namespace with matching keys", () => {
  const locales = ["en", "fr", "ar", "es", "de", "it"];

  function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
    return Object.entries(obj).flatMap(([key, value]) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return flatten(value as Record<string, unknown>, nextPrefix);
      }
      return [nextPrefix];
    });
  }

  const keysByLocale: Record<string, Set<string>> = {};
  for (const locale of locales) {
    const messagesPath = path.join(process.cwd(), "messages", `${locale}.json`);
    const messages = JSON.parse(fs.readFileSync(messagesPath, "utf8"));
    assert.ok(messages.reports, `${locale}.json must have a reports namespace`);
    const sidebarLabel = messages.sidebar?.navigation?.reports;
    assert.equal(typeof sidebarLabel, "string", `${locale}.json sidebar.navigation.reports must be a string`);
    assert.ok(sidebarLabel.length > 0, `${locale}.json sidebar.navigation.reports must be non-empty`);
    keysByLocale[locale] = new Set(flatten(messages.reports));
  }

  const englishKeys = keysByLocale.en;
  for (const locale of locales) {
    const missing = [...englishKeys].filter((key) => !keysByLocale[locale].has(key));
    assert.deepEqual(missing, [], `${locale}.json is missing reports keys: ${missing.join(", ")}`);
    const extra = [...keysByLocale[locale]].filter((key) => !englishKeys.has(key));
    assert.deepEqual(extra, [], `${locale}.json has extra reports keys not in en.json: ${extra.join(", ")}`);
  }

  const requiredKeys = [
    "pageTitle",
    "builder.type",
    "builder.format",
    "builder.machine",
    "builder.generate",
    "charts.byType",
    "charts.byStatus",
    "history.title",
    "history.table.type",
    "history.table.status",
    "schedules.title",
    "schedules.frequency",
    "types.machine_history",
    "types.preventive_compliance",
    "types.corrective_downtime",
    "types.mttr_mtbf_trends",
    "types.stock_movements",
    "types.maintenance_costs",
    "types.technician_workload",
    "types.fault_frequency",
    "types.audit_history",
    "types.predictive_risk",
    "formats.pdf",
    "formats.excel",
    "formats.csv",
    "frequencies.daily",
    "frequencies.weekly",
    "frequencies.monthly",
    "status.pending",
    "status.processing",
    "status.completed",
    "status.failed",
  ];
  for (const key of requiredKeys) {
    assert.ok(englishKeys.has(key), `en.json reports is missing required key: ${key}`);
  }
});
