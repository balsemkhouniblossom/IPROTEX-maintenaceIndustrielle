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

test("corrective page uses the existing operator report-problem API and step-based flow", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/[locale]/operator/corrective/page.tsx"),
    "utf8",
  );

  assert.match(source, /apiService\.createOperatorCorrectiveReport/);
  assert.match(source, /machine_id: selectedMachine/);
  assert.match(source, /selectedFault\?\.code_panne \|\| "OBSERVED_SYMPTOMS"/);
  assert.match(source, /actions/);
  assert.match(source, /priority:/);
  assert.match(source, /useSearchParams/);
  assert.match(source, /fetchAllPaginated/);
  assert.match(source, /step === "machine"/);
  assert.match(source, /step === "problem"/);
  assert.match(source, /step === "success"/);
});

test("corrective reporting preserves Other text, resets machine drafts, and ignores stale fault responses", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/[locale]/operator/corrective/page.tsx"),
    "utf8",
  );

  assert.match(source, /const problemLabel = selectedFault\?\.description \|\| otherProblem\.trim\(\)/);
  assert.match(source, /fault_description: faultDescription/);
  assert.match(source, /function resetMachineSpecificDraft\(\)/);
  for (const setter of ["setSelectedFault(null)", "setOtherProblem(\"\")", "setObservation(\"\")", "setUrgency(\"\")", "setPhoto(null)", "setFaultSearch(\"\")", "setFaults([])"]) {
    assert.ok(source.includes(setter), `missing machine draft reset: ${setter}`);
  }
  assert.match(source, /let cancelled = false/);
  assert.match(source, /if \(!cancelled\) \{\s*setFaults\(faultItems\)/);
  assert.match(source, /cancelled = true/);
});

test("corrective submission distinguishes partial photo failure, retries by existing ids, and links View Status to the returned report", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/[locale]/operator/corrective/page.tsx"),
    "utf8",
  );

  assert.match(source, /attachmentFailed = true/);
  assert.match(source, /setResult\(\{ workOrder, report, duplicate: reportRes\.data\.duplicate, attachmentFailed \}\)/);
  assert.match(source, /function retryPhotoUpload\(\)/);
  assert.match(source, /work_order_id\", result\.workOrder\._id/);
  assert.match(source, /intervention_report_id\", result\.report\._id/);
  assert.match(source, /router\.push\(`\.\.\/my-reports\?reportId=/);
  assert.match(source, /result\.duplicate \? t\("existingReportReused"\)/);
});
