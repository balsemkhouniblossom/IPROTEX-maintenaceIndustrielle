import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  CORRECTIVE_REQUIRED_FIELDS,
  deriveCorrectiveReportActions,
  validateCorrectiveWorkflow,
} from "../src/services/correctiveMaintenanceWorkflow.ts";

test("corrective workflow starts at 0% with all required fields missing", () => {
  const result = validateCorrectiveWorkflow({});

  assert.equal(result.canSubmit, false);
  assert.equal(result.progress, 0);
  assert.deepEqual(result.missingFields, [
    CORRECTIVE_REQUIRED_FIELDS.machine,
    CORRECTIVE_REQUIRED_FIELDS.faultOrSymptoms,
    CORRECTIVE_REQUIRED_FIELDS.reportDetail,
  ]);
  assert.deepEqual(result.actions, []);
});

test("corrective workflow reports partial progress for machine and fault only", () => {
  const result = validateCorrectiveWorkflow({
    machineId: "machine-1",
    faultCode: "FAULT-1",
  });

  assert.equal(result.canSubmit, false);
  assert.equal(result.progress, 67);
  assert.deepEqual(result.missingFields, [CORRECTIVE_REQUIRED_FIELDS.reportDetail]);
});

test("corrective workflow reaches 100% with a selected symptom and no optional photo", () => {
  const result = validateCorrectiveWorkflow({
    machineId: "machine-1",
    selectedSymptoms: ["Noise"],
  });

  assert.equal(result.canSubmit, true);
  assert.equal(result.progress, 100);
  assert.deepEqual(result.actions, ["Noise"]);
});

test("corrective workflow accepts a catalog fault without symptoms when a report detail exists", () => {
  const result = validateCorrectiveWorkflow({
    machineId: "machine-1",
    faultCode: "FAULT-1",
    comments: "Temporary reset done",
  });

  assert.equal(result.canSubmit, true);
  assert.equal(result.progress, 100);
});

test("corrective workflow reaches 100% with a checked recommended action", () => {
  const result = validateCorrectiveWorkflow({
    machineId: "machine-1",
    selectedActions: ["Reset breaker"],
    selectedSymptoms: ["Noise"],
    comments: "Observed at startup",
  });

  assert.equal(result.canSubmit, true);
  assert.equal(result.progress, 100);
  assert.deepEqual(result.actions, ["Reset breaker"]);
});

test("corrective workflow reaches 100% with comments only as the report detail", () => {
  const result = validateCorrectiveWorkflow({
    machineId: "machine-1",
    faultCode: "FAULT-1",
    comments: "Temporary reset done",
  });

  assert.equal(result.canSubmit, true);
  assert.equal(result.progress, 100);
  assert.deepEqual(result.actions, ["Temporary reset done"]);
});

test("corrective workflow still requires a fault or symptom even when the status is selected", () => {
  const result = validateCorrectiveWorkflow({
    machineId: "machine-1",
    resultLabel: "Solved",
  });

  assert.equal(result.canSubmit, false);
  assert.equal(result.progress, 67);
  assert.deepEqual(result.missingFields, [CORRECTIVE_REQUIRED_FIELDS.faultOrSymptoms]);
});

test("corrective workflow trims empty detail values exactly like the backend action validation", () => {
  const result = validateCorrectiveWorkflow({
    machineId: "machine-1",
    faultCode: "FAULT-1",
    selectedActions: ["   ", ""],
    selectedSymptoms: ["  "],
    comments: "   ",
    resultLabel: "   ",
  });

  assert.equal(result.canSubmit, false);
  assert.equal(result.progress, 67);
  assert.deepEqual(result.missingFields, [CORRECTIVE_REQUIRED_FIELDS.reportDetail]);
  assert.deepEqual(result.actions, []);
});

test("corrective workflow ignores hidden and optional fields when computing completion", () => {
  const withoutPhoto = validateCorrectiveWorkflow({
    machineId: "machine-1",
    selectedSymptoms: ["Alarm"],
    resultLabel: "Technician required",
  });
  const withPhoto = validateCorrectiveWorkflow({
    machineId: "machine-1",
    selectedSymptoms: ["Alarm"],
    resultLabel: "Technician required",
  });

  assert.deepEqual(withPhoto, withoutPhoto);
  assert.equal(withPhoto.progress, 100);
});

test("deriveCorrectiveReportActions prefers explicit actions, then symptoms, then comments, then action status", () => {
  assert.deepEqual(
    deriveCorrectiveReportActions({
      selectedActions: ["Inspect wiring"],
      selectedSymptoms: ["Alarm"],
      comments: "Comment",
      resultLabel: "Solved",
    }),
    ["Inspect wiring"],
  );
  assert.deepEqual(
    deriveCorrectiveReportActions({
      selectedSymptoms: ["Alarm"],
      comments: "Comment",
      resultLabel: "Solved",
    }),
    ["Alarm"],
  );
  assert.deepEqual(
    deriveCorrectiveReportActions({
      comments: "Comment",
      resultLabel: "Solved",
    }),
    ["Comment"],
  );
  assert.deepEqual(deriveCorrectiveReportActions({ resultLabel: "Solved" }), ["Solved"]);
});

test("corrective page derives progress, button state, hint, and submit payload from the same validation result", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/[locale]/operator/corrective/page.tsx"),
    "utf8",
  );

  assert.match(source, /const correctiveValidation = useMemo\(/);
  assert.match(source, /const reportActionLabels = correctiveValidation\.actions/);
  assert.match(source, /const canSubmitCorrective = correctiveValidation\.canSubmit && !submitting/);
  assert.match(source, /const correctiveProgress = correctiveValidation\.progress/);
  assert.match(source, /correctiveValidation\.missingFields/);
  assert.match(source, /code_panne: selectedFault\?\.code_panne \|\| "OBSERVED_SYMPTOMS"/);
  assert.match(source, /actions: reportActionLabels/);
});
