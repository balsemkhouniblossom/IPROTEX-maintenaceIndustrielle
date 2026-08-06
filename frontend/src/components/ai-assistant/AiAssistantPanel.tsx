"use client";

import { useState } from "react";
import { SparklesIcon, ShieldExclamationIcon } from "@heroicons/react/24/outline";
import { useLocale, useTranslations } from "next-intl";
import { apiService } from "@/services/api";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { WidgetErrorFallback } from "@/components/WidgetErrorFallback";

type AiAssistantAnswer = {
  knownFacts: string[];
  probableCauses: string[];
  recommendedChecks: string[];
  safetyWarnings: string[];
  uncertainty: string;
};

type AiAssistantStatus =
  | "ok"
  | "disabled"
  | "missing_configuration"
  | "invalid_credentials"
  | "quota_limited"
  | "temporary_failure"
  | "rate_limited"
  | "timeout"
  | "error";

type AiRecommendationResponse = {
  status: AiAssistantStatus;
  interactionId: string;
  provider: string;
  retryAfterSeconds?: number;
  diagnostic?: {
    enabled: boolean;
    configured: boolean;
    provider: string;
    model?: string;
    status: string;
    message: string;
  };
  answer?: AiAssistantAnswer;
};

/**
 * User-triggered (never auto-fetched, unlike `KnowledgeSuggestions`) so a
 * page render never itself costs an LLM call. Strictly advisory: this panel
 * only ever displays text back to the user — it has no submission path that
 * touches a work order, stock, or machine status, and the disclaimer below
 * is always shown regardless of outcome. Additive to whichever page embeds
 * it: it never reads from or writes into that page's own form state.
 */
type AiAssistantPanelProps = {
  machineId?: string;
  workOrderId?: string;
  faultCode?: string;
};

export default function AiAssistantPanel(props: AiAssistantPanelProps) {
  return (
    <ErrorBoundary
      boundaryName="ai-assistant-panel"
      fallback={(_error, reset) => <WidgetErrorFallback onRetry={reset} />}
    >
      <AiAssistantPanelInner {...props} />
    </ErrorBoundary>
  );
}

function AiAssistantPanelInner({
  machineId,
  workOrderId,
  faultCode,
}: AiAssistantPanelProps) {
  const t = useTranslations("aiAssistant");
  const locale = useLocale();
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AiRecommendationResponse | null>(null);
  const [submitError, setSubmitError] = useState(false);

  const canSubmit = question.trim().length > 0 && !loading;

  async function handleAsk() {
    if (!canSubmit) return;
    setLoading(true);
    setSubmitError(false);
    setResult(null);

    try {
      const response = await apiService.requestAiAssistantRecommendation({
        machineId: machineId || undefined,
        workOrderId: workOrderId || undefined,
        faultCode: faultCode || undefined,
        question: question.trim(),
        locale,
      });
      setResult(response.data as AiRecommendationResponse);
    } catch (error) {
      console.error("Failed to request AI assistant recommendation", error);
      setSubmitError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="panel border border-purple-100 bg-purple-50"
      data-testid="ai-assistant-panel"
    >
      <div className="card-title mb-2 flex items-center gap-2 text-purple-900">
        <SparklesIcon className="w-5 h-5" />
        {t("title")}
      </div>

      <p className="mb-3 flex items-start gap-1.5 text-xs text-purple-800">
        <ShieldExclamationIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span data-testid="ai-assistant-disclaimer">{t("disclaimer")}</span>
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={t("questionPlaceholder")}
          rows={2}
          className="w-full flex-1 rounded-lg border border-purple-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-purple-400 focus:outline-none"
          data-testid="ai-assistant-question-input"
        />
        <button
          type="button"
          onClick={() => void handleAsk()}
          disabled={!canSubmit}
          className="rounded-lg bg-purple-700 px-4 py-2 text-sm font-medium text-white hover:bg-purple-800 disabled:cursor-not-allowed disabled:opacity-50 sm:self-start"
          data-testid="ai-assistant-ask-button"
        >
          {loading ? t("asking") : t("ask")}
        </button>
      </div>

      {submitError ? (
        <p className="mt-3 text-sm text-red-700" data-testid="ai-assistant-request-error">
          {t("requestFailed")}
        </p>
      ) : null}

      {result ? <AiAssistantResult result={result} t={t} /> : null}
    </div>
  );
}

function AiAssistantResult({
  result,
  t,
}: {
  result: AiRecommendationResponse;
  t: ReturnType<typeof useTranslations>;
}) {
  if (result.status === "disabled") {
    return (
      <StatusMessage
        className="text-purple-800"
        testId="ai-assistant-status-disabled"
        message={t("statusDisabled")}
        result={result}
        t={t}
      />
    );
  }

  if (result.status === "rate_limited") {
    return (
      <StatusMessage
        className="text-amber-700"
        testId="ai-assistant-status-rate-limited"
        message={t("statusRateLimited")}
        result={result}
        t={t}
      />
    );
  }

  const statusMessages: Partial<Record<AiAssistantStatus, string>> = {
    missing_configuration: t("statusMissingConfiguration"),
    invalid_credentials: t("statusInvalidCredentials"),
    quota_limited: t("statusQuotaLimited"),
    timeout: t("statusTimeout"),
    temporary_failure: t("statusTemporaryFailure"),
    error: t("statusUnavailable"),
  };
  const statusMessage = statusMessages[result.status];
  if (statusMessage) {
    return (
      <StatusMessage
        className="text-red-700"
        testId="ai-assistant-status-unavailable"
        message={statusMessage}
        result={result}
        t={t}
      />
    );
  }

  const answer = result.answer;
  if (!answer) return null;

  return (
    <div className="mt-4 space-y-3 text-sm" data-testid="ai-assistant-answer">
      <AnswerSection
        testId="ai-assistant-known-facts"
        label={t("knownFacts")}
        items={answer.knownFacts}
      />
      <AnswerSection
        testId="ai-assistant-probable-causes"
        label={t("probableCauses")}
        items={answer.probableCauses}
      />
      <AnswerSection
        testId="ai-assistant-recommended-checks"
        label={t("recommendedChecks")}
        items={answer.recommendedChecks}
      />
      {answer.safetyWarnings.length > 0 ? (
        <div
          className="rounded-lg border border-red-200 bg-red-50 p-3"
          data-testid="ai-assistant-safety-warnings"
        >
          <p className="mb-1 font-semibold text-red-800">{t("safetyWarnings")}</p>
          <ul className="list-disc space-y-1 pl-5 text-red-800">
            {answer.safetyWarnings.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {answer.uncertainty ? (
        <p className="italic text-slate-600" data-testid="ai-assistant-uncertainty">
          <span className="font-semibold not-italic">{t("uncertainty")}: </span>
          {answer.uncertainty}
        </p>
      ) : null}
    </div>
  );
}

function StatusMessage({
  className,
  testId,
  message,
  result,
  t,
}: {
  className: string;
  testId: string;
  message: string;
  result: AiRecommendationResponse;
  t: ReturnType<typeof useTranslations>;
}) {
  const diagnostic = result.diagnostic;

  return (
    <div className={`mt-3 text-sm ${className}`} data-testid={testId}>
      <p>{message}</p>
      {diagnostic ? (
        <p
          className="mt-1 rounded-md bg-white/70 px-2 py-1 text-xs text-slate-700"
          data-testid="ai-assistant-diagnostic"
        >
          {t("debugDetails")}: status={result.status}; provider=
          {diagnostic.provider || result.provider}; configured=
          {String(diagnostic.configured)}; enabled={String(diagnostic.enabled)}
          {diagnostic.model ? `; model=${diagnostic.model}` : ''}; reason=
          {diagnostic.message}; interaction={result.interactionId}
        </p>
      ) : null}
    </div>
  );
}

function AnswerSection({
  testId,
  label,
  items,
}: {
  testId: string;
  label: string;
  items: string[];
}) {
  if (items.length === 0) return null;

  return (
    <div data-testid={testId}>
      <p className="mb-1 font-semibold text-slate-800">{label}</p>
      <ul className="list-disc space-y-1 pl-5 text-slate-700">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
