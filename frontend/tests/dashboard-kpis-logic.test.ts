import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("apiService exposes the role-scoped KPI dashboard endpoints", () => {
  const source = readSource("src/services/api.ts");

  assert.match(
    source,
    /getAdminDashboard:\s*\(\)\s*=>\s*api\.get\('\/dashboard\/admin'\)/,
    "apiService.getAdminDashboard must GET /dashboard/admin",
  );
  assert.match(
    source,
    /getOperatorDashboard:\s*\(\)\s*=>\s*api\.get\('\/operator\/dashboard'\)/,
    "apiService.getOperatorDashboard must GET /operator/dashboard",
  );
});

test("useDashboardStatistics only fetches the admin dashboard for admin users", () => {
  const source = readSource("src/hooks/useDashboardStatistics.ts");

  assert.match(
    source,
    /const isAdmin = user\?\.role === 'admin'/,
    "the hook must gate on the admin role",
  );
  assert.match(
    source,
    /if \(!user \|\| !isAdmin\) \{\s*setStatistics\(null\);\s*setLoading\(false\);\s*return;\s*\}/,
    "the hook must skip fetching (and clear statistics) entirely for non-admin users",
  );
  assert.match(
    source,
    /apiService\.getAdminDashboard\(\)/,
    "the hook must source every admin KPI from apiService.getAdminDashboard",
  );
  assert.doesNotMatch(
    source,
    /getDashboardData|getMachinesTotal|getUsersTotal/,
    "the hook must not fall back to legacy paginated/aggregate endpoints",
  );
});

test("Dashboard.tsx derives every KPI card from the shared statistics hook, not client-side counting", () => {
  const source = readSource("src/app/Dashboard.tsx");

  assert.match(
    source,
    /const \{ statistics \} = useDashboardStatistics\(\);/,
    "Dashboard.tsx must consume useDashboardStatistics as its statistics source",
  );

  for (const field of [
    "statistics\\?\\.totals\\.machines",
    "statistics\\?\\.totals\\.users",
    "workOrders\\?\\.overdueCount",
    "workOrders\\?\\.dueTodayCount",
    "workOrders\\?\\.waitingValidationCount",
    "workOrders\\?\\.completedTodayCount",
    "statistics\\?\\.mttrMtbf\\.availabilityPercent",
    "statistics\\?\\.preventiveCompliance\\.ratePercent",
    "statistics\\?\\.stockAlerts\\.count",
    "statistics\\?\\.correctiveResponseTime\\.averageResponseHours",
    "statistics\\?\\.mttrMtbf\\.mttrHours",
    "statistics\\?\\.mttrMtbf\\.mtbfHours",
  ]) {
    assert.match(
      source,
      new RegExp(field),
      `Dashboard.tsx must read ${field} from the KPI statistics object`,
    );
  }

  assert.doesNotMatch(
    source,
    /getDashboardData|getMachinesTotal|getUsersTotal/,
    "Dashboard.tsx must not call the legacy dashboard-data/aggregate endpoints",
  );

  assert.match(
    source,
    /apiService\.getWorkOrders\(\{ page: 1, limit: 5 \}\)/,
    "the only work-order fetch left in Dashboard.tsx must be a small, explicitly-non-counting display list",
  );
});

test("Dashboard.tsx conditionally renders stock-alert and workload panels sourced from the KPI statistics", () => {
  const source = readSource("src/app/Dashboard.tsx");

  assert.match(
    source,
    /\{statistics && statistics\.stockAlerts\.count > 0 && \(/,
    "the stock-alerts panel must only render when there are alerts",
  );
  assert.match(
    source,
    /statistics\.stockAlerts\.items\.slice\(0, 5\)\.map/,
    "the stock-alerts panel must list items from statistics.stockAlerts.items",
  );
  assert.match(
    source,
    /\{statistics && statistics\.workload\.length > 0 && \(/,
    "the workload panel must only render when there is workload data",
  );
  assert.match(
    source,
    /statistics\.workload\.slice\(0, 6\)\.map/,
    "the workload panel must list entries from statistics.workload",
  );
});

test("DashboardLayout only shows the admin-only KPI topbar badges to admins", () => {
  const source = readSource("src/components/DashboardLayout.tsx");

  assert.match(
    source,
    /\{activeRole === 'admin' && \(/,
    "DashboardLayout must gate the pendingMaintenance/percentageChange badges behind an admin role check",
  );
});

test("DashboardLayout waits for restored auth before rendering role-specific shell", () => {
  const source = readSource("src/components/DashboardLayout.tsx");

  assert.match(
    source,
    /const \{ user, logout, isLoading: authLoading, isAuthenticated \} = useAuth\(\);/,
    "DashboardLayout must read the auth loading state directly",
  );
  assert.match(
    source,
    /if \(authLoading \|\| !isAuthenticated \|\| !user\) \{/,
    "DashboardLayout must not render the sidebar/header profile while refresh auth is still restoring",
  );
  assert.doesNotMatch(
    source,
    /user\?\.role \?\? ['"]operator['"]/,
    "DashboardLayout must not default to an operator shell before the backend returns the real refreshed user",
  );
  assert.doesNotMatch(
    source,
    /user\?\.role \? tUsers\(`roles\.\$\{user\.role\}`\)\s*:\s*tCommon\('user'\)/,
    "DashboardLayout must not show the generic User role while auth is still loading",
  );
});

test("operator page sources its KPI counters from GET /operator/dashboard, not client-side recomputation", () => {
  const source = readSource("src/app/[locale]/operator/page.tsx");

  assert.match(
    source,
    /interface OperatorKpiCounts \{\s*overdueCount: number;\s*dueTodayCount: number;\s*waitingValidationCount: number;\s*completedTodayCount: number;\s*\}/,
    "the operator page must define a typed shape for the KPI counters",
  );
  assert.match(
    source,
    /apiService\.getOperatorDashboard\(\)/,
    "the operator page must fetch apiService.getOperatorDashboard alongside its list data",
  );
  assert.match(
    source,
    /setKpiCounts\(\{\s*overdueCount: dashboard\.overdueCount,\s*dueTodayCount: dashboard\.dueTodayCount,\s*waitingValidationCount: dashboard\.waitingValidationCount,\s*completedTodayCount: dashboard\.completedTodayCount,\s*\}\);/,
    "the operator page must store every KPI counter directly from the dashboard response",
  );
  assert.match(
    source,
    /setStats\(\{\s*assigned: dashboard\.assignedCount,\s*inProgress: dashboard\.inProgressCount,\s*completed: dashboard\.completedCount,\s*\}\);/,
    "the operator page's assigned/inProgress/completed stats must come from the dashboard response, not a client-side filter over the fetched work-order list",
  );
  assert.match(
    source,
    /const overdueTasksCount = kpiCounts\.overdueCount;/,
    "overdueTasksCount must read the server-computed, business-timezone-aware overdue count rather than filtering a browser-local-time calendar list",
  );
});

test("operator page's analytics cards include a due-today KPI and a genuine completed-today KPI", () => {
  const source = readSource("src/app/[locale]/operator/page.tsx");

  assert.match(
    source,
    /label: tOperator\("stats\.dueToday"\), value: kpiCounts\.dueTodayCount/,
    "the operator page must show a due-today card sourced from kpiCounts.dueTodayCount",
  );
  assert.match(
    source,
    /label: tOperator\("stats\.completedToday"\), value: kpiCounts\.completedTodayCount/,
    "the operator page's completed-today card must use kpiCounts.completedTodayCount (today only), not an all-time completed count",
  );
});

test("all supported locales define the new admin and operator dashboard KPI translation keys", () => {
  const locales = ["en", "fr", "ar", "es", "de", "it"];

  const requiredAdminKeys = [
    "stats.fleetTotal",
    "stats.totalUsers",
    "stats.openMaintenance",
    "stats.openMaintenanceHint",
    "stats.completedToday",
    "stats.outOfTotal",
    "workOrders.overdue",
    "workOrders.dueToday",
    "workOrders.waitingValidation",
    "workOrders.completedTodayLabel",
    "workOrders.completionRateHint",
    "machines.availabilityHint",
    "quickKpis.stockAlerts",
    "quickKpis.correctiveResponseTime",
    "quickKpis.mttr",
    "quickKpis.mtbf",
    "quickKpis.hoursValue",
    "stockAlerts.title",
    "stockAlerts.availableOf",
    "workload.title",
    "workload.openCount",
  ];

  for (const locale of locales) {
    const messagesPath = path.join(process.cwd(), "messages", `${locale}.json`);
    const messages = JSON.parse(fs.readFileSync(messagesPath, "utf8"));
    const admin = messages.dashboard?.admin;
    assert.ok(admin, `${locale}.json must have a dashboard.admin namespace`);

    for (const dottedKey of requiredAdminKeys) {
      const value = dottedKey.split(".").reduce<unknown>((acc, part) => {
        return acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined;
      }, admin);
      assert.ok(
        typeof value === "string" && value.length > 0,
        `${locale}.json dashboard.admin.${dottedKey} must be a non-empty string`,
      );
    }

    assert.match(
      admin.stats.openMaintenanceHint,
      /\{overdue\}/,
      `${locale}.json dashboard.admin.stats.openMaintenanceHint must interpolate {overdue}`,
    );
    assert.match(
      admin.stats.openMaintenanceHint,
      /\{dueToday\}/,
      `${locale}.json dashboard.admin.stats.openMaintenanceHint must interpolate {dueToday}`,
    );
    assert.match(
      admin.stats.outOfTotal,
      /\{total\}/,
      `${locale}.json dashboard.admin.stats.outOfTotal must interpolate {total}`,
    );
    assert.match(
      admin.quickKpis.hoursValue,
      /\{hours\}/,
      `${locale}.json dashboard.admin.quickKpis.hoursValue must interpolate {hours}`,
    );
    assert.match(
      admin.stockAlerts.availableOf,
      /\{available\}/,
      `${locale}.json dashboard.admin.stockAlerts.availableOf must interpolate {available}`,
    );
    assert.match(
      admin.stockAlerts.availableOf,
      /\{threshold\}/,
      `${locale}.json dashboard.admin.stockAlerts.availableOf must interpolate {threshold}`,
    );
    assert.match(
      admin.workload.openCount,
      /\{count\}/,
      `${locale}.json dashboard.admin.workload.openCount must interpolate {count}`,
    );

    const operatorStats = messages.dashboard?.operator?.stats;
    assert.ok(operatorStats, `${locale}.json must have a dashboard.operator.stats namespace`);
    assert.ok(
      typeof operatorStats.dueToday === "string" && operatorStats.dueToday.length > 0,
      `${locale}.json dashboard.operator.stats.dueToday must be a non-empty string`,
    );
  }
});
