import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const operatorPages = [
  "src/app/[locale]/operator/machines/page.tsx",
  "src/app/[locale]/operator/manuals/page.tsx",
  "src/app/[locale]/operator/report-problem/page.tsx",
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

test("Report Problem page submits through the single scoped Operator corrective-report endpoint only", () => {
  const relativePath = "src/app/[locale]/operator/report-problem/page.tsx";
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

test("Corrective page requests spare parts through the single scoped Operator parts-request endpoint only", () => {
  const relativePath = "src/app/[locale]/operator/corrective/page.tsx";
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

  assert.match(
    source,
    /apiService\.requestOperatorParts\(/,
    `${relativePath} must request parts through apiService.requestOperatorParts`,
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
    "apiService.getMyCalendarTimeline(",
    "apiService.getMyCalendarWidget(",
    "apiService.getMyCalendarNotifications(",
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
