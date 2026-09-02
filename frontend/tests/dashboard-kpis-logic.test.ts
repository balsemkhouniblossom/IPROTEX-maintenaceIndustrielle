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
    /getAdminDashboard:\s*\(\)\s*=>\s*api\.get\(["']\/dashboard\/admin["']\)/,
    "apiService.getAdminDashboard must GET /dashboard/admin",
  );
  assert.match(
    source,
    /getOperatorDashboard:\s*\(\)\s*=>\s*api\.get\(["']\/operator\/dashboard["']\)/,
    "apiService.getOperatorDashboard must GET /operator/dashboard",
  );
});

test("technician work-order detail uses a state-based intervention workspace", () => {
  const source = readSource("src/components/technician/TechnicianWorkOrderDetail.tsx");

  for (const tab of [
    "detailTabs.overview",
    "detailTabs.intervention",
    "detailTabs.parts",
    "detailTabs.documents",
    "detailTabs.history",
  ]) {
    assert.match(source, new RegExp(tab), `detail page must expose ${tab}`);
  }

  assert.match(
    source,
    /setShowTechnicalAnalysis\(!showTechnicalAnalysis\)/,
    "technical AI/model output must stay behind an explicit View technical analysis action",
  );
  assert.match(
    source,
    /apiService\.updateTechnicianReport\(id, nextReport\)/,
    "completion must reuse the existing technician report update endpoint",
  );
  assert.match(
    source,
    /apiService\.closeTechnicianWorkOrder\(id\)/,
    "completion must reuse the existing technician close endpoint",
  );
  assert.match(
    readSource("src/services/api.ts"),
    /requestTechnicianPart:[\s\S]*\/technician\/work-orders\/\$\{id\}\/parts-request/,
    "technicians must request unavailable parts through a technician-scoped part-request endpoint",
  );
  assert.match(
    source,
    /apiService\.requestTechnicianPart\(id, \{ part_id: partId, quantity \}\)/,
    "the Request Part action must call the technician-scoped part request API",
  );
  assert.match(
    source,
    /apiService\.getTechnicianParts\([\s\S]*quiet\(\)/,
    "optional technician parts catalogue preload must not log a 403 or block opening work-order details",
  );
  assert.match(
    readSource("src/components/predictive-maintenance/MachineHealthPanel.tsx"),
    /getMachineHealthPredictions\(machineId, quiet\(\)\)/,
    "optional health predictions must be quiet when the technician cannot read that advisory endpoint",
  );
  assert.match(
    readSource("src/components/knowledge-base/KnowledgeSuggestions.tsx"),
    /getKnowledgeArticleSuggestions\([\s\S]*quiet\(\)\)/,
    "optional knowledge suggestions must be quiet when scoped suggestions are unavailable",
  );
  const technicianController = fs.readFileSync(
    path.join(process.cwd(), "..", "backend", "src", "technician", "technician.controller.ts"),
    "utf8",
  );
  const technicianService = fs.readFileSync(
    path.join(process.cwd(), "..", "backend", "src", "technician", "technician.service.ts"),
    "utf8",
  );
  assert.match(
    technicianController,
    /@Post\('work-orders\/:id\/parts-request'\)/,
    "backend must expose a technician-scoped part request route",
  );
  assert.match(
    technicianService,
    /this\.workOrdersService\.requestPartsForOperator\(/,
    "technician part requests must delegate to the existing PartRequest lifecycle service",
  );
  assert.doesNotMatch(
    source,
    /<select[^>]+status|name=["']status["']/,
    "technicians should not get a generic status dropdown on the intervention workspace",
  );
});

test("technician machines use a read-only maintenance workspace over shared machine detail", () => {
  const machinesPage = readSource("src/app/[locale]/machines/page.tsx");
  const detailPage = readSource("src/components/machine-timeline/MachineDetailPage.tsx");
  const api = readSource("src/services/api.ts");
  const technicianController = fs.readFileSync(
    path.join(process.cwd(), "..", "backend", "src", "technician", "technician.controller.ts"),
    "utf8",
  );
  const technicianService = fs.readFileSync(
    path.join(process.cwd(), "..", "backend", "src", "technician", "technician.service.ts"),
    "utf8",
  );

  assert.match(api, /getTechnicianMachines:[\s\S]*\/technician\/machines/);
  assert.match(api, /getTechnicianMachineContext:[\s\S]*\/technician\/machines\/\$\{id\}\/context/);
  assert.match(technicianController, /@Get\('machines'\)/);
  assert.match(technicianController, /@Get\('machines\/:id\/context'\)/);
  assert.match(
    technicianService,
    /listAccessibleMachineIds|assertCanAccessMachine/,
    "technician machine data must be scoped to machines the technician can see",
  );

  assert.match(machinesPage, /user\?\.role === "technician"/);
  assert.match(
    machinesPage,
    /if \(authLoading \|\| !user\?\.role\) return;/,
    "machines page must wait for the resolved role before choosing admin vs technician endpoints",
  );
  assert.match(machinesPage, /apiService\.getTechnicianMachines/);
  assert.match(machinesPage, /technicianSummary/);
  assert.match(machinesPage, /technicianFilter/);
  assert.match(machinesPage, /technician\.viewMachine/);
  assert.doesNotMatch(
    machinesPage,
    /apiService\.getMachineTimelineSummary/,
    "technician machines list must not call the shared timeline summary endpoint, which may be restricted",
  );

  const technicianBranch = machinesPage.match(
    /if \(user\?\.role === "technician"\) \{[\s\S]*?return \(\s*<ProtectedRoute requiredRole="technician">[\s\S]*?<\/ProtectedRoute>\s*\);\s*\}/,
  )?.[0] ?? "";
  assert.ok(technicianBranch.length > 0, "machines page must have a technician-only branch");
  assert.doesNotMatch(technicianBranch, /handleCreate|handleEdit|handleDelete|addMachine|PencilIcon|TrashIcon/);
  assert.doesNotMatch(
    technicianBranch,
    /getDocumentsByMachine|getMachineTypes|getMachines\(/,
    "technician list branch must not preload admin/manual data from restricted endpoints",
  );

  for (const tab of [
    "tabs.overview",
    "tabs.components",
    "tabs.maintenance",
    "tabs.monitoring",
    "tabs.documents",
    "tabs.history",
  ]) {
    assert.match(detailPage, new RegExp(tab), `shared machine detail must expose ${tab} for technicians`);
  }
  assert.match(detailPage, /user\?\.role === 'technician'/);
  assert.match(
    detailPage,
    /user\.role === 'technician'\) return;/,
    "technician machine detail must not call the shared timeline summary endpoint on page load",
  );
  assert.match(detailPage, /apiService[\s\S]*\.getTechnicianMachineContext\(machineId\)/);
  assert.match(detailPage, /buildTechnicianSummary/);
  assert.match(detailPage, /<MachineTimelineFeed machineId=\{machineId\} \/>/);
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

test("DashboardLayout localizes the compact Factory admin sidebar item", () => {
  const source = readSource("src/components/DashboardLayout.tsx");
  const locales = ["en", "fr", "ar", "es", "de", "it"];

  assert.match(source, /t\('navigation\.factory'\)/);
  assert.doesNotMatch(source, /name: 'Factory'/);

  for (const locale of locales) {
    const messagesPath = path.join(process.cwd(), "messages", `${locale}.json`);
    const messages = JSON.parse(fs.readFileSync(messagesPath, "utf8"));
    const label = messages.sidebar?.navigation?.factory;
    assert.equal(typeof label, "string", `${locale}.json sidebar.navigation.factory must be a string`);
    assert.ok(label.length > 0, `${locale}.json sidebar.navigation.factory must not be empty`);
  }
});

test("DashboardLayout gives technicians the compact role-specific sidebar", () => {
  const source = readSource("src/components/DashboardLayout.tsx");
  const technicianNav = source.match(
    /if \(activeRole === "technician"\) \{[\s\S]*?if \(activeRole === "operator"\)/,
  )?.[0] ?? "";
  const locales = ["en", "fr", "ar", "es", "de", "it"];

  assert.match(technicianNav, /domainKey: "domains\.overview"[\s\S]*name: t\("navigation\.dashboard"\)[\s\S]*href: "\/technician"/);
  assert.match(technicianNav, /domainKey: "domains\.myWork"[\s\S]*name: t\("navigation\.workOrders"\)[\s\S]*href: "\/technician\/work-orders"/);
  assert.match(technicianNav, /domainKey: "domains\.equipment"[\s\S]*name: t\("navigation\.machines"\)[\s\S]*href: "\/machines"/);
  assert.match(technicianNav, /domainKey: "domains\.resources"[\s\S]*name: t\("navigation\.parts"\)[\s\S]*href: "\/technician\/parts"[\s\S]*name: t\("navigation\.manuals"\)[\s\S]*href: "\/technician\/manuals"[\s\S]*name: t\("navigation\.knowledgeBase"\)[\s\S]*href: "\/technician\/knowledge-base"[\s\S]*name: t\("navigation\.aiAnomalyMonitoring"\)[\s\S]*href: "\/ai-anomaly"/);
  assert.match(technicianNav, /domainKey: "domains\.history"[\s\S]*name: t\("navigation\.completedWork"\)[\s\S]*href: "\/technician\/history"/);
  assert.doesNotMatch(technicianNav, /children:/);

  for (const locale of locales) {
    const messagesPath = path.join(process.cwd(), "messages", `${locale}.json`);
    const messages = JSON.parse(fs.readFileSync(messagesPath, "utf8"));
    for (const key of ["overview", "myWork", "equipment", "resources", "history"]) {
      const label = messages.sidebar?.domains?.[key];
      assert.equal(typeof label, "string", `${locale}.json sidebar.domains.${key} must be a string`);
      assert.ok(label.length > 0, `${locale}.json sidebar.domains.${key} must not be empty`);
    }
    for (const key of ["dashboard", "workOrders", "machines", "parts", "manuals", "knowledgeBase", "aiAnomalyMonitoring", "completedWork"]) {
      const label = messages.sidebar?.navigation?.[key];
      assert.equal(typeof label, "string", `${locale}.json sidebar.navigation.${key} must be a string`);
      assert.ok(label.length > 0, `${locale}.json sidebar.navigation.${key} must not be empty`);
    }
  }
});

test("Technician work orders expose one My Work Orders workspace without deleting legacy routes", () => {
  const workspace = readSource("src/components/technician/TechnicianWorkspace.tsx");
  const backend = fs.readFileSync(
    path.join(process.cwd(), "..", "backend", "src", "technician", "technician.service.ts"),
    "utf8",
  );
  const locales = ["en", "fr", "ar", "es", "de", "it"];

  assert.match(workspace, /const TECHNICIAN_WORK_ORDER_TABS: WorkOrderTab\[\] = \[/);
  assert.match(workspace, /key: "all"/);
  for (const status of ["assigned", "in_progress", "waiting_parts", "completed"]) {
    assert.match(workspace, new RegExp(`status: "${status}"`));
  }
  assert.doesNotMatch(workspace, /key: "review"/);
  assert.match(workspace, /role="tablist"/);
  assert.match(workspace, /role="tab"/);
  assert.match(workspace, /apiService\.getTechnicianWorkOrders\(\{\s*page: 1,\s*limit: 1,[\s\S]*status: tab\.status/);
  assert.match(workspace, /Number\(response\.data\?\.totalItems\) \|\| 0/);
  assert.match(workspace, /\{tabCounts\[tab\.key\]\}/);
  assert.doesNotMatch(workspace, /\{ key: "assigned", status: "assigned", count:/);
  assert.match(workspace, /placeholder=\{t\("filters\.searchPlaceholder"\)\}/);
  assert.match(workspace, /aria-label=\{t\("filters\.machine"\)\}/);
  assert.match(workspace, /aria-label=\{t\("filters\.dueDate"\)\}/);
  assert.match(workspace, /TechnicianWorkOrderCard/);
  assert.match(workspace, /isWorkOrderOverdue\(order\)/);
  assert.match(workspace, /actions\.viewPartsRequest/);
  assert.match(workspace, /actions\.continueIntervention/);
  assert.match(workspace, /actions\.viewReport/);
  assert.match(backend, /review:\s*REVIEW_STATUSES/);
  assert.match(backend, /search\?: string/);
  assert.match(backend, /query\.due_date = date/);
  assert.match(workspace, /export function TechnicianParts\(\)/);

  for (const route of [
    "src/app/[locale]/technician/interventions/page.tsx",
    "src/app/[locale]/technician/waiting-parts/page.tsx",
    "src/app/[locale]/technician/history/page.tsx",
    "src/app/[locale]/technician/parts/page.tsx",
  ]) {
    assert.ok(fs.existsSync(path.join(process.cwd(), route)), `${route} must exist`);
  }

  for (const locale of locales) {
    const messagesPath = path.join(process.cwd(), "messages", `${locale}.json`);
    const messages = JSON.parse(fs.readFileSync(messagesPath, "utf8"));
    for (const key of ["all", "assigned", "inProgress", "waitingParts", "completed"]) {
      const label = messages.technician?.workOrderTabs?.[key];
      assert.equal(typeof label, "string", `${locale}.json technician.workOrderTabs.${key} must be a string`);
      assert.ok(label.length > 0, `${locale}.json technician.workOrderTabs.${key} must not be empty`);
    }
  }
});

test("Technician dashboard sorts Today's Priority by priority then due urgency", () => {
  const workspace = readSource("src/components/technician/TechnicianWorkspace.tsx");

  assert.match(
    workspace,
    /function priorityRank\(order: WorkOrder\): number \{[\s\S]*if \(value === "urgent"\) return 0;[\s\S]*if \(value === "high"\) return 1;[\s\S]*if \(value === "medium"\) return 2;[\s\S]*return 3;/,
    "Today's Priority must rank Urgent, High, Medium, then Low/other",
  );
  assert.match(
    workspace,
    /function dueUrgencyRank\(order: WorkOrder\): number \{[\s\S]*if \(diffDays < 0\) return 0;[\s\S]*if \(diffDays === 0\) return 1;[\s\S]*return 2;/,
    "Today's Priority must rank overdue before due today before future due dates",
  );
  assert.match(
    workspace,
    /function compareTechnicianPriorityOrders\(left: WorkOrder, right: WorkOrder\): number \{[\s\S]*priorityRank\(left\) - priorityRank\(right\)[\s\S]*dueUrgencyRank\(left\) - dueUrgencyRank\(right\)[\s\S]*dueDateValue\(left\) - dueDateValue\(right\)/,
    "Today's Priority comparator must sort by priority, due urgency, then nearest due date",
  );
  assert.match(
    workspace,
    /\.sort\(compareTechnicianPriorityOrders\)[\s\S]*\.slice\(0, 3\)/,
    "Today's Priority list must use the explicit technician priority comparator",
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
    "title",
    "description",
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
