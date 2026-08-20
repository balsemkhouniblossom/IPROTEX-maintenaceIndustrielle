import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const PAGE_PATH = "src/app/[locale]/maintenance-plans/page.tsx";

function readPage(): string {
  return fs.readFileSync(path.join(process.cwd(), PAGE_PATH), "utf8");
}

test("apiService exposes a transition endpoint and version-safe delete for maintenance plans", () => {
  const relativePath = "src/services/api.ts";
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

  assert.match(
    source,
    /transitionMaintenancePlan:\s*\([^)]*\)\s*=>\s*api\.patch\(`\/maintenance-plans\/\$\{id\}\/transition`/,
    "apiService.transitionMaintenancePlan must PATCH /maintenance-plans/:id/transition",
  );
  assert.match(
    source,
    /deleteMaintenancePlan:\s*\(id:\s*string,\s*expectedVersion\?:\s*number\)/,
    "apiService.deleteMaintenancePlan must accept an optional expectedVersion for version-safe deletes",
  );
});

test("Maintenance plans page only offers the transitions valid for each plan's current status", () => {
  const source = readPage();

  assert.match(
    source,
    /AVAILABLE_TRANSITIONS/,
    `${PAGE_PATH} must compute available actions from the plan's current status`,
  );

  // Every status must map to a transition list, and Archived must be a
  // dead end (read-only, no further transitions offered).
  const tableMatch = source.match(/AVAILABLE_TRANSITIONS[^{]*\{([\s\S]*?)\n\};/);
  assert.ok(tableMatch, "AVAILABLE_TRANSITIONS table must be defined");
  const table = tableMatch![1];
  assert.match(table, /draft:\s*\[['"]activate['"]/, "Draft must offer activate");
  assert.match(table, /active:\s*\[['"]pause['"]/, "Active must offer pause");
  assert.match(table, /paused:\s*\[['"]resume['"]/, "Paused must offer resume");
  assert.match(table, /archived:\s*\[\s*\]/, "Archived must offer no further transitions");
});

test("Maintenance plans page calls the transition endpoint with a translated confirmation before every lifecycle action", () => {
  const source = readPage();

  assert.match(
    source,
    /apiService\.transitionMaintenancePlan\(/,
    `${PAGE_PATH} must call apiService.transitionMaintenancePlan for lifecycle actions`,
  );
  assert.match(
    source,
    /confirm\(t\(TRANSITION_CONFIRM_KEYS\[action\]\)\)/,
    `${PAGE_PATH} must show a translated confirmation before applying a transition`,
  );
});

test("Maintenance plans page sends expected_version on edit/delete so the backend can enforce version-safety", () => {
  const source = readPage();

  assert.match(
    source,
    /expected_version:\s*editingPlan\.version/,
    `${PAGE_PATH} must send the currently-loaded plan's version when submitting an edit`,
  );
  assert.match(
    source,
    /apiService\.deleteMaintenancePlan\(plan\._id,\s*plan\.version\)/,
    `${PAGE_PATH} must send the plan's version when deleting it`,
  );
});

test("Maintenance plans page hides Edit and Delete once a plan is Archived (read-only)", () => {
  const source = readPage();

  assert.match(
    source,
    /const isArchived = status === ['"]archived['"]/,
    `${PAGE_PATH} must detect the Archived status`,
  );
  assert.match(
    source,
    /!isArchived \? \(\s*<button[\s\S]*?className="btn-secondary p-2"[\s\S]*?title=\{t\('actions\.edit'\)\}/,
    `${PAGE_PATH} must only render the Edit button when the plan is not archived`,
  );
  assert.match(
    source,
    /!isArchived \? \(\s*<button[\s\S]*?className="btn-danger p-2"[\s\S]*?title=\{t\('actions\.delete'\)\}/,
    `${PAGE_PATH} must only render the Delete button when the plan is not archived`,
  );
});

test("all supported locales contain the new maintenance plan lifecycle translation keys", () => {
  const locales = ["en", "fr", "ar", "es", "de", "it"];
  const requiredStatusKeys = ["draft", "active", "paused", "archived", "completed"];
  const requiredActionKeys = ["activate", "pause", "resume", "archive", "complete"];
  const requiredNotificationKeys = [
    "confirmActivate",
    "confirmPause",
    "confirmResume",
    "confirmArchive",
    "confirmComplete",
    "transitionSuccess",
    "transitionFailed",
  ];

  for (const locale of locales) {
    const messagesPath = path.join(process.cwd(), "messages", `${locale}.json`);
    const messages = JSON.parse(fs.readFileSync(messagesPath, "utf8"));
    const plans = messages.maintenancePlans;
    assert.ok(plans, `${locale}.json must have a maintenancePlans namespace`);

    for (const key of requiredStatusKeys) {
      const statusLabel = plans.status?.[key];
      assert.equal(typeof statusLabel, "string", `${locale}.json maintenancePlans.status.${key} must be a string`);
      assert.ok(statusLabel.length > 0, `${locale}.json maintenancePlans.status.${key} must be non-empty`);
    }
    for (const key of requiredActionKeys) {
      const actionLabel = plans.actions?.[key];
      assert.equal(typeof actionLabel, "string", `${locale}.json maintenancePlans.actions.${key} must be a string`);
      assert.ok(actionLabel.length > 0, `${locale}.json maintenancePlans.actions.${key} must be non-empty`);
    }
    for (const key of requiredNotificationKeys) {
      const notificationLabel = plans.notifications?.[key];
      assert.equal(
        typeof notificationLabel,
        "string",
        `${locale}.json maintenancePlans.notifications.${key} must be a string`,
      );
      assert.ok(
        notificationLabel.length > 0,
        `${locale}.json maintenancePlans.notifications.${key} must be non-empty`,
      );
    }
    // Regression guard: t('table.status', { default: 'Status' }) still
    // throws MISSING_MESSAGE when the key is absent - next-intl's `t()` has
    // no such fallback option, so the real key must actually exist.
    const tableStatusLabel = plans.table?.status;
    assert.equal(typeof tableStatusLabel, "string", `${locale}.json maintenancePlans.table.status must be a string`);
    assert.ok(tableStatusLabel.length > 0, `${locale}.json maintenancePlans.table.status must be non-empty`);
  }
});

test("PlanFormModal associates every field label with its control via matching htmlFor/id", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/[locale]/maintenance-plans/components/PlanFormModal.tsx"),
    "utf8",
  );

  const htmlForIds = [...source.matchAll(/htmlFor="([^"]+)"/g)].map((m) => m[1]);
  const idAttrs = [...source.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

  assert.equal(htmlForIds.length, 11, "PlanFormModal should have 11 labeled fields");
  for (const forId of htmlForIds) {
    assert.ok(
      idAttrs.includes(forId),
      `label htmlFor="${forId}" has no matching id="${forId}" on a control`,
    );
  }
});
