import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  AI_ANOMALY_DATASET_REPLAY_LABEL,
  AI_ANOMALY_LIMITATION_NOTICE,
  AI_ANOMALY_RISK_INDICATORS,
  buildRiskScoreChartData,
  canBrowseAiAnomalyHistory,
  canSubmitAiAnomalyAnalysis,
  canValidateAiAnomaly,
  filterAiAnomalyAnalyses,
  machineDisplayName,
  sourceLabelKey,
  summarizeAiAnomalyAnalyses,
  type AiAnomalyAnalysis,
} from "../src/services/aiAnomaly.ts";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const PAGE = "src/app/[locale]/ai-anomaly/page.tsx";
const API = "src/services/api.ts";
const LAYOUT = "src/components/DashboardLayout.tsx";

const baseAnalysis: AiAnomalyAnalysis = {
  analysis_id: "AI-ANOM-1",
  machine_id: "machine-a",
  model_version: "0.1.0",
  input_source: "DATASET_REPLAY",
  experiment: "1st_test",
  measurement_timestamp: "2003-11-15T18:18:46.000Z",
  bearing: 1,
  anomaly_score: 0.43,
  risk_score: 43,
  risk_level: "MONITOR",
  raw_anomaly: false,
  persistent_alert: false,
  component_scores: { zScore: 0.72, isolationForest: 0.14 },
  reason_codes: ["ELEVATED_ROLLING_DEVIATION"],
  prototype_result: true,
  validation_status: "PENDING",
};

test("Admin and Technician can browse anomaly history, Operator cannot", () => {
  assert.equal(canBrowseAiAnomalyHistory("admin"), true);
  assert.equal(canBrowseAiAnomalyHistory("technician"), true);
  assert.equal(canBrowseAiAnomalyHistory("operator"), false);
  assert.match(
    readSource(PAGE),
    /<ProtectedRoute allowedRoles=\{\["admin", "technician"\]\}>/,
  );
});

test("Operator can submit through an existing machine workflow but cannot browse history", () => {
  assert.equal(canSubmitAiAnomalyAnalysis("operator"), true);
  assert.equal(canBrowseAiAnomalyHistory("operator"), false);
  assert.doesNotMatch(
    readSource(LAYOUT),
    /activeRole === 'operator'[\s\S]*aiAnomalyMonitoring/,
  );
});

test("apiService integrates only the existing /ai-anomaly backend endpoints", () => {
  const source = readSource(API);
  assert.match(source, /getAiAnomalyModels:\s*\(\)\s*=>\s*api\.get\("\/ai-anomaly\/models"\)/);
  assert.match(source, /getAiAnomalyAnalyses:[\s\S]*api\.get\("\/ai-anomaly\/analyses"/);
  assert.match(source, /getAiAnomalyMachineHistory:[\s\S]*\/ai-anomaly\/machines\/\$\{machineId\}\/history/);
  assert.match(source, /getAiAnomalyAnalysis:[\s\S]*\/ai-anomaly\/analyses\/\$\{id\}/);
  assert.match(source, /validateAiAnomalyAnalysis:[\s\S]*\/ai-anomaly\/analyses\/\$\{id\}\/validation/);
});

test("filters support machine, risk level, validation status, date range and pagination", () => {
  const rows = [
    baseAnalysis,
    {
      ...baseAnalysis,
      analysis_id: "AI-ANOM-2",
      machine_id: "machine-b",
      risk_level: "HIGH",
      validation_status: "CONFIRMED",
      measurement_timestamp: "2003-11-16T18:18:46.000Z",
    } as AiAnomalyAnalysis,
  ];

  assert.deepEqual(
    filterAiAnomalyAnalyses(rows, {
      machineId: "machine-a",
      riskLevel: "MONITOR",
      validationStatus: "PENDING",
      dateFrom: "2003-11-15",
      dateTo: "2003-11-15",
    }).map((row) => row.analysis_id),
    ["AI-ANOM-1"],
  );
  assert.match(readSource(PAGE), /<Pagination/);
});

test("summary cards count persistent alerts and validation outcomes", () => {
  const summary = summarizeAiAnomalyAnalyses([
    baseAnalysis,
    {
      ...baseAnalysis,
      analysis_id: "AI-ANOM-2",
      risk_score: 88,
      risk_level: "CRITICAL",
      persistent_alert: true,
      validation_status: "CONFIRMED",
      measurement_timestamp: "2003-11-16T18:18:46.000Z",
    },
    {
      ...baseAnalysis,
      analysis_id: "AI-ANOM-3",
      validation_status: "REJECTED",
    },
  ]);

  assert.equal(summary.latestRiskScore, 88);
  assert.equal(summary.latestRiskLevel, "CRITICAL");
  assert.equal(summary.persistentAlerts, 1);
  assert.equal(summary.pendingValidation, 1);
  assert.equal(summary.confirmedAnalyses, 1);
  assert.equal(summary.rejectedAnalyses, 1);
});

test("risk and persistent-alert rendering use icons plus text, not color alone", () => {
  for (const level of ["NORMAL", "MONITOR", "HIGH", "CRITICAL"] as const) {
    assert.ok(AI_ANOMALY_RISK_INDICATORS[level].icon);
    assert.ok(AI_ANOMALY_RISK_INDICATORS[level].className);
  }
  const source = readSource(PAGE);
  assert.match(source, /function RiskBadge/);
  assert.match(source, /function BooleanBadge/);
  assert.match(source, /persistentAlert\.active/);
});

test("analysis details render component scores and scientific limitations", () => {
  const source = readSource(PAGE);
  assert.match(source, /component_scores\.zScore/);
  assert.match(source, /component_scores\.isolationForest/);
  assert.match(source, /AI_ANOMALY_LIMITATION_NOTICE/);
  assert.match(AI_ANOMALY_LIMITATION_NOTICE, /public IMS bearing dataset/);
  assert.match(AI_ANOMALY_LIMITATION_NOTICE, /1st_test/);
  assert.match(AI_ANOMALY_LIMITATION_NOTICE, /IPROTEX machines/);
});

test("confirmation and rejection require a pending analysis and carry comments", () => {
  assert.equal(canValidateAiAnomaly("technician", baseAnalysis), true);
  assert.equal(
    canValidateAiAnomaly("technician", {
      ...baseAnalysis,
      validation_status: "CONFIRMED",
    }),
    false,
  );
  const source = readSource(PAGE);
  assert.match(source, /validation_status: validationForm\.status/);
  assert.match(source, /validation_comment: validationForm\.comment/);
  assert.match(source, /alreadyValidated/);
});

test("dataset replay is labelled as IMS replay and never as live IPROTEX measurements", () => {
  assert.equal(sourceLabelKey("DATASET_REPLAY"), "sources.datasetReplay");
  assert.equal(AI_ANOMALY_DATASET_REPLAY_LABEL, "IMS dataset replay");
  assert.doesNotMatch(readSource(PAGE), /live IPROTEX sensor measurements/i);
});

test("chart data is chronological", () => {
  const chart = buildRiskScoreChartData([
    { ...baseAnalysis, measurement_timestamp: "2003-11-16T18:18:46.000Z", risk_score: 66 },
    { ...baseAnalysis, measurement_timestamp: "2003-11-15T18:18:46.000Z", risk_score: 43 },
  ]);
  assert.deepEqual(chart.map((point) => point.value), [43, 66]);
});

test("human-readable machine labels hide Mongo IDs when available", () => {
  assert.equal(
    machineDisplayName("64a111111111111111111111", [
      { id: "64a111111111111111111111", label: "BRD-01" },
    ]),
    "BRD-01",
  );
});

test("UI omits automatic work-order creation", () => {
  assert.doesNotMatch(readSource(API), /ai-anomaly[\s\S]*createWorkOrder/);
  assert.match(readSource(PAGE), /proposeWorkOrder/);
  assert.match(readSource(PAGE), /disabled/);
});

test("translations exist for all locales and Arabic keeps RTL available", () => {
  const locales = ["en", "fr", "ar", "es", "de", "it"];
  for (const locale of locales) {
    const messages = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf8"),
    );
    assert.ok(messages.aiAnomaly, `${locale} must define aiAnomaly`);
    assert.equal(typeof messages.aiAnomaly.limitationNotice, "string");
    assert.equal(typeof messages.aiAnomaly.sources.datasetReplay, "string");
    assert.equal(typeof messages.sidebar.navigation.aiAnomalyMonitoring, "string");
  }
  assert.match(readSource("src/i18n/config.ts"), /ar/);
  assert.match(readSource("src/app/[locale]/layout.tsx"), /isRtlLocale\(locale\)/);
});
