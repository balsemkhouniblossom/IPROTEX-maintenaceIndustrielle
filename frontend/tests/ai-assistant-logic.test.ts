import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const PANEL = "src/components/ai-assistant/AiAssistantPanel.tsx";
const CORRECTIVE_PAGE = "src/app/[locale]/operator/corrective/page.tsx";
const TECHNICIAN_DETAIL = "src/components/technician/TechnicianWorkOrderDetail.tsx";

test("apiService exposes the AI assistant recommendation and audit-history endpoints", () => {
  const source = readSource("src/services/api.ts");

  assert.match(
    source,
    /requestAiAssistantRecommendation:\s*\(data:\s*\{[\s\S]*?\}\)\s*=>\s*api\.post\('\/ai-assistant\/recommendations',\s*data\)/,
    "apiService.requestAiAssistantRecommendation must POST /ai-assistant/recommendations",
  );
  assert.match(
    source,
    /getAiAssistantHistory:\s*\(\)\s*=>\s*api\.get\('\/ai-assistant\/history'\)/,
    "apiService.getAiAssistantHistory must GET /ai-assistant/history",
  );
  assert.match(
    source,
    /getAllAiAssistantHistory:\s*\(\)\s*=>\s*api\.get\('\/ai-assistant\/history\/all'\)/,
    "apiService.getAllAiAssistantHistory must GET /ai-assistant/history/all",
  );
  assert.match(
    source,
    /getAiAssistantHealth:\s*\(\)\s*=>\s*api\.get\('\/ai-assistant\/health'\)/,
    "apiService.getAiAssistantHealth must GET /ai-assistant/health",
  );
});

test("AiAssistantPanel is user-triggered, not auto-fetched on mount (unlike KnowledgeSuggestions)", () => {
  const source = readSource(PANEL);

  assert.doesNotMatch(
    source,
    /useEffect/,
    "the panel must never call the AI assistant automatically on render/prop-change — every request should cost an explicit user click, given the feature's request-limit and cost requirements",
  );
  assert.match(
    source,
    /onClick=\{\(\)\s*=>\s*void handleAsk\(\)\}/,
    "the recommendation request must be wired to an explicit button click",
  );
});

test("AiAssistantPanel always renders a visible advisory-only disclaimer regardless of outcome", () => {
  const source = readSource(PANEL);

  assert.match(
    source,
    /data-testid="ai-assistant-disclaimer"/,
    "the panel must always render a disclaimer element",
  );

  const disclaimerIndex = source.indexOf('data-testid="ai-assistant-disclaimer"');
  const resultComponentIndex = source.indexOf("function AiAssistantResult");
  assert.ok(disclaimerIndex > -1, "the disclaimer element must exist");
  assert.ok(resultComponentIndex > -1, "the result component must exist");
  assert.ok(
    disclaimerIndex < resultComponentIndex,
    "the disclaimer must live in the always-rendered main component body, not inside the status-conditional AiAssistantResult sub-component",
  );
});

test("AiAssistantPanel never calls any endpoint other than the recommendation endpoint (advisory-only, no mutation path)", () => {
  const source = readSource(PANEL);

  const apiCalls = source.match(/apiService\.\w+/g) ?? [];
  assert.deepEqual(
    [...new Set(apiCalls)],
    ["apiService.requestAiAssistantRecommendation"],
    "the panel must only ever call the read/advisory recommendation endpoint — never a work-order, stock, or machine-mutating endpoint",
  );
});

test("AiAssistantPanel structurally separates known facts, probable causes, recommended checks, safety warnings, and uncertainty", () => {
  const source = readSource(PANEL);

  for (const testId of [
    "ai-assistant-known-facts",
    "ai-assistant-probable-causes",
    "ai-assistant-recommended-checks",
    "ai-assistant-safety-warnings",
    "ai-assistant-uncertainty",
  ]) {
    // Rendered either directly (data-testid="...") or via the shared
    // AnswerSection helper (testId="..." forwarded to its own data-testid).
    assert.match(
      source,
      new RegExp(`data-testid="${testId}"|testId="${testId}"`),
      `must render a distinct ${testId} section`,
    );
  }
});

test("AiAssistantPanel renders a distinct message per non-OK status instead of silently showing nothing", () => {
  const source = readSource(PANEL);

  assert.match(source, /result\.status === "disabled"/);
  assert.match(source, /result\.status === "rate_limited"/);
  for (const status of [
    "missing_configuration",
    "invalid_credentials",
    "quota_limited",
    "temporary_failure",
    "timeout",
    "error",
  ]) {
    assert.match(source, new RegExp(`${status}`));
  }
});

test("AiAssistantPanel renders safe backend diagnostics for non-OK assistant responses", () => {
  const source = readSource(PANEL);

  assert.match(source, /data-testid="ai-assistant-diagnostic"/);
  assert.match(source, /diagnostic\.provider/);
  assert.match(source, /diagnostic\.configured/);
  assert.match(source, /diagnostic\.enabled/);
  assert.match(source, /diagnostic\.message/);
  assert.doesNotMatch(source, /apiKey|GEMINI_API_KEY/);
});

test("frontend never references backend-only Gemini secret names", () => {
  const filesToCheck = [
    PANEL,
    "src/services/api.ts",
    ...fs
      .readdirSync(path.join(process.cwd(), "messages"))
      .filter((file) => file.endsWith(".json"))
      .map((file) => path.join("messages", file)),
  ];

  for (const file of filesToCheck) {
    const source = readSource(file);
    assert.doesNotMatch(source, /GEMINI_API_KEY/);
  }
});

test("Operator corrective page renders the AI assistant panel alongside Knowledge Base suggestions", () => {
  const source = readSource(CORRECTIVE_PAGE);

  assert.match(
    source,
    /<AiAssistantPanel\s+machineId=\{selectedMachine \|\| undefined\}\s+faultCode=\{selectedFault\?\.code_panne\}/,
    "the corrective page must pass the selected machine/fault into AiAssistantPanel",
  );
});

test("Technician work-order detail renders the AI assistant panel with machine, work order, and fault code context", () => {
  const source = readSource(TECHNICIAN_DETAIL);

  assert.match(
    source,
    /<AiAssistantPanel\s+machineId=\{machine\?\.\_id\}\s+workOrderId=\{wo\.\_id\}\s+faultCode=\{wo\.code_panne\}/,
    "the technician work-order detail page must pass machine/workOrder/faultCode into AiAssistantPanel",
  );
});

test("all supported locales define the aiAssistant translation namespace with matching keys", () => {
  const locales = ["en", "fr", "ar", "es", "de", "it"];

  const keysByLocale: Record<string, Set<string>> = {};
  for (const locale of locales) {
    const messagesPath = path.join(process.cwd(), "messages", `${locale}.json`);
    const messages = JSON.parse(fs.readFileSync(messagesPath, "utf8"));
    assert.ok(messages.aiAssistant, `${locale}.json must have an aiAssistant namespace`);
    keysByLocale[locale] = new Set(Object.keys(messages.aiAssistant));
  }

  const englishKeys = keysByLocale.en;
  for (const locale of locales) {
    const missing = [...englishKeys].filter((key) => !keysByLocale[locale].has(key));
    assert.deepEqual(missing, [], `${locale}.json is missing aiAssistant keys: ${missing.join(", ")}`);
  }

  const requiredKeys = [
    "title",
    "disclaimer",
    "questionPlaceholder",
    "ask",
    "asking",
    "requestFailed",
    "debugDetails",
    "statusDisabled",
    "statusRateLimited",
    "statusMissingConfiguration",
    "statusInvalidCredentials",
    "statusQuotaLimited",
    "statusTimeout",
    "statusTemporaryFailure",
    "statusUnavailable",
    "knownFacts",
    "probableCauses",
    "recommendedChecks",
    "safetyWarnings",
    "uncertainty",
  ];
  for (const key of requiredKeys) {
    assert.ok(englishKeys.has(key), `en.json aiAssistant is missing required key: ${key}`);
  }
});
