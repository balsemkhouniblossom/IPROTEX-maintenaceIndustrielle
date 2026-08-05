import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { matchesPreventiveChecklistSearch } from "../src/services/preventiveChecklistSearch.ts";
import {
  buildPreventivePlanGroups,
  checklistPlanId,
  extractCompletedLabels,
  filterGroupedChecklistItems,
  filterSelectedChecklistItems,
  computeStepEligibility,
} from "../src/app/[locale]/operator/preventive/utils/preventive-plan-groups.ts";
import { buildPlanSubmissionPayload } from "../src/app/[locale]/operator/preventive/utils/preventive-validation.ts";

const FEATURE_DIR = "src/app/[locale]/operator/preventive";
const PAGE = `${FEATURE_DIR}/page.tsx`;
const PLAN_WORKFLOW_HOOK = `${FEATURE_DIR}/hooks/usePreventivePlanWorkflow.ts`;
const SUBMISSION_HOOK = `${FEATURE_DIR}/hooks/usePreventiveSubmission.ts`;
const PLAN_GROUPS_UTILS = `${FEATURE_DIR}/utils/preventive-plan-groups.ts`;
const PLAN_TABS_COMPONENT = `${FEATURE_DIR}/components/PreventivePlanTabs.tsx`;
const CHECKLIST_COMPONENT = `${FEATURE_DIR}/components/PreventiveChecklist.tsx`;
const STEP_HEADER_COMPONENT = `${FEATURE_DIR}/components/PreventiveStepHeader.tsx`;
const SUBMISSION_ACTIONS_COMPONENT = `${FEATURE_DIR}/components/PreventiveSubmissionActions.tsx`;
const REPORTS_SECTION_COMPONENT = `${FEATURE_DIR}/components/PreventiveReportsSection.tsx`;

function readSource(relativePath: string = PAGE): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

/** Every .ts/.tsx source file under the feature directory, concatenated — used for "this identifier must not exist anywhere in the feature" checks that used to only scan the single monolithic page.tsx. */
function readWholeFeatureTreeSource(): string {
  const root = path.join(process.cwd(), FEATURE_DIR);
  const files: string[] = [];

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (/\.tsx?$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }
  walk(root);

  return files.map((file) => fs.readFileSync(file, "utf8")).join("\n---\n");
}

// --- matchesPreventiveChecklistSearch: pure logic, covers search-by-maintenance-code ---
// (unchanged: this dead-code service function and its tests are unrelated to the
// page decomposition — `matchesPreventiveChecklistSearch` was already fully
// decoupled from the page before this continuation started.)

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

// --- Pure plan-grouping/eligibility logic — behavioral unit tests -----------
// These replace source-regex assertions that used to lock the exact
// implementation text of the grouping/eligibility calculations inside
// page.tsx. The logic now lives in typed, dependency-free functions in
// utils/preventive-plan-groups.ts, so it's tested directly by calling it
// with representative data instead of pattern-matching source text.

test("buildPreventivePlanGroups: groups plan states by maintenance_code, trimmed/uppercased, falling back to plan_id", () => {
  const stateA = { plan: { _id: "p1", plan_id: "PLAN-1", maintenance_code: " pm-01 " }, currentState: "not_scheduled" };
  const stateB = { plan: { _id: "p2", plan_id: "PLAN-2", maintenance_code: "PM-01" }, currentState: "due_today" };
  const stateC = { plan: { _id: "p3", plan_id: "PLAN-3" }, currentState: "not_scheduled" };

  // @ts-expect-error - partial PreventivePlanState fixtures are sufficient for this pure function
  const groups = buildPreventivePlanGroups([stateA, stateB, stateC]);

  assert.equal(groups.length, 2, "PM-01 (both casings/whitespace) must collapse into a single group; PLAN-3 is its own group");
  const pm01Group = groups.find((group) => group.planIds.includes("p1"));
  assert.ok(pm01Group);
  assert.deepEqual(pm01Group!.planIds, ["p1", "p2"], "grouping must preserve encounter order within a group");
  assert.equal(
    pm01Group!.label,
    " pm-01 ",
    "the group label displays the first-seen maintenance_code exactly as entered (only the grouping KEY is trimmed/uppercased, not the display label)",
  );
});

test("filterGroupedChecklistItems / filterSelectedChecklistItems: scope checklist items to the active group vs. the single focused plan", () => {
  const items = [
    { _id: "i1", plan_id: "planA", status: "completed" as const, instruction: "A", task_id: "t1" },
    { _id: "i2", plan_id: "planB", status: "pending" as const, instruction: "B", task_id: "t2" },
    { _id: "i3", plan_id: "planC", status: "pending" as const, instruction: "C", task_id: "t3" },
  ];

  const grouped = filterGroupedChecklistItems(items, new Set(["planA", "planB"]));
  assert.deepEqual(grouped.map((item) => item._id), ["i1", "i2"]);

  const focused = filterSelectedChecklistItems(items, "planB");
  assert.deepEqual(focused.map((item) => item._id), ["i2"]);
});

test("checklistPlanId: resolves both populated and unpopulated plan_id refs, and empty when absent", () => {
  assert.equal(checklistPlanId({ plan_id: "planA" } as never), "planA");
  assert.equal(checklistPlanId({ plan_id: { _id: "planB" } } as never), "planB");
  assert.equal(checklistPlanId({} as never), "");
});

test("extractCompletedLabels: returns only the completed items' instructions, in order", () => {
  const items = [
    { instruction: "First", status: "completed" as const },
    { instruction: "Second", status: "pending" as const },
    { instruction: "Third", status: "completed" as const },
  ];
  // @ts-expect-error - partial PreventiveTaskChecklistItem fixtures are sufficient for this pure function
  assert.deepEqual(extractCompletedLabels(items), ["First", "Third"]);
});

test("computeStepEligibility: Next requires a started, fully-completed, non-final step; Submit requires the group done with every plan occurrence resolved (independent of step position)", () => {
  const base = {
    taskStarted: true,
    selectedTaskCompleted: true,
    isLastPlanStep: false,
    groupTaskCompleted: true,
    selectedPlanIds: ["p1", "p2"],
    selectedOccurrenceIdsByPlan: { p1: "occ1", p2: "occ2" },
    selectedPlanGroup: null,
  };

  // Not the last step yet: Next is available; Submit doesn't care about step
  // position at all (the page only additionally disables the Submit button
  // with `!isLastPlanStep` at the UI layer — see PreventiveSubmissionActions).
  assert.deepEqual(computeStepEligibility(base), { canGoToNextPlanStep: true, canSubmitFocusedTask: true });

  // On the last step, Next is never available regardless of completeness.
  assert.deepEqual(computeStepEligibility({ ...base, isLastPlanStep: true }), {
    canGoToNextPlanStep: false,
    canSubmitFocusedTask: true,
  });

  // Nothing is enabled before the task has been started.
  assert.deepEqual(computeStepEligibility({ ...base, taskStarted: false, isLastPlanStep: true }), {
    canGoToNextPlanStep: false,
    canSubmitFocusedTask: false,
  });

  // Every selected plan must have a resolvable occurrence id (from the map
  // or the plan-group's currentOccurrence) before Submit is enabled.
  assert.deepEqual(
    computeStepEligibility({ ...base, selectedOccurrenceIdsByPlan: { p1: "occ1" } }),
    { canGoToNextPlanStep: true, canSubmitFocusedTask: false },
  );

  // groupTaskCompleted=false (not every checklist item in the group is
  // done yet) also blocks Submit even with every occurrence resolved.
  assert.deepEqual(computeStepEligibility({ ...base, groupTaskCompleted: false }), {
    canGoToNextPlanStep: true,
    canSubmitFocusedTask: false,
  });
});

test("buildPlanSubmissionPayload: only returns a payload when the plan's group items are all completed and an occurrence id is resolvable", () => {
  const items = [
    { _id: "i1", plan_id: "planA", status: "completed" as const, instruction: "Done task", task_id: "t1" },
  ];
  const complete = buildPlanSubmissionPayload("planA", items, { planA: "occ1" }, null);
  assert.deepEqual(complete, { occurrenceId: "occ1", taskLabels: ["Done task"] });

  const incompleteItems = [
    { _id: "i1", plan_id: "planA", status: "pending" as const, instruction: "Not done", task_id: "t1" },
  ];
  assert.equal(buildPlanSubmissionPayload("planA", incompleteItems, { planA: "occ1" }, null), null);

  assert.equal(buildPlanSubmissionPayload("planA", items, {}, null), null, "no occurrence id anywhere means no payload");
});

// --- Structural regression: exactly one "Preventive Maintenance Tasks" section ---

test("the operator preventive feature renders the backend-tracked checklist as the single Preventive Maintenance Tasks section", () => {
  const treeSource = readWholeFeatureTreeSource();

  // The "Preventive Maintenance Tasks" title (tChecklist("heading")) must
  // label exactly one card-title section anywhere in the feature — not two
  // competing checklist blocks as before. (The same translation key may
  // still be reused as a toast message elsewhere; that's not a duplicated
  // section.) This now lives in PreventiveStepHeader.tsx, not page.tsx.
  const sectionOccurrences = treeSource.match(/card-title[^>]*>\s*\{tChecklist\("heading"\)\}/g) ?? [];
  assert.equal(
    sectionOccurrences.length,
    1,
    "the tChecklist('heading') ('Preventive Maintenance Tasks') card-title must render exactly once across the whole feature",
  );
  assert.match(readSource(STEP_HEADER_COMPONENT), /card-title[^>]*>\s*\{tChecklist\("heading"\)\}/);
});

test("the operator preventive feature no longer contains the old ad-hoc client-only checklist (duplicated section removed)", () => {
  const treeSource = readWholeFeatureTreeSource();

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
      treeSource,
      new RegExp(removedIdentifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `no file in the operator preventive feature may reference the removed ad-hoc checklist identifier: ${removedIdentifier}`,
    );
  }
});

test("the checklist component shows exactly one selected plan at a time: loading, error, empty, or that plan's list", () => {
  const source = readSource(CHECKLIST_COMPONENT);

  assert.match(source, /data-testid="preventive-checklist-loading"/);
  assert.match(source, /data-testid="preventive-checklist-error"/);
  assert.match(source, /data-testid="preventive-checklist-empty"/);
  assert.match(source, /items\.map\(\(item,\s*index\)\s*=>/);

  const treeSource = readWholeFeatureTreeSource();
  assert.doesNotMatch(treeSource, /data-testid="preventive-checklist-empty-search"/);
  assert.doesNotMatch(treeSource, /filteredChecklistItems/);

  // Regression guard: these must be branches of the *same* ternary chain
  // (mutually exclusive), not independent sibling conditionals that could
  // render together — e.g. two "no data" messages stacked at once.
  assert.match(
    source,
    /checklistLoading[\s\S]{0,120}preventive-checklist-loading[\s\S]{0,450}checklistError[\s\S]{0,120}preventive-checklist-error[\s\S]{0,450}items\.length === 0[\s\S]{0,220}preventive-checklist-empty"[\s\S]{0,450}items\.map/,
  );
});

test("the checklist is filtered to the currently selected maintenance code group", () => {
  const workflowSource = readSource(PLAN_WORKFLOW_HOOK);
  const groupsUtilsSource = readSource(PLAN_GROUPS_UTILS);
  const tabsSource = readSource(PLAN_TABS_COMPONENT);
  const treeSource = readWholeFeatureTreeSource();

  assert.match(workflowSource, /const selectedPlanId = selectedPlanIds\[activePlanStepIndex\] \|\| selectedPlanIds\[0\] \|\| ""/);
  assert.match(workflowSource, /const preventivePlanGroups = useMemo\(/);
  assert.match(workflowSource, /const groupedChecklistItems = useMemo\(/);
  assert.match(workflowSource, /const selectedChecklistItems = useMemo\(/);
  assert.match(groupsUtilsSource, /existing\.states\.push\(state\)/);
  assert.match(groupsUtilsSource, /checklistItems\.filter\(\(item\) => checklistPlanId\(item\) === selectedPlanId\)/);

  // Selecting a plan-group tab passes that group's full planIds array down
  // to the workflow hook, which stores it verbatim as the active selection.
  assert.match(tabsSource, /onClick=\{\(\) => onSelectGroup\(group\.planIds\)\}/);
  assert.match(workflowSource, /function selectPlanGroup\(planIds: string\[\]\): void \{/);
  assert.match(workflowSource, /setSelectedPlanIds\(planIds\);/);

  assert.doesNotMatch(treeSource, /allTaskItems\.length === 0/);
});

test("the old two-part checklist search layout is removed from the operator preventive feature", () => {
  const treeSource = readWholeFeatureTreeSource();

  assert.doesNotMatch(treeSource, /data-testid="preventive-checklist-search"/);
  assert.doesNotMatch(treeSource, /matchesPreventiveChecklistSearch/);
  assert.doesNotMatch(treeSource, /checklistSearchTerm/);
  assert.doesNotMatch(treeSource, /renderOccurrenceSection/);
});

test("submission derives tasks_completed from persisted checklist items for each stepped work order", () => {
  const submissionSource = readSource(SUBMISSION_HOOK);
  const validationSource = readSource("src/app/[locale]/operator/preventive/utils/preventive-validation.ts");

  assert.match(submissionSource, /for \(const planId of selectedPlanIds\)/);
  assert.match(submissionSource, /tasks_completed:\s*planPayload\.taskLabels/);
  assert.match(validationSource, /const planItems = groupedChecklistItems\.filter\(\(item\) => checklistPlanId\(item\) === planId\)/);
});

test("the focused workflow exposes Start, Complete, Next, and final Submit as gated actions", () => {
  const workflowSource = readSource(PLAN_WORKFLOW_HOOK);
  const groupsUtilsSource = readSource(PLAN_GROUPS_UTILS);
  const actionsSource = readSource(SUBMISSION_ACTIONS_COMPONENT);
  const pageSource = readSource();

  assert.match(workflowSource, /const \[taskStarted,\s*setTaskStarted\] = useState\(false\)/);
  assert.match(workflowSource, /const \[activePlanStepIndex,\s*setActivePlanStepIndex\] = useState\(0\)/);
  assert.match(workflowSource, /const startSelectedTask = useCallback\(async \(\): Promise<void> =>/);
  assert.match(workflowSource, /function goToNextPlanStep\(\): void/);
  assert.match(groupsUtilsSource, /const canGoToNextPlanStep = Boolean\(taskStarted && selectedTaskCompleted && !isLastPlanStep\)/);

  assert.match(pageSource, /onStart=\{\(\) => void planWorkflow\.startSelectedTask\(\)\}/);
  assert.match(pageSource, /onComplete=\{\(\) => void handleCompleteSelectedTask\(\)\}/);
  assert.match(actionsSource, /data-testid="preventive-next-step-button"/);
  assert.match(actionsSource, /disabled=\{!canSubmitFocusedTask \|\| submitting \|\| !isLastPlanStep\}/);
  assert.match(actionsSource, /data-testid="preventive-submit-button"/);
});

test("the preventive page report history hides internal IDs and long summaries from the scan view", () => {
  const pageSource = readSource();
  const reportsSectionSource = readSource(REPORTS_SECTION_COMPONENT);

  assert.match(pageSource, /const \[selectedGeneratedReport,\s*setSelectedGeneratedReport\]/);
  assert.match(pageSource, /const preventiveGeneratedReports = generatedReports\.filter\(\(item\) => item\.type === "preventive"\)/);

  assert.match(reportsSectionSource, /item\.machine/);
  assert.match(reportsSectionSource, /formatReportDate\(item\.createdAt\)/);
  assert.match(reportsSectionSource, /formatReportStatus\(item\.status\)/);
  assert.match(reportsSectionSource, /data-testid=\{`preventive-report-details-\$\{index\}`\}/);

  for (const hiddenPattern of [/item\.reportId/, /item\.workOrderId/, /item\.summary/, /<table/, /<th/, /font-mono/]) {
    assert.doesNotMatch(
      reportsSectionSource,
      hiddenPattern,
      "preventive report scan view must not expose IDs, table columns, or long task summaries",
    );
  }

  const detailsContentSource = fs.readFileSync(
    path.join(process.cwd(), `${FEATURE_DIR}/components/ReportDetailsContent.tsx`),
    "utf8",
  );
  assert.match(detailsContentSource, /report\.summary/);
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
