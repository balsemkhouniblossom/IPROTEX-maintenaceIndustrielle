import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { matchesPreventiveChecklistSearch } from "../src/services/preventiveChecklistSearch.ts";

const PAGE = "src/app/[locale]/operator/preventive/page.tsx";

function readSource(): string {
  return fs.readFileSync(path.join(process.cwd(), PAGE), "utf8");
}

// --- matchesPreventiveChecklistSearch: pure logic, covers search-by-maintenance-code ---

test("matchesPreventiveChecklistSearch: empty/blank term matches every item", () => {
  const item = { instruction: "Check belt tension" };
  assert.equal(matchesPreventiveChecklistSearch(item, ""), true);
  assert.equal(matchesPreventiveChecklistSearch(item, "   "), true);
});

test("matchesPreventiveChecklistSearch: matches by populated plan maintenance_code", () => {
  const item = {
    instruction: "Check belt tension",
    plan_id: { maintenance_code: "PM-BELT-01", plan_id: "PLAN-1" },
  };
  assert.equal(matchesPreventiveChecklistSearch(item, "pm-belt-01"), true);
  assert.equal(matchesPreventiveChecklistSearch(item, "PM-BELT"), true);
  assert.equal(matchesPreventiveChecklistSearch(item, "no-match-code"), false);
});

test("matchesPreventiveChecklistSearch: falls back to the plan's plan_id when maintenance_code is absent", () => {
  const item = { instruction: "Check belt tension", plan_id: { plan_id: "PLAN-CHECKLIST-OWN" } };
  assert.equal(matchesPreventiveChecklistSearch(item, "checklist-own"), true);
});

test("matchesPreventiveChecklistSearch: matches by instruction, task_id, and responsable text", () => {
  const item = {
    instruction: "Inspect wiring harness",
    task_id: "PT-000123",
    responsable: "Alex Operator",
  };
  assert.equal(matchesPreventiveChecklistSearch(item, "wiring"), true);
  assert.equal(matchesPreventiveChecklistSearch(item, "pt-000123"), true);
  assert.equal(matchesPreventiveChecklistSearch(item, "alex"), true);
  assert.equal(matchesPreventiveChecklistSearch(item, "unrelated-term"), false);
});

test("matchesPreventiveChecklistSearch: a plain string plan_id (unpopulated ref) never contributes a false match", () => {
  const item = { instruction: "Check belt tension", plan_id: "64f0000000000000000000ab" };
  assert.equal(matchesPreventiveChecklistSearch(item, "64f0000000000000000000ab"), false);
  assert.equal(matchesPreventiveChecklistSearch(item, "belt"), true);
});

// --- Structural regression: exactly one "Preventive Maintenance Tasks" section ---

test("operator preventive page renders the backend-tracked checklist as the single Preventive Maintenance Tasks section", () => {
  const source = readSource();

  // The "Preventive Maintenance Tasks" title (tChecklist("heading")) must
  // label exactly one card-title section — not two competing checklist
  // blocks as before. (The same translation key may still be reused as a
  // toast message elsewhere; that's not a duplicated section.)
  const sectionOccurrences =
    source.match(/card-title[^>]*>\s*\{tChecklist\("heading"\)\}/g) ?? [];
  assert.equal(
    sectionOccurrences.length,
    1,
    "the tChecklist('heading') ('Preventive Maintenance Tasks') card-title must render exactly once on the operator page",
  );
});

test("operator preventive page no longer renders the old ad-hoc client-only checklist (duplicated section removed)", () => {
  const source = readSource();

  for (const removedIdentifier of [
    "checkedTasks",
    "customTasks",
    "customTaskGroups",
    "toggleTask(",
    "addTaskFromSelection",
    "removeCustomTask",
    "preventive-task-checkbox-",
    "preventive-custom-task-select",
    "preventive-custom-task-group",
    "preventive-add-custom-task",
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(removedIdentifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `operator preventive page must no longer reference the removed ad-hoc checklist identifier: ${removedIdentifier}`,
    );
  }
});

test("the checklist section shows exactly one selected plan at a time: loading, error, empty, or that plan's list", () => {
  const source = readSource();

  assert.match(source, /data-testid="preventive-checklist-loading"/);
  assert.match(source, /data-testid="preventive-checklist-error"/);
  assert.match(source, /data-testid="preventive-checklist-empty"/);
  assert.match(source, /selectedChecklistItems\.map\(\(item,\s*index\)\s*=>/);
  assert.doesNotMatch(source, /data-testid="preventive-checklist-empty-search"/);
  assert.doesNotMatch(source, /filteredChecklistItems/);

  // Regression guard: these must be branches of the *same* ternary chain
  // (mutually exclusive), not independent sibling conditionals that could
  // render together — e.g. two "no data" messages stacked at once.
  assert.match(
    source,
    /checklistLoading[\s\S]{0,120}preventive-checklist-loading[\s\S]{0,450}checklistError[\s\S]{0,120}preventive-checklist-error[\s\S]{0,450}selectedChecklistItems\.length === 0[\s\S]{0,220}preventive-checklist-empty"[\s\S]{0,450}selectedChecklistItems\.map/,
  );
});

test("the checklist is filtered to the currently selected maintenance code group", () => {
  const source = readSource();

  assert.match(source, /const selectedPlanId = selectedPlanIds\[activePlanStepIndex\] \|\| selectedPlanIds\[0\] \|\| ""/);
  assert.match(source, /const preventivePlanGroups = useMemo\(/);
  assert.match(source, /existing\.states\.push\(state\)/);
  assert.match(source, /setSelectedPlanIds\(group\.planIds\)/);
  assert.match(source, /const groupedChecklistItems = useMemo\(/);
  assert.match(source, /const selectedChecklistItems = useMemo\(/);
  assert.match(source, /groupedChecklistItems\.filter\(\(item\) => item\.status === "completed"\)/);
  assert.match(source, /checklistItems\.filter\(\(item\) => checklistPlanId\(item\) === selectedPlanId\)/);
  assert.match(source, /preventivePlanGroups\.map\(\(group\) =>/);
  assert.doesNotMatch(source, /allTaskItems\.length === 0/);
});

test("the old two-part checklist search layout is removed from the operator page", () => {
  const source = readSource();

  assert.doesNotMatch(source, /data-testid="preventive-checklist-search"/);
  assert.doesNotMatch(source, /matchesPreventiveChecklistSearch/);
  assert.doesNotMatch(source, /checklistSearchTerm/);
  assert.doesNotMatch(source, /renderOccurrenceSection/);
});

test("submission derives tasks_completed from persisted checklist items for each stepped work order", () => {
  const source = readSource();

  assert.match(source, /for \(const planId of selectedPlanIds\)/);
  assert.match(source, /const planItems = groupedChecklistItems\.filter\(\(item\) => checklistPlanId\(item\) === planId\)/);
  assert.match(source, /tasks_completed:\s*planLabels/);
  assert.match(
    source,
    /completedChecklistLabels\s*=\s*useMemo\(\s*\(\)\s*=>\s*groupedChecklistItems\.filter\(\(item\)\s*=>\s*item\.status === "completed"\)/,
  );
});

test("the focused workflow exposes Start, Complete, Next, and final Submit as gated actions", () => {
  const source = readSource();

  assert.match(source, /const \[taskStarted,\s*setTaskStarted\] = useState\(false\)/);
  assert.match(source, /const \[activePlanStepIndex,\s*setActivePlanStepIndex\] = useState\(0\)/);
  assert.match(source, /async function startSelectedTask\(\): Promise<void>/);
  assert.match(source, /async function completeSelectedTask\(\): Promise<void>/);
  assert.match(source, /function goToNextPlanStep\(\): void/);
  assert.match(source, /const canGoToNextPlanStep = Boolean\(taskStarted && selectedTaskCompleted && !isLastPlanStep\)/);
  assert.match(source, /const canSubmitFocusedTask = Boolean\(taskStarted && groupTaskCompleted && selectedPlanIds\.every/);
  assert.match(source, /onClick=\{\(\) => void startSelectedTask\(\)\}/);
  assert.match(source, /onClick=\{\(\) => void completeSelectedTask\(\)\}/);
  assert.match(source, /data-testid="preventive-next-step-button"/);
  assert.match(source, /disabled=\{!canSubmitFocusedTask \|\| submitting \|\| !isLastPlanStep\}/);
  assert.match(source, /data-testid="preventive-submit-button"/);
});

test("the preventive page report history hides internal IDs and long summaries from the scan view", () => {
  const source = readSource();
  const listMarkup = source.slice(
    source.indexOf("preventiveGeneratedReports.map"),
    source.indexOf("isOpen={Boolean(selectedGeneratedReport)}"),
  );

  assert.match(source, /const \[selectedGeneratedReport,\s*setSelectedGeneratedReport\]/);
  assert.match(source, /const preventiveGeneratedReports = generatedReports\.filter\(\(item\) => item\.type === "preventive"\)/);
  assert.match(listMarkup, /item\.machine/);
  assert.match(listMarkup, /formatReportDate\(item\.createdAt\)/);
  assert.match(listMarkup, /formatReportStatus\(item\.status\)/);
  assert.match(listMarkup, /data-testid=\{`preventive-report-details-\$\{index\}`\}/);

  for (const hiddenPattern of [
    /item\.reportId/,
    /item\.workOrderId/,
    /item\.summary/,
    /<table/,
    /<th/,
    /font-mono/,
  ]) {
    assert.doesNotMatch(
      listMarkup,
      hiddenPattern,
      "preventive report scan view must not expose IDs, table columns, or long task summaries",
    );
  }

  assert.match(source, /selectedGeneratedReport\.summary/);
});

test("all supported locales still define the preventiveTaskChecklist empty key used by the operator checklist", () => {
  const locales = ["en", "fr", "ar", "de", "es", "it"];
  for (const locale of locales) {
    const messagesPath = path.join(process.cwd(), "messages", `${locale}.json`);
    const messages = JSON.parse(fs.readFileSync(messagesPath, "utf8"));
    assert.ok(
      messages.preventiveTaskChecklist?.empty?.default,
      `${locale}.json must define preventiveTaskChecklist.empty.default`,
    );
  }
});
