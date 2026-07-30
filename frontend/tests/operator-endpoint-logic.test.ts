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
  const relativePath = "src/app/[locale]/operator/preventive/page.tsx";
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

  assert.match(
    source,
    /apiService\.submitOperatorPreventiveMaintenance\(/,
    `${relativePath} must submit through apiService.submitOperatorPreventiveMaintenance`,
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
    /apiService\.createLubrificationLog\(/,
    `${relativePath} must not call the Admin-only /lubrification-logs endpoint directly`,
  );
  assert.doesNotMatch(
    source,
    /technician_id\s*:\s*user\??\.\s*_id/,
    `${relativePath} must not send a client-supplied technician/author id`,
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

test("Preventive page reschedules through the single scoped Operator calendar endpoint only", () => {
  const relativePath = "src/app/[locale]/operator/preventive/page.tsx";
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

  assert.match(
    source,
    /apiService\.rescheduleMyCalendarEvent\(/,
    `${relativePath} must reschedule through apiService.rescheduleMyCalendarEvent`,
  );
  assert.doesNotMatch(
    source,
    /apiService\.rescheduleWorkOrder\(/,
    `${relativePath} must not call the Admin-only /work-orders/:id/reschedule endpoint directly`,
  );
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
