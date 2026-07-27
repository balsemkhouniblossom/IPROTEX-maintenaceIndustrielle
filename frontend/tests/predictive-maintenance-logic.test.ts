import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const HOOK = "src/hooks/usePredictiveHealth.ts";
const BADGE = "src/components/predictive-maintenance/MachineHealthBadge.tsx";
const PANEL = "src/components/predictive-maintenance/MachineHealthPanel.tsx";
const ADMIN_MACHINES_PAGE = "src/app/[locale]/machines/page.tsx";
const OPERATOR_MACHINES_PAGE = "src/app/[locale]/operator/machines/page.tsx";
const MAINTENANCE_PLANS_PAGE = "src/app/[locale]/maintenance-plans/page.tsx";
const TECHNICIAN_DETAIL = "src/components/technician/TechnicianWorkOrderDetail.tsx";

test("apiService exposes the predictive maintenance read endpoints and the admin/refresh mutation endpoints", () => {
  const source = readSource("src/services/api.ts");

  assert.match(
    source,
    /getPredictiveFleetSummary:\s*\(\)\s*=>\s*api\.get\('\/predictive-maintenance\/fleet-summary'\)/,
    "apiService.getPredictiveFleetSummary must GET /predictive-maintenance/fleet-summary",
  );
  assert.match(
    source,
    /getPredictivePlansSummary:\s*\(\)\s*=>\s*api\.get\('\/predictive-maintenance\/plans-summary'\)/,
    "apiService.getPredictivePlansSummary must GET /predictive-maintenance/plans-summary",
  );
  assert.match(
    source,
    /getMachineHealthPredictions:\s*\(machineId:\s*string\)\s*=>\s*\n?\s*api\.get\(`\/predictive-maintenance\/machines\/\$\{machineId\}`\)/,
    "apiService.getMachineHealthPredictions must GET /predictive-maintenance/machines/:machineId",
  );
  assert.match(
    source,
    /getMachineHealthHistory:\s*\(machineId:\s*string,\s*params\?:\s*AnyObject\)\s*=>\s*\n?\s*api\.get\(`\/predictive-maintenance\/machines\/\$\{machineId\}\/history`/,
    "apiService.getMachineHealthHistory must GET /predictive-maintenance/machines/:machineId/history",
  );
  assert.match(
    source,
    /refreshMachineHealthPrediction:\s*\(machineId:\s*string\)\s*=>\s*\n?\s*api\.post\(`\/predictive-maintenance\/machines\/\$\{machineId\}\/refresh`\)/,
    "apiService.refreshMachineHealthPrediction must POST /predictive-maintenance/machines/:machineId/refresh",
  );
  assert.match(
    source,
    /getPredictionModelVersions:\s*\(\)\s*=>\s*api\.get\('\/predictive-maintenance\/models'\)/,
    "apiService.getPredictionModelVersions must GET /predictive-maintenance/models",
  );
  assert.match(
    source,
    /trainPredictionModel:\s*\(modelType:\s*string\)\s*=>\s*\n?\s*api\.post\(`\/predictive-maintenance\/models\/\$\{modelType\}\/train`\)/,
    "apiService.trainPredictionModel must POST /predictive-maintenance/models/:modelType/train",
  );
});

test("usePredictiveHealth is REST + polling only (no WebSocket), on the shared 30s cadence", () => {
  const source = readSource(HOOK);

  assert.match(
    source,
    /apiService\.getPredictiveFleetSummary\(\)/,
    "the hook must fetch the bulk fleet health summary via REST",
  );
  assert.match(
    source,
    /const POLL_INTERVAL_MS = 30000;/,
    "the hook must poll on the same 30s cadence as the rest of the app (NotificationBell/useLiveMonitoring)",
  );
  assert.match(
    source,
    /window\.setInterval\(\(\) => void refresh\(\), POLL_INTERVAL_MS\)/,
    "the hook must keep re-polling on an interval",
  );
  assert.doesNotMatch(
    source,
    /socket\.io-client|io\(/,
    "this hook must not open a WebSocket — predictions only change on a scheduled sweep, not in real time",
  );
});

test("MachineHealthBadge takes status as a prop instead of calling the hook itself, and renders nothing with no data", () => {
  const source = readSource(BADGE);

  assert.doesNotMatch(
    source,
    /=\s*usePredictiveHealth\(\)/,
    "MachineHealthBadge must not call usePredictiveHealth() directly — one hook call per page, not per row",
  );
  assert.match(
    source,
    /import type \{ MachineHealthSummary, RiskLevel \} from "@\/hooks\/usePredictiveHealth";/,
    "MachineHealthBadge should only import the hook's types, not the hook function itself",
  );
  assert.match(source, /if \(!status\) return null;/, "must render nothing when there is no prediction yet");
});

test("MachineHealthPanel auto-fetches on mount (like KnowledgeSuggestions) and never triggers a new prediction run", () => {
  const source = readSource(PANEL);

  assert.match(source, /useEffect/, "must auto-fetch predictions when the machine is known, same as KnowledgeSuggestions");
  assert.match(
    source,
    /\.getMachineHealthPredictions\(machineId\)/,
    "must read already-computed predictions, not trigger a refresh",
  );
  assert.doesNotMatch(
    source,
    /refreshMachineHealthPrediction/,
    "viewing the panel must never itself trigger a new model inference run",
  );
  assert.match(source, /if \(predictions\.length === 0\) return null;/);
});

test("MachineHealthBadge shows a neutral Insufficient Data state with no misleading percentage, instead of a healthy-looking score", () => {
  const source = readSource(BADGE);

  assert.match(
    source,
    /insufficient_data:\s*"[^"]*gray[^"]*"/,
    "RISK_STYLES must map insufficient_data to a neutral gray style, distinct from the healthy (green) style",
  );
  assert.match(
    source,
    /status\.riskLevel === "insufficient_data"/,
    "the badge must branch on the insufficient_data risk level",
  );
});

test("MachineHealthPanel shows a neutral Insufficient Data state with no misleading percentage, instead of a healthy-looking score", () => {
  const source = readSource(PANEL);

  assert.match(
    source,
    /insufficient_data:\s*"[^"]*gray[^"]*"/,
    "RISK_TEXT_COLOR must map insufficient_data to a neutral gray style",
  );
  assert.match(
    source,
    /prediction\.risk_level === "insufficient_data"/,
    "the panel must branch on the insufficient_data risk level",
  );
});

test("MachineHealthPanel keeps measured facts, model output, and uncertainty in three visibly separate sections", () => {
  const source = readSource(PANEL);

  assert.match(source, /explanation\.measuredFacts/);
  assert.match(source, /explanation\.modelOutputNotes/);
  assert.match(source, /explanation\.uncertaintyNotes/);
  // Three distinct <ExplanationSection> renders, not one combined block.
  const sectionCalls = source.match(/<ExplanationSection/g) ?? [];
  assert.equal(sectionCalls.length, 3, "expected exactly 3 separate explanation sections");
});

test("Admin and Operator machine dashboards, and the Maintenance Plans page, all surface the health badge", () => {
  const adminMachines = readSource(ADMIN_MACHINES_PAGE);
  const operatorMachines = readSource(OPERATOR_MACHINES_PAGE);
  const maintenancePlans = readSource(MAINTENANCE_PLANS_PAGE);

  assert.match(adminMachines, /<MachineHealthBadge status=\{healthByMachine\[machine\.\_id\]\}/);
  assert.match(operatorMachines, /<MachineHealthBadge status=\{healthByMachine\[machine\.\_id\]\}/);
  assert.match(maintenancePlans, /<MachineHealthBadge status=\{planHealth\[plan\.\_id\]\}/);
});

test("Technician work-order detail renders the predictive health panel for the work order's machine", () => {
  const source = readSource(TECHNICIAN_DETAIL);

  assert.match(source, /<MachineHealthPanel machineId=\{machine\?\.\_id\}/);
});

test("all supported locales define the predictiveMaintenance translation namespace with matching keys", () => {
  const locales = ["en", "fr", "ar", "es", "de", "it"];

  function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
    return Object.entries(obj).flatMap(([key, value]) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return flatten(value as Record<string, unknown>, nextPrefix);
      }
      return [nextPrefix];
    });
  }

  const keysByLocale: Record<string, Set<string>> = {};
  for (const locale of locales) {
    const messagesPath = path.join(process.cwd(), "messages", `${locale}.json`);
    const messages = JSON.parse(fs.readFileSync(messagesPath, "utf8"));
    assert.ok(messages.predictiveMaintenance, `${locale}.json must have a predictiveMaintenance namespace`);
    assert.ok(
      typeof messages.maintenancePlans?.table?.machineHealth === "string" &&
        messages.maintenancePlans.table.machineHealth.length > 0,
      `${locale}.json maintenancePlans.table.machineHealth must be a non-empty string`,
    );
    keysByLocale[locale] = new Set(flatten(messages.predictiveMaintenance));
  }

  const englishKeys = keysByLocale.en;
  for (const locale of locales) {
    const missing = [...englishKeys].filter((key) => !keysByLocale[locale].has(key));
    assert.deepEqual(missing, [], `${locale}.json is missing predictiveMaintenance keys: ${missing.join(", ")}`);
  }

  const requiredKeys = [
    "table.health",
    "panelTitle",
    "disclaimer",
    "measuredFacts",
    "modelOutput",
    "uncertainty",
    "confidence",
    "healthScoreValue",
    "riskLevelTooltip",
    "riskLevels.low",
    "riskLevels.medium",
    "riskLevels.high",
    "riskLevels.critical",
    "riskLevels.insufficient_data",
    "modelTypes.zscore",
    "modelTypes.isolation_forest",
    "modelTypes.dbscan",
    "modelTypes.autoencoder",
  ];
  for (const key of requiredKeys) {
    assert.ok(englishKeys.has(key), `en.json predictiveMaintenance is missing required key: ${key}`);
  }
});
