import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("Failures Management page joins pannes with linked solutions without changing backend APIs", () => {
  const source = readSource("src/app/[locale]/pannes/page.tsx");

  assert.match(source, /apiService\.getPannes\(\{/);
  assert.match(source, /apiService\.fetchAllFromPaginatedEndpoint<PanneSolution>\(\s*\n\s*apiService\.getPanneSolutions,/);
  assert.match(source, /function groupSolutionsByPanne\(/);
  assert.match(source, /const failureRows = useMemo<FailureRow\[\]>/);
  assert.match(source, /solutions: rowSolutions/);
  assert.match(source, /solution_cause: primarySolution\?\.cause_probable/);
  assert.match(source, /solution_recommendation:\s*\n\s*primarySolution\?\.solution_recommandee/);
});

test("Failures Management page keeps panne CRUD and adds linked solution CRUD actions", () => {
  const source = readSource("src/app/[locale]/pannes/page.tsx");

  assert.match(source, /apiService\.createPanne\(payload\)/);
  assert.match(source, /apiService\.updatePanne\(editingPanne\._id, payload\)/);
  assert.match(source, /apiService\.deletePanne\(id\)/);
  assert.match(source, /apiService\.createPanneSolution\(payload\)/);
  assert.match(source, /apiService\.updatePanneSolution\(editingSolution\._id, payload\)/);
  assert.match(source, /apiService\.deletePanneSolution\(id\)/);
  assert.match(source, /openCreateSolutionModal\(panne\)/);
  assert.match(source, /openEditSolutionModal\(solution, panne\)/);
  assert.match(source, /tSolutions\("notifications\.confirmDelete"\)/);
});

test("Failures Management search includes fault and solution fields", () => {
  const source = readSource("src/app/[locale]/pannes/page.tsx");

  for (const field of [
    "panne_id",
    "code_panne",
    "description",
    "gravite",
    "solution_cause",
    "solution_recommendation",
  ]) {
    assert.match(source, new RegExp(`"${field}"`));
  }

  assert.match(source, /const FAILURE_SEARCH_FIELDS = \[/);
  assert.match(source, /function matchesFailureSearch\(/);
  assert.match(source, /FAILURE_SEARCH_FIELDS\.some\(\(field\) =>/);
  assert.match(source, /matchesFailureSearch\(panne, searchTerm, selectedSearchField\)/);
});

test("Old Panne Solutions route redirects to Failures Management and sidebar entry is removed", () => {
  const redirectSource = readSource("src/app/[locale]/panne-solutions/page.tsx");
  const layoutSource = readSource("src/components/DashboardLayout.tsx");

  assert.match(redirectSource, /redirect\(`\/\$\{locale\}\/pannes`\)/);
  assert.doesNotMatch(
    layoutSource,
    /href: '\/panne-solutions'|href: "\/panne-solutions"/,
  );
});
