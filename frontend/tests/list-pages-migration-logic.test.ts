import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const WORK_ORDERS_PAGE = "src/app/[locale]/work-orders/page.tsx";
const MAINTENANCE_PLANS_PAGE = "src/app/[locale]/maintenance-plans/page.tsx";
const REPORTS_PAGE = "src/app/[locale]/reports/page.tsx";
const LIST_INVALIDATION = "src/services/listInvalidation.ts";
const API = "src/services/api.ts";

test("Work Orders, Maintenance Plans, and Reports pages are all wired onto the shared list infra", () => {
  for (const page of [WORK_ORDERS_PAGE, MAINTENANCE_PLANS_PAGE, REPORTS_PAGE]) {
    const source = readSource(page);
    assert.match(source, /from "@\/hooks\/useServerTable"|from '@\/hooks\/useServerTable'/, `${page} must use useServerTable`);
    assert.match(
      source,
      /from "@\/components\/VirtualizedDataTable"|from '@\/components\/VirtualizedDataTable'/,
      `${page} must render VirtualizedDataTable instead of a native <table>`,
    );
    if (page !== REPORTS_PAGE) {
      // The Reports page keeps one native <table> for its untouched
      // schedules sub-section (out of migration scope) — only its
      // Generated Reports history list moved to VirtualizedDataTable.
      assert.doesNotMatch(source, /<table[\s>]/, `${page} must not keep a native <table> element after migration`);
    }
    assert.match(
      source,
      /from "@\/components\/StatusBadge"|from '@\/components\/StatusBadge'/,
      `${page} must use the shared StatusBadge`,
    );
    assert.match(
      source,
      /from "@\/components\/SavedViewsBar"|from '@\/components\/SavedViewsBar'/,
      `${page} must use the shared SavedViewsBar`,
    );
    assert.match(source, /<SavedViewsBar/, `${page} must render <SavedViewsBar>`);
    assert.match(
      source,
      /from "@\/components\/Pagination"|from '@\/components\/Pagination'/,
      `${page} must keep the existing Pagination component alongside the virtualized table`,
    );
    assert.match(source, /<Pagination/, `${page} must render <Pagination>`);
    assert.match(source, /applySavedView/, `${page} must implement applySavedView`);
    assert.match(source, /saveCurrentView/, `${page} must implement saveCurrentView`);
    assert.match(source, /deleteSavedView/, `${page} must implement deleteSavedView`);
  }
});

test("Work Orders page fetcher calls apiService.getWorkOrders with page/limit/search/sort/status/priority and an abort signal", () => {
  const source = readSource(WORK_ORDERS_PAGE);

  assert.match(source, /const fetcher = useCallback\(/);
  assert.match(source, /apiService\.getWorkOrders\(/);
  assert.match(source, /status: query\.filters\.status \|\| undefined/);
  assert.match(source, /priority: query\.filters\.priority \|\| undefined/);
  assert.match(source, /\{ signal \}/, "fetcher must thread the AbortSignal from useServerTable into apiService.getWorkOrders");

  assert.match(
    source,
    /const table = useServerTable<WorkOrder, WorkOrdersFilters>\(\{\s*\n\s*fetcher,/,
    "must wire useServerTable with the WorkOrder/WorkOrdersFilters generics",
  );
});

test("Work Orders page preserves its CRUD business logic verbatim (validateForm/resetForm/handleCreate/handleEdit/handleDelete/handleSubmit)", () => {
  const source = readSource(WORK_ORDERS_PAGE);

  assert.match(source, /const validateForm = \(\) => \{/);
  assert.match(source, /tWorkOrders\("validation\.referenceRequired"/);
  assert.match(source, /tWorkOrders\("validation\.machineRequired"\)/);
  assert.match(source, /tWorkOrders\("validation\.technicianRequired"\)/);

  assert.match(source, /const resetForm = \(\) => \{/);
  assert.match(source, /const handleCreate = \(\) => \{/);
  assert.match(source, /const handleEdit = \(workOrder: WorkOrder\) => \{/);
  assert.match(source, /const handleDelete = async \(workOrderId: string\) => \{/);
  assert.match(source, /apiService\.deleteWorkOrder\(workOrderId\)/);
  assert.match(source, /const handleSubmit = async \(e: React\.FormEvent\) => \{/);
  assert.match(source, /apiService\.updateWorkOrder\(editingWorkOrder\._id, data\)/);
  assert.match(source, /apiService\.createWorkOrder\(data\)/);
});

test("Work Orders page invalidates the shared workOrders list event on its own CRUD, and listens for cross-page invalidation", () => {
  const source = readSource(WORK_ORDERS_PAGE);

  assert.match(source, /import \{ invalidateList, LIST_EVENTS, useListInvalidation \} from "@\/services\/listInvalidation";/);
  assert.match(source, /useListInvalidation\(LIST_EVENTS\.workOrders, table\.reload\)/);
  assert.match(source, /async function refreshWorkOrders\(\) \{\s*\n\s*invalidateList\(LIST_EVENTS\.workOrders\);/);
});

test("Work Orders page edit/delete action buttons carry an accessible name including the work order reference", () => {
  const source = readSource(WORK_ORDERS_PAGE);

  assert.match(source, /aria-label=\{`\$\{tCommon\("edit"\)\} \$\{wo\.ot_id\}`\}/);
  assert.match(source, /aria-label=\{`\$\{tCommon\("delete"\)\} \$\{wo\.ot_id\}`\}/);
});

test("Maintenance Plans page fetcher calls apiService.getMaintenancePlans and applies the same post-fetch cleanup as before migration", () => {
  const source = readSource(MAINTENANCE_PLANS_PAGE);

  assert.match(source, /const fetcher = useCallback\(/);
  assert.match(source, /apiService\.getMaintenancePlans\(/);
  assert.match(source, /status: query\.filters\.status \|\| undefined/);
  assert.match(source, /typeMaintenance: query\.filters\.typeMaintenance \|\| undefined/);
  assert.match(source, /\{ signal \}/, "fetcher must thread the AbortSignal into apiService.getMaintenancePlans");
  // The pre-migration loadData() cleaned instruction/responsable text on every fetched item — that must survive.
  assert.match(source, /instruction: cleanInstruction\(plan\.instruction\)/);
  assert.match(source, /responsable: cleanResponsable\(plan\.responsable\)/);

  assert.match(
    source,
    /const table = useServerTable<MaintenancePlan, MaintenancePlansFilters>\(\{\s*\n\s*fetcher,/,
  );
});

test("Maintenance Plans page preserves its lifecycle business logic verbatim (AVAILABLE_TRANSITIONS/handleTransition/handleSubmit/validateForm)", () => {
  const source = readSource(MAINTENANCE_PLANS_PAGE);

  assert.match(source, /const AVAILABLE_TRANSITIONS: Record<\s*\n\s*MaintenancePlanStatus,\s*\n\s*MaintenancePlanTransitionAction\[\]\s*\n>/);
  assert.match(source, /function validateForm\(\): boolean \{/);
  assert.match(source, /function handleCreate\(\) \{/);
  assert.match(source, /function handleEdit\(plan: MaintenancePlan\) \{/);
  assert.match(source, /apiService\.transitionMaintenancePlan\(/);
  assert.match(source, /confirm\(t\(TRANSITION_CONFIRM_KEYS\[action\]\)\)/);
});

test("Maintenance Plans page has no cross-page invalidation wiring (no other page mutates plan data)", () => {
  const source = readSource(MAINTENANCE_PLANS_PAGE);

  assert.doesNotMatch(
    source,
    /listInvalidation/,
    "maintenance-plans/page.tsx must not import listInvalidation — only same-page table.reload() is needed",
  );
  assert.match(source, /await table\.reload\(\)/, "must reload the table directly after its own CRUD/transitions");
});

test("LIST_EVENTS.maintenancePlans is defined but never dispatched or subscribed to anywhere in the app", () => {
  const invalidationSource = readSource(LIST_INVALIDATION);
  assert.match(invalidationSource, /maintenancePlans:\s*'maintenance-plans:changed'/);

  const appFiles = fs.readdirSync(path.join(process.cwd(), "src"), { recursive: true }) as string[];
  const usages: string[] = [];
  for (const relative of appFiles) {
    if (!/\.tsx?$/.test(relative)) continue;
    const fullPath = path.join(process.cwd(), "src", relative);
    if (fullPath === path.join(process.cwd(), LIST_INVALIDATION)) continue;
    const source = fs.readFileSync(fullPath, "utf8");
    if (/LIST_EVENTS\.maintenancePlans/.test(source)) usages.push(relative);
  }
  assert.deepEqual(
    usages,
    [],
    `LIST_EVENTS.maintenancePlans must stay unused — no page mutates plan data from elsewhere: found in ${usages.join(", ")}`,
  );
});

test("Reports page fetcher branches on scope between the scoped and all-reports endpoints, both with an abort signal", () => {
  const source = readSource(REPORTS_PAGE);

  assert.match(source, /const reportsFetcher = useCallback\(/);
  assert.match(
    source,
    /query\.filters\.scope === 'mine'\s*\n\s*\? await apiService\.getReports\(params, \{ signal \}\)\s*\n\s*: await apiService\.getAllReports\(params, \{ signal \}\)/,
  );
  assert.match(
    source,
    /const reportsTable = useServerTable<GeneratedReport, ReportsFilters>\(\{\s*\n\s*fetcher: reportsFetcher,/,
  );
});

test("Reports page keeps the async pending/processing poll driven by the current table page, and stops once nothing is in flight", () => {
  const source = readSource(REPORTS_PAGE);

  assert.match(
    source,
    /const hasInFlight = reportsTable\.items\.some\(\(r\) => r\.status === 'pending' \|\| r\.status === 'processing'\);/,
  );
  assert.match(source, /if \(!hasInFlight\) return;/);
  assert.match(source, /void reportsTable\.reload\(\);/);
});

test("Reports page adds status/type filters alongside the pre-existing scope filter, all bound to the table's filters state", () => {
  const source = readSource(REPORTS_PAGE);

  assert.match(source, /value=\{reportsTable\.filters\.scope\}/);
  assert.match(source, /value=\{reportsTable\.filters\.status\}/);
  assert.match(source, /value=\{reportsTable\.filters\.type\}/);
});

test("Reports page charts are computed from the current table page only, with a comment documenting the tradeoff", () => {
  const source = readSource(REPORTS_PAGE);
  assert.match(source, /for \(const report of reportsTable\.items\) counts\.set\(report\.type,/);
  assert.match(source, /for \(const report of reportsTable\.items\) counts\.set\(report\.status,/);
});

test("Reports page download/delete action buttons carry an accessible name including the report id", () => {
  const source = readSource(REPORTS_PAGE);

  assert.match(source, /aria-label=\{`\$\{t\('history\.download'\)\} \$\{report\.report_id\}`\}/);
  assert.match(source, /aria-label=\{`\$\{tCommon\('delete'\)\} \$\{report\.report_id\}`\}/);
});

test("apiService.getWorkOrders and getMaintenancePlans accept an AbortSignal option, threaded into the axios request", () => {
  const source = readSource(API);

  assert.match(
    source,
    /getWorkOrders:\s*\([\s\S]*?options\?:\s*\{\s*signal\?:\s*AbortSignal\s*\},?\s*\n?\s*\)\s*=>\s*\n?\s*api\.get\('\/work-orders',\s*\{\s*params,\s*signal:\s*options\?\.signal\s*\}\)/,
  );
  assert.match(
    source,
    /getMaintenancePlans:\s*\([\s\S]*?options\?:\s*\{\s*signal\?:\s*AbortSignal\s*\},?\s*\n?\s*\)\s*=>\s*\n?\s*api\.get\('\/maintenance-plans',\s*\{\s*params,\s*signal:\s*options\?\.signal\s*\}\)/,
  );
});

test("Operator corrective/preventive submissions and Technician work-order actions invalidate the shared workOrders list event", () => {
  const reportProblem = readSource("src/app/[locale]/operator/report-problem/page.tsx");
  assert.match(reportProblem, /import \{ invalidateList, LIST_EVENTS \} from "@\/services\/listInvalidation";/);
  assert.match(reportProblem, /invalidateList\(LIST_EVENTS\.workOrders\);/);

  const preventive = readSource("src/app/[locale]/operator/preventive/page.tsx");
  assert.match(preventive, /import \{ invalidateList, LIST_EVENTS \} from "@\/services\/listInvalidation";/);
  assert.match(preventive, /invalidateList\(LIST_EVENTS\.workOrders\);/);

  const technicianDetail = readSource("src/components/technician/TechnicianWorkOrderDetail.tsx");
  assert.match(technicianDetail, /import \{ invalidateList, LIST_EVENTS \} from "@\/services\/listInvalidation";/);
  assert.match(technicianDetail, /invalidateList\(LIST_EVENTS\.workOrders\);/);
});

test("useServerTable exposes a raw setSort setter for saved-views to restore an exact sort value", () => {
  const source = readSource("src/hooks/useServerTable.ts");
  assert.match(source, /setSort,/, "the hook's returned object must expose setSort alongside sort");
  assert.match(
    source,
    /const sortDirection: 'asc' \| 'desc' \| undefined =/,
    "sortDirection must be explicitly typed so it satisfies VirtualizedDataTable's SortDirection prop",
  );
});

test("all supported locales define common.savedViews, workOrders.filters, and maintenancePlans.filters with matching keys", () => {
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

  const savedViewsKeysByLocale: Record<string, Set<string>> = {};
  const workOrdersFiltersKeysByLocale: Record<string, Set<string>> = {};
  const maintenancePlansFiltersKeysByLocale: Record<string, Set<string>> = {};

  for (const locale of locales) {
    const messagesPath = path.join(process.cwd(), "messages", `${locale}.json`);
    const messages = JSON.parse(fs.readFileSync(messagesPath, "utf8"));

    assert.ok(messages.common?.savedViews, `${locale}.json must have a common.savedViews namespace`);
    assert.ok(messages.workOrders?.filters, `${locale}.json must have a workOrders.filters namespace`);
    assert.ok(messages.maintenancePlans?.filters, `${locale}.json must have a maintenancePlans.filters namespace`);

    savedViewsKeysByLocale[locale] = new Set(flatten(messages.common.savedViews));
    workOrdersFiltersKeysByLocale[locale] = new Set(flatten(messages.workOrders.filters));
    maintenancePlansFiltersKeysByLocale[locale] = new Set(flatten(messages.maintenancePlans.filters));
  }

  for (const [label, keysByLocale] of [
    ["common.savedViews", savedViewsKeysByLocale],
    ["workOrders.filters", workOrdersFiltersKeysByLocale],
    ["maintenancePlans.filters", maintenancePlansFiltersKeysByLocale],
  ] as const) {
    const englishKeys = keysByLocale.en;
    for (const locale of locales) {
      const missing = [...englishKeys].filter((key) => !keysByLocale[locale].has(key));
      assert.deepEqual(missing, [], `${locale}.json is missing ${label} keys: ${missing.join(", ")}`);
      const extra = [...keysByLocale[locale]].filter((key) => !englishKeys.has(key));
      assert.deepEqual(extra, [], `${locale}.json has extra ${label} keys not in en.json: ${extra.join(", ")}`);
    }
  }
});
