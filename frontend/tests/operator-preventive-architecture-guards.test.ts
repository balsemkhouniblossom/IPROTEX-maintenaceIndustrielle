import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const FEATURE_DIR = path.join(process.cwd(), "src/app/[locale]/operator/preventive");
const PAGE = path.join(FEATURE_DIR, "page.tsx");

function listFiles(dir: string, extensionPattern: RegExp): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFiles(fullPath, extensionPattern));
    } else if (extensionPattern.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

test("page.tsx no longer makes any direct API calls — every request lives in a hook", () => {
  const source = fs.readFileSync(PAGE, "utf8");
  assert.doesNotMatch(source, /apiService\./, "page.tsx must not call apiService directly; every request must live in a hook");
});

test("page.tsx does not touch localStorage — persistence lives in useGeneratedReports", () => {
  const source = fs.readFileSync(PAGE, "utf8");
  assert.doesNotMatch(source, /localStorage/, "page.tsx must not read/write localStorage directly");
});

test("page.tsx contains no checklist mutation loop — bulk-completion lives in usePreventiveChecklist", () => {
  const source = fs.readFileSync(PAGE, "utf8");
  assert.doesNotMatch(
    source,
    /updateOperatorPreventiveTaskChecklist/,
    "page.tsx must not call the checklist mutation endpoint directly",
  );
  assert.doesNotMatch(
    source,
    /Promise\.all/,
    "page.tsx must not run a bulk-mutation Promise.all loop itself — that belongs to usePreventiveChecklist.completeChecklistItems",
  );
});

test("the pure plan-grouping/validation utilities import no React and no next-intl", () => {
  const utilsFiles = listFiles(path.join(FEATURE_DIR, "utils"), /\.ts$/);
  assert.ok(utilsFiles.length > 0, "expected utility files to exist");
  for (const file of utilsFiles) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /from ["']react["']/, `${path.basename(file)} must stay framework-free (no React import)`);
    assert.doesNotMatch(source, /from ["']next-intl["']/, `${path.basename(file)} must stay framework-free (no next-intl import)`);
    assert.doesNotMatch(source, /apiService/, `${path.basename(file)} must stay pure (no API calls)`);
  }
});

test("presentational components never import apiService directly — they only receive data/callbacks as props", () => {
  const componentFiles = listFiles(path.join(FEATURE_DIR, "components"), /\.tsx$/);
  assert.ok(componentFiles.length > 0, "expected component files to exist");
  for (const file of componentFiles) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(
      source,
      /from ["']@\/services\/api["']/,
      `${path.basename(file)} must not import apiService — components render props, they don't fetch`,
    );
  }
});

test("usePreventiveSubmission is the sole caller of submitOperatorPreventiveMaintenance", () => {
  const allFiles = [
    PAGE,
    ...listFiles(path.join(FEATURE_DIR, "hooks"), /\.ts$/),
    ...listFiles(path.join(FEATURE_DIR, "components"), /\.tsx$/),
    ...listFiles(path.join(FEATURE_DIR, "utils"), /\.ts$/),
  ];
  const callers = allFiles.filter((file) => /apiService\.submitOperatorPreventiveMaintenance\(/.test(fs.readFileSync(file, "utf8")));
  assert.deepEqual(
    callers.map((file) => path.basename(file)),
    ["usePreventiveSubmission.ts"],
    "only usePreventiveSubmission.ts may call apiService.submitOperatorPreventiveMaintenance",
  );
});

test("usePreventiveChecklist is the sole caller of updateOperatorPreventiveTaskChecklist", () => {
  const allFiles = [
    PAGE,
    ...listFiles(path.join(FEATURE_DIR, "hooks"), /\.ts$/),
    ...listFiles(path.join(FEATURE_DIR, "components"), /\.tsx$/),
    ...listFiles(path.join(FEATURE_DIR, "utils"), /\.ts$/),
  ];
  const callers = allFiles.filter((file) => /apiService\.updateOperatorPreventiveTaskChecklist\(/.test(fs.readFileSync(file, "utf8")));
  assert.deepEqual(
    callers.map((file) => path.basename(file)),
    ["usePreventiveChecklist.ts"],
    "only usePreventiveChecklist.ts may call apiService.updateOperatorPreventiveTaskChecklist",
  );
});

test("hooks never import from components, and components never import page.tsx — no circular feature imports", () => {
  const hookFiles = listFiles(path.join(FEATURE_DIR, "hooks"), /\.ts$/);
  for (const file of hookFiles) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /from ["']\.\.\/components\//, `${path.basename(file)} (a hook) must not import from components/`);
    assert.doesNotMatch(source, /from ["']\.\.\/page["']/, `${path.basename(file)} (a hook) must not import page.tsx`);
  }

  const componentFiles = listFiles(path.join(FEATURE_DIR, "components"), /\.tsx$/);
  for (const file of componentFiles) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /from ["']\.\.\/page["']/, `${path.basename(file)} must not import page.tsx`);
    assert.doesNotMatch(source, /from ["']\.\.\/hooks\//, `${path.basename(file)} must not import a hook directly — hooks are wired in page.tsx and passed down as props`);
  }
});

test("no dead schedule/reschedule modal state remains anywhere in the feature", () => {
  const allFiles = [
    PAGE,
    ...listFiles(path.join(FEATURE_DIR, "hooks"), /\.ts$/),
    ...listFiles(path.join(FEATURE_DIR, "components"), /\.tsx$/),
    ...listFiles(path.join(FEATURE_DIR, "utils"), /\.ts$/),
  ];
  const wholeSource = allFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n---\n");
  for (const deadIdentifier of ["schedulePlan", "rescheduleOccurrence", "ScheduleFirstInterventionModal", "RescheduleOccurrenceModal"]) {
    assert.doesNotMatch(wholeSource, new RegExp(deadIdentifier), `dead identifier must not reappear: ${deadIdentifier}`);
  }
  assert.equal(
    fs.existsSync(path.join(FEATURE_DIR, "components/ScheduleFirstInterventionModal.tsx")),
    false,
    "the unreachable schedule modal component file must be deleted, not just unused",
  );
  assert.equal(
    fs.existsSync(path.join(FEATURE_DIR, "components/RescheduleOccurrenceModal.tsx")),
    false,
    "the unreachable reschedule modal component file must be deleted, not just unused",
  );
});

test("no dead customCategory/customMachine free-text inputs remain", () => {
  const source = fs.readFileSync(PAGE, "utf8");
  const componentFiles = listFiles(path.join(FEATURE_DIR, "components"), /\.tsx$/);
  const wholeSource = [source, ...componentFiles.map((file) => fs.readFileSync(file, "utf8"))].join("\n---\n");
  assert.doesNotMatch(wholeSource, /customCategory/, "the dead customCategory input/state must be removed, not just unused");
  assert.doesNotMatch(wholeSource, /customMachine/, "the dead customMachine input/state must be removed, not just unused");
});

test("page.tsx stays within a reasonable size for a route-level composition root", () => {
  const source = fs.readFileSync(PAGE, "utf8");
  const lineCount = source.split("\n").length;
  assert.ok(
    lineCount < 500,
    `page.tsx has grown to ${lineCount} lines — re-check whether new logic belongs in a hook/component instead`,
  );
});
