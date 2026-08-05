import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const operatorPages = [
  "src/app/[locale]/operator/machines/page.tsx",
  "src/app/[locale]/operator/manuals/page.tsx",
  "src/app/[locale]/operator/smart-maintenance-calendar/page.tsx",
  "src/app/[locale]/operator/preventive/page.tsx",
  "src/app/[locale]/operator/corrective/page.tsx",
];

test("Operator pages use scoped machine-type endpoint instead of Admin-only generic endpoint", () => {
  for (const relativePath of operatorPages) {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

    assert.doesNotMatch(
      source,
      /apiService\.getMachineTypes\(/,
      `${relativePath} must not call /machine-types`,
    );
    assert.doesNotMatch(
      source,
      /api\.get\(["']\/machine-types["']/,
      `${relativePath} must not call /machine-types directly`,
    );
  }
});

test("Corrective page submits through the single scoped Operator corrective-report endpoint only", () => {
  const relativePath = "src/app/[locale]/operator/corrective/page.tsx";
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

  assert.match(
    source,
    /apiService\.createOperatorCorrectiveReport\(/,
    `${relativePath} must submit through apiService.createOperatorCorrectiveReport`,
  );
  assert.doesNotMatch(
    source,
    /apiService\.createWorkOrder\(/,
    `${relativePath} must not call the Admin-only /work-orders endpoint directly`,
  );
  assert.doesNotMatch(
    source,
    /apiService\.createInterventionReport\(/,
    `${relativePath} must not call the Admin-only /intervention-reports endpoint directly`,
  );
  assert.doesNotMatch(
    source,
    /technician_id\s*:\s*user\??\.\s*_id/,
    `${relativePath} must not send a client-supplied technician/author id`,
  );
});

test("Operator UI no longer routes to the removed report-problem page", () => {
  for (const relativePath of [
    "src/components/DashboardLayout.tsx",
    "src/app/[locale]/operator/smart-maintenance-calendar/page.tsx",
    "src/app/[locale]/operator/page.tsx",
    "src/app/[locale]/operator/machines/page.tsx",
  ]) {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
    assert.doesNotMatch(source, /\/operator\/report-problem/, `${relativePath} must route to /operator/corrective instead`);
  }
});

test("apiService exposes the scoped Operator corrective-report endpoint with no identity field in its payload type", () => {
  const relativePath = "src/services/api.ts";
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

  const match = source.match(
    /createOperatorCorrectiveReport:\s*\(data:\s*\{([^}]*)\}\)\s*=>\s*api\.post\(["']\/operator\/report-problem["']/,
  );
  assert.ok(match, "createOperatorCorrectiveReport must post to /operator/report-problem");

  const payloadShape = match[1];
  assert.doesNotMatch(
    payloadShape,
    /technician_id|operator_id|author/i,
    "createOperatorCorrectiveReport payload must not declare an identity field; identity is derived server-side from the authenticated request",
  );
});

test("Preventive page submits through the single scoped Operator preventive-submission endpoint only", () => {
  // The submission call now lives in usePreventiveSubmission.ts (the page
  // was decomposed into hooks/components) — the positive assertion targets
  // that hook directly; the negative "never calls X" assertions scan the
  // whole feature directory so a forbidden call couldn't hide in any
  // extracted file either.
  const relativePath = "src/app/[locale]/operator/preventive/hooks/usePreventiveSubmission.ts";
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
  const featureDir = path.join(process.cwd(), "src/app/[locale]/operator/preventive");
  const featureFiles = fs.readdirSync(featureDir, { recursive: true }) as string[];
  const featureSource = featureFiles
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => fs.readFileSync(path.join(featureDir, file), "utf8"))
    .join("\n---\n");

  assert.match(
    source,
    /apiService\.submitOperatorPreventiveMaintenance\(/,
    `${relativePath} must submit through apiService.submitOperatorPreventiveMaintenance`,
  );
  assert.doesNotMatch(
    featureSource,
    /apiService\.createWorkOrder\(/,
    "the operator preventive feature must not call the Admin-only /work-orders endpoint directly",
  );
  assert.doesNotMatch(
    featureSource,
    /apiService\.createInterventionReport\(/,
    "the operator preventive feature must not call the Admin-only /intervention-reports endpoint directly",
  );
  assert.doesNotMatch(
    featureSource,
    /apiService\.createLubrificationLog\(/,
    "the operator preventive feature must not call the Admin-only /lubrification-logs endpoint directly",
  );
  assert.doesNotMatch(
    featureSource,
    /technician_id\s*:\s*user\??\.\s*_id/,
    "the operator preventive feature must not send a client-supplied technician/author id",
  );
});

test("apiService exposes the scoped Operator preventive-submission endpoint with no identity/status/execution field in its payload type", () => {
  const relativePath = "src/services/api.ts";
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

  const match = source.match(
    /submitOperatorPreventiveMaintenance:\s*\(data:\s*([\s\S]*?)\)\s*=>\s*api\.post\(["']\/operator\/preventive\/submit["']/,
  );
  assert.ok(
    match,
    "submitOperatorPreventiveMaintenance must post to /operator/preventive/submit",
  );

  const payloadShape = match[1];
  assert.doesNotMatch(
    payloadShape,
    /technician_id|operator_id|author|status|execution_date|date_start|date_debut|date_fin/i,
    "submitOperatorPreventiveMaintenance payload must not declare an identity, status, or execution-date field; those are derived server-side from the authenticated request",
  );
});

test("Corrective page submits through the scoped Operator corrective-report endpoint only", () => {
  const relativePath = "src/app/[locale]/operator/corrective/page.tsx";
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

  assert.match(
    source,
    /apiService\.createOperatorCorrectiveReport\(/,
    `${relativePath} must create corrective reports through apiService.createOperatorCorrectiveReport`,
  );
  assert.doesNotMatch(
    source,
    /apiService\.createWorkOrder\(/,
    `${relativePath} must not create corrective work orders through the Admin-only endpoint`,
  );
  assert.doesNotMatch(
    source,
    /apiService\.createInterventionReport\(/,
    `${relativePath} must not create intervention reports through the Admin-only endpoint`,
  );
  assert.doesNotMatch(
    source,
    /apiService\.createOtPiece\(/,
    `${relativePath} must not call the Admin-only /ot-pieces endpoint directly for part requests`,
  );
  assert.doesNotMatch(
    source,
    /requested_by\s*:\s*user\??\.\s*_id/,
    `${relativePath} must not send a client-supplied requester id for a part request`,
  );
});

test("Smart maintenance calendar page uses only Operator-scoped calendar endpoints, never the Admin-only /work-orders/calendar/* routes", () => {
  const relativePath =
    "src/app/[locale]/operator/smart-maintenance-calendar/page.tsx";
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

  const requiredScopedCalls = [
    "apiService.getMyCalendarEvents(",
    "apiService.getMyCalendarEventDetails(",
    "apiService.startMyCalendarEvent(",
    "apiService.completeMyCalendarEvent(",
  ];
  for (const call of requiredScopedCalls) {
    assert.ok(
      source.includes(call),
      `${relativePath} must call ${call} to stay scoped to the authenticated Operator`,
    );
  }

  const forbiddenAdminCalls = [
    "apiService.getCalendarEvents(",
    "apiService.getCalendarTimeline(",
    "apiService.getCalendarWidget(",
    "apiService.getCalendarNotifications(",
    "apiService.getCalendarEventDetails(",
    "apiService.updateWorkOrder(",
    "apiService.completeWorkOrder(",
    "apiService.createWorkOrder(",
  ];
  for (const call of forbiddenAdminCalls) {
    assert.doesNotMatch(
      source,
      new RegExp(call.replace(/[.()]/g, "\\$&")),
      `${relativePath} must not call the Admin-only ${call}`,
    );
  }
});

test("Smart maintenance calendar opts into operator dark-mode theme mapping", () => {
  const relativePath =
    "src/app/[locale]/operator/smart-maintenance-calendar/page.tsx";
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
  const globalsSource = fs.readFileSync(
    path.join(process.cwd(), "src/app/globals.css"),
    "utf8",
  );

  assert.match(source, /operator-dashboard-theme bento-grid/);
  assert.match(source, /operator-dashboard-theme ml-auto/);
  assert.match(globalsSource, /\.operator-dashboard-theme input\.bg-white/);
  assert.match(
    globalsSource,
    /\[data-theme='dark'\] \.operator-dashboard-theme \.bg-slate-900\\\/30/,
  );
  assert.match(
    globalsSource,
    /\[data-theme='dark'\] \.operator-dashboard-theme \.text-emerald-800/,
  );
});

test("Smart maintenance calendar is organized around the operator's next task action", () => {
  const relativePath =
    "src/app/[locale]/operator/smart-maintenance-calendar/page.tsx";
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

  assert.match(source, /type CalendarView = "day" \| "week" \| "month"/);
  assert.match(source, /data-testid="smart-calendar-action-sections"/);
  assert.match(source, /smart-calendar-section-\$\{section\.key\}/);
  assert.match(source, /key: "due-today"/);
  assert.match(source, /key: "upcoming"/);
  assert.match(source, /key: "waiting-validation"/);
  assert.match(source, /data-testid=\{`smart-calendar-primary-action-\$\{section\.key\}-\$\{index\}`\}/);
  assert.match(source, /void quickStartEvent\(event\)/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /data-testid="smart-calendar-advanced-filters-toggle"/);
  assert.match(source, /data-testid="smart-calendar-advanced-filters"/);

  assert.doesNotMatch(source, /dashboardWidget/);
  assert.doesNotMatch(source, /notificationCenter/);
  assert.doesNotMatch(source, /yearView/);
  assert.doesNotMatch(source, /timelineView/);
});

// The "Preventive page reschedules through the single scoped Operator
// calendar endpoint only" test that used to live here was removed during
// the page's decomposition. Investigation found `rescheduleOccurrence` /
// `setRescheduleOccurrence` were only ever assigned `null` — no reachable
// control in the UI ever opened that modal, so the reschedule handler and
// its call to `apiService.rescheduleMyCalendarEvent` were unreachable dead
// code and have been deleted along with the modal. The endpoint itself
// isn't orphaned: `rescheduleMyCalendarEvent`'s route/shape is still
// covered independently by the "apiService exposes the scoped Operator
// calendar endpoints..." test in list-pages-migration-logic.test.ts, which
// asserts against src/services/api.ts directly rather than against a caller.
test("the operator preventive feature has no unreachable schedule/reschedule modal state left behind", () => {
  const featureDir = path.join(process.cwd(), "src/app/[locale]/operator/preventive");
  const featureFiles = fs.readdirSync(featureDir, { recursive: true }) as string[];
  const featureSource = featureFiles
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => fs.readFileSync(path.join(featureDir, file), "utf8"))
    .join("\n---\n");

  for (const removedIdentifier of [
    "schedulePlan",
    "setSchedulePlan",
    "rescheduleOccurrence",
    "setRescheduleOccurrence",
    "createFirstSchedule",
    "rescheduleSelectedOccurrence",
    "ScheduleFirstInterventionModal",
    "RescheduleOccurrenceModal",
  ]) {
    assert.doesNotMatch(
      featureSource,
      new RegExp(removedIdentifier),
      `the operator preventive feature must not reference the removed dead schedule/reschedule identifier: ${removedIdentifier}`,
    );
  }
});

test("apiService exposes the scoped Operator calendar endpoints pointing at /operator/calendar/*, not /work-orders/calendar/*", () => {
  const relativePath = "src/services/api.ts";
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

  const expectations: Array<[RegExp, string]> = [
    [/getMyCalendarWidget:\s*\(\)\s*=>\s*api\.get\(["']\/operator\/calendar\/widget["']\)/, "getMyCalendarWidget"],
    [
      /getMyCalendarNotifications:\s*\(\)\s*=>\s*api\.get\(["']\/operator\/calendar\/notifications["']\)/,
      "getMyCalendarNotifications",
    ],
    [
      /getMyCalendarTimeline:\s*\([^)]*\)\s*=>\s*api\.get\(["']\/operator\/calendar\/timeline["']/,
      "getMyCalendarTimeline",
    ],
    [
      /getMyCalendarEventDetails:\s*\(id:\s*string\)\s*=>\s*api\.get\(`\/operator\/calendar\/events\/\$\{id\}`\)/,
      "getMyCalendarEventDetails",
    ],
    [
      /startMyCalendarEvent:\s*\(id:\s*string\)\s*=>\s*api\.post\(`\/operator\/calendar\/events\/\$\{id\}\/start`\)/,
      "startMyCalendarEvent",
    ],
    [
      /completeMyCalendarEvent:\s*\(id:\s*string\)\s*=>\s*api\.post\(`\/operator\/calendar\/events\/\$\{id\}\/complete`\)/,
      "completeMyCalendarEvent",
    ],
    [
      /rescheduleMyCalendarEvent:\s*\(id:\s*string,\s*data:[^)]*\)\s*=>\s*api\.patch\(`\/operator\/calendar\/events\/\$\{id\}\/reschedule`/,
      "rescheduleMyCalendarEvent",
    ],
  ];

  for (const [pattern, name] of expectations) {
    assert.match(source, pattern, `apiService.${name} must post/get the scoped /operator/calendar/* route`);
  }
});

test("apiService exposes the scoped Operator parts-request endpoint with no requester/status/stock/approval field in its payload type", () => {
  const relativePath = "src/services/api.ts";
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

  const match = source.match(
    /requestOperatorParts:\s*\(workOrderId:\s*string,\s*data:\s*([\s\S]*?)\)\s*=>\s*api\.post\(\s*`\/operator\/work-orders\/\$\{workOrderId\}\/parts-request`/,
  );
  assert.ok(
    match,
    "requestOperatorParts must post to /operator/work-orders/:id/parts-request",
  );

  const payloadShape = match[1];
  assert.doesNotMatch(
    payloadShape,
    /requested_by|operator_id|author|status|quantite_en_stock|stock|approved/i,
    "requestOperatorParts payload must not declare a requester, status, stock, or approval field; those are derived/owned server-side",
  );
});

test("Operator My Reports list hides internal identifiers and long descriptions from the scan view", () => {
  const relativePath = "src/app/[locale]/operator/my-reports/page.tsx";
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
  const listMarkup = source.slice(
    source.indexOf('<section className="col-span-full panel">'),
    source.indexOf("<Modal"),
  );

  assert.match(listMarkup, /machineLabel\(workOrder\)/);
  assert.match(listMarkup, /maintenanceTypeLabel\(workOrder\)/);
  assert.match(listMarkup, /submittedAt\(report,\s*workOrder\)/);
  assert.match(listMarkup, /statusLabel\(workOrder\?\.status \|\| report\.validation_responsable\)/);
  assert.match(listMarkup, /data-testid=\{`my-report-card-\$\{index\}`\}/);

  for (const hiddenPattern of [
    /report\.report_id/,
    /workOrder\?\.ot_id/,
    /report\.description_action/,
    /my-reports-create-draft/,
    /my-report-delete/,
    /my-report-draft/,
    /PencilSquareIcon/,
    /TrashIcon/,
  ]) {
    assert.doesNotMatch(
      listMarkup,
      hiddenPattern,
      "operator report scan view must not expose IDs, descriptions, draft controls, or edit/delete actions",
    );
  }
});

test("Operator My Reports opts into operator dark-mode theme mapping", () => {
  const relativePath = "src/app/[locale]/operator/my-reports/page.tsx";
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
  const globalsSource = fs.readFileSync(
    path.join(process.cwd(), "src/app/globals.css"),
    "utf8",
  );

  assert.match(source, /operator-dashboard-theme/);
  assert.match(source, /operator-dashboard-theme space-y-5/);
  assert.match(globalsSource, /\.operator-dashboard-theme \.bg-green-100/);
  assert.match(
    globalsSource,
    /\[data-theme='dark'\] \.operator-dashboard-theme \.text-green-800/,
  );
  assert.match(
    globalsSource,
    /\[data-theme='dark'\] \.operator-dashboard-theme \.text-amber-800/,
  );
});

test("Operator Manuals opts into operator dark-mode theme mapping", () => {
  const relativePath = "src/app/[locale]/operator/manuals/page.tsx";
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
  const globalsSource = fs.readFileSync(
    path.join(process.cwd(), "src/app/globals.css"),
    "utf8",
  );

  assert.match(source, /operator-dashboard-theme bento-grid/);
  assert.match(source, /<div className="operator-dashboard-theme">\s*<DocumentAttachmentViewer/);
  assert.match(
    globalsSource,
    /\[data-theme='dark'\] \.operator-dashboard-theme \.to-blue-50/,
  );
  assert.match(
    globalsSource,
    /\[data-theme='dark'\] \.operator-dashboard-theme \.bg-emerald-50/,
  );
});

test("Operator Machines opts into operator dark-mode theme mapping", () => {
  const relativePath = "src/app/[locale]/operator/machines/page.tsx";
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
  const globalsSource = fs.readFileSync(
    path.join(process.cwd(), "src/app/globals.css"),
    "utf8",
  );

  assert.match(source, /operator-dashboard-theme bento-grid/);
  assert.match(source, /operator-dashboard-theme min-h-screen bg-white/);
  assert.match(globalsSource, /\.operator-dashboard-theme \.text-gray-900/);
  assert.match(globalsSource, /\.operator-dashboard-theme \.border-gray-100/);
  assert.match(
    globalsSource,
    /\[data-theme='dark'\] \.operator-dashboard-theme \.bg-yellow-100/,
  );
  assert.match(
    globalsSource,
    /\[data-theme='dark'\] \.operator-dashboard-theme \.text-yellow-700/,
  );
});

test("Operator maintenance forms opt into readable dark-mode text mapping", () => {
  const correctiveSource = fs.readFileSync(
    path.join(process.cwd(), "src/app/[locale]/operator/corrective/page.tsx"),
    "utf8",
  );
  const preventiveSource = fs.readFileSync(
    path.join(process.cwd(), "src/app/[locale]/operator/preventive/page.tsx"),
    "utf8",
  );
  // The preventive page's report-details dialog body (which carries the
  // "space-y-5" wrapper) was extracted into its own presentational component.
  const preventiveReportDetailsSource = fs.readFileSync(
    path.join(process.cwd(), "src/app/[locale]/operator/preventive/components/ReportDetailsContent.tsx"),
    "utf8",
  );
  const globalsSource = fs.readFileSync(
    path.join(process.cwd(), "src/app/globals.css"),
    "utf8",
  );

  assert.match(correctiveSource, /operator-dashboard-theme bento-grid/);
  assert.match(correctiveSource, /operator-dashboard-theme space-y-5/);
  assert.match(preventiveSource, /operator-dashboard-theme bento-grid/);
  assert.match(preventiveReportDetailsSource, /operator-dashboard-theme space-y-5/);
  assert.match(globalsSource, /\.operator-dashboard-theme \.text-black/);
  assert.match(globalsSource, /\.operator-dashboard-theme \.text-gray-900/);
  assert.match(globalsSource, /\.operator-dashboard-theme \.text-gray-600/);
  assert.match(globalsSource, /\.operator-dashboard-theme \.bg-gray-100/);
  assert.match(
    globalsSource,
    /\[data-theme='dark'\] \.operator-dashboard-theme \.text-blue-600/,
  );
  assert.match(
    globalsSource,
    /\[data-theme='dark'\] \.operator-dashboard-theme \.text-emerald-950/,
  );
});

test("Corrective page shows the same clean inline maintenance report history as preventive", () => {
  const relativePath = "src/app/[locale]/operator/corrective/page.tsx";
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
  const reportSection = source.slice(
    source.indexOf("const backendCorrectiveReports = useMemo"),
    source.indexOf("export default function OperatorCorrectivePage"),
  );

  assert.match(source, /const newReport: GeneratedReportRow = \{/);
  assert.match(source, /addGeneratedReport\(newReport\)/);
  assert.match(source, /apiService\.getMyInterventionReports\(/);
  assert.match(source, /apiService\.getMyWorkOrders\(/);
  assert.match(source, /apiService\.getDocuments\(/);
  assert.match(source, /setReportPhotoDocuments\(/);
  assert.match(source, /formData\.append\("work_order_id",\s*workOrderId\)/);
  assert.match(source, /formData\.append\("intervention_report_id",\s*reportId\)/);
  assert.match(source, /const photoDocument = await uploadPhotoIfPresent/);
  assert.match(reportSection, /isCorrectiveMaintenanceType\(workOrder\.type_maintenance\)/);
  assert.match(reportSection, /const backendCorrectiveReports = useMemo/);
  assert.match(reportSection, /type: "corrective"/);
  assert.match(reportSection, /photoDocument/);
  assert.match(reportSection, /correctiveGeneratedReports\.map/);
  assert.match(source, /setHighlightedReportId\(newReport\.id\)/);
  assert.match(reportSection, /correctiveReportElementId\(highlightedReportId\)/);
  assert.match(reportSection, /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
  assert.match(reportSection, /highlightedReportId === item\.id/);
  assert.match(reportSection, /data-testid=\{`corrective-report-card-\$\{index\}`\}/);
  assert.match(reportSection, /data-testid=\{`corrective-report-details-\$\{index\}`\}/);
  assert.match(reportSection, /setSelectedGeneratedReport\(item\)/);
  assert.match(reportSection, /title=\{t\("smartCalendar\.maintenanceDetails"\)\}/);
  assert.match(reportSection, /<DocumentAttachmentViewer/);

  const visibleReportMarkup = reportSection.slice(
    reportSection.indexOf('<div className="card-title mb-3">{t("myReports")}</div>'),
    reportSection.indexOf("export default function OperatorCorrectivePage"),
  );
  for (const hiddenPattern of [
    /Report ID/i,
    /Work Order ID/i,
    /MongoDB/i,
    /item\.workOrderId/,
    /item\.reportId/,
  ]) {
    assert.doesNotMatch(
      visibleReportMarkup,
      hiddenPattern,
      "corrective inline report history must not expose internal identifiers in the operator scan/detail UI",
    );
  }
});
