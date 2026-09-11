"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import AiDataProvenance from "@/components/ai-anomaly/AiDataProvenance";
import Pagination from "@/components/Pagination";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { LineChartCard } from "@/components/charts/LineChartCard";
import { Modal } from "@/components/Modal";
import {
  ToastNotification,
  type ToastNotificationState,
} from "@/components/ToastNotification";
import { useAuth } from "@/contexts/AuthContext";
import { apiService, quiet } from "@/services/api";
import { extractApiErrorDetails } from "@/services/apiErrors";
import {
  AI_ANOMALY_LIMITATION_NOTICE,
  AI_ANOMALY_RISK_INDICATORS,
  type AiAnomalyAnalysis,
  type AiAnomalyInputSource,
  type AiAnomalyMachineRecord,
  type AiAnomalyRiskLevel,
  type AiAnomalyRuntimeModel,
  type AiDatasetReplayCatalog,
  type AiAnomalyValidationStatus,
  buildAiAnomalyMachineOptions,
  buildRiskScoreChartData,
  canValidateAiAnomaly,
  isAiServiceUnavailable,
  machineDisplayName,
  sourceLabelKey,
  summarizeAiAnomalyAnalyses,
} from "@/services/aiAnomaly";
import { normalizeApiItems, readPaginationMeta } from "@/services/pagination";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  NoSymbolIcon,
  ShieldExclamationIcon,
  SparklesIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import { useLocale, useTranslations } from "next-intl";

const PAGE_LIMIT = 10;
const RISK_LEVELS: Array<"ALL" | AiAnomalyRiskLevel> = [
  "ALL",
  "NORMAL",
  "MONITOR",
  "HIGH",
  "CRITICAL",
];
const VALIDATION_STATUSES: Array<"ALL" | AiAnomalyValidationStatus> = [
  "ALL",
  "PENDING",
  "CONFIRMED",
  "REJECTED",
];

const RISK_ICONS = {
  NORMAL: CheckCircleIcon,
  MONITOR: EyeIcon,
  HIGH: ExclamationTriangleIcon,
  CRITICAL: ShieldExclamationIcon,
} satisfies Record<AiAnomalyRiskLevel, typeof CheckCircleIcon>;

function riskIcon(level: AiAnomalyRiskLevel | null) {
  return level ? RISK_ICONS[level] : ShieldExclamationIcon;
}

function RiskBadge({
  level,
  label,
}: Readonly<{ level: AiAnomalyRiskLevel; label: string }>) {
  const Icon = RISK_ICONS[level];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${AI_ANOMALY_RISK_INDICATORS[level].className}`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </span>
  );
}

function booleanBadgeClass(value: boolean, urgent?: boolean): string {
  if (!value) return "border-slate-200 bg-slate-50 text-slate-700";
  return urgent
    ? "border-red-200 bg-red-50 text-red-800"
    : "border-amber-200 bg-amber-50 text-amber-900";
}

function BooleanBadge({
  value,
  trueLabel,
  falseLabel,
  urgent,
}: Readonly<{
  value: boolean;
  trueLabel: string;
  falseLabel: string;
  urgent?: boolean;
}>) {
  const Icon = value ? ExclamationTriangleIcon : CheckCircleIcon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${booleanBadgeClass(value, urgent)}`}
    >
      <Icon className="h-4 w-4" />
      {value ? trueLabel : falseLabel}
    </span>
  );
}

export default function AiAnomalyMonitoringPage() {
  return (
    <ProtectedRoute allowedRoles={["admin", "technician"]}>
      <AiAnomalyMonitoringContent />
    </ProtectedRoute>
  );
}

function AiAnomalyMonitoringContent() {
  const t = useTranslations("aiAnomaly");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const { user } = useAuth();
  const [analyses, setAnalyses] = useState<AiAnomalyAnalysis[]>([]);
  const [models, setModels] = useState<AiAnomalyRuntimeModel[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [changingModel, setChangingModel] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] =
    useState<AiAnomalyRuntimeModel | null>(null);
  const [modelToDisable, setModelToDisable] =
    useState<AiAnomalyRuntimeModel | null>(null);
  const [replayOpen, setReplayOpen] = useState(false);
  const [replayCatalog, setReplayCatalog] = useState<AiDatasetReplayCatalog | null>(null);
  const [replaySamples, setReplaySamples] = useState<string[]>([]);
  const [replayForm, setReplayForm] = useState({ experiment: "", timestamp: "", machineId: "" });
  const [replayLoading, setReplayLoading] = useState(false);
  const [machines, setMachines] = useState(
    [] as ReturnType<typeof buildAiAnomalyMachineOptions>,
  );
  const [selectedAnalysis, setSelectedAnalysis] =
    useState<AiAnomalyAnalysis | null>(null);
  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [submittingValidation, setSubmittingValidation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serviceUnavailable, setServiceUnavailable] = useState(false);
  const [toast, setToast] = useState<ToastNotificationState | null>(null);
  const [filters, setFilters] = useState({
    machineId: "",
    riskLevel: "ALL" as "ALL" | AiAnomalyRiskLevel,
    validationStatus: "ALL" as "ALL" | AiAnomalyValidationStatus,
    dateFrom: "",
    dateTo: "",
  });
  const [validationForm, setValidationForm] = useState({
    status: "CONFIRMED" as "CONFIRMED" | "REJECTED",
    comment: "",
  });

  const formatDateTime = useCallback(
    (value: string) =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value)),
    [locale],
  );

  const buildAnalysesQuery = useCallback(
    () => ({
      page,
      limit: PAGE_LIMIT,
      machine_id: filters.machineId || undefined,
      risk_level: filters.riskLevel === "ALL" ? undefined : filters.riskLevel,
      validation_status:
        filters.validationStatus === "ALL"
          ? undefined
          : filters.validationStatus,
      input_source: "DATASET_REPLAY" as const,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
    }),
    [
      filters.dateFrom,
      filters.dateTo,
      filters.machineId,
      filters.riskLevel,
      filters.validationStatus,
      page,
    ],
  );

  const loadData = useCallback(async () => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setServiceUnavailable(false);

    try {
      const [analysesResponse, machinesResponse] = await Promise.all([
        apiService.getAiAnomalyAnalyses(buildAnalysesQuery(), {
          signal: controller.signal,
        }),
        apiService
          .getMachines({ page: 1, limit: 100 }, quiet())
          .catch(() => null),
      ]);

      const items = normalizeApiItems<AiAnomalyAnalysis>(analysesResponse.data);
      const machineRecords = machinesResponse
        ? normalizeApiItems<AiAnomalyMachineRecord>(machinesResponse.data)
        : [];
      setMachines(buildAiAnomalyMachineOptions(items, machineRecords));
      setAnalyses(items);
      const pagination = readPaginationMeta(analysesResponse.data);
      setTotalItems(Number(analysesResponse.data?.totalItems ?? items.length));
      setTotalPages(pagination?.totalPages ?? 1);
    } catch (err) {
      const details = extractApiErrorDetails(err, t("states.errorDescription"));
      setError(details.message);
      setServiceUnavailable(isAiServiceUnavailable(err));
    } finally {
      setLoading(false);
      setRetrying(false);
    }

    return () => controller.abort();
  }, [buildAnalysesQuery, t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const loadModels = useCallback(async () => {
    try {
      const response = await apiService.getAiAnomalyModels();
      setModels((response.data?.models ?? []) as AiAnomalyRuntimeModel[]);
      setModelsError(null);
    } catch (err) {
      setModelsError(
        extractApiErrorDetails(err, t("models.unavailable")).message,
      );
    }
  }, [t]);

  useEffect(() => {
    void loadModels();
    const timer = window.setInterval(() => void loadModels(), 10000);
    return () => window.clearInterval(timer);
  }, [loadModels]);

  const changeModelState = async (
    model: AiAnomalyRuntimeModel,
    enable: boolean,
  ) => {
    setChangingModel(model.id);
    try {
      await (enable
        ? apiService.startAiAnomalyModel(model.id)
        : apiService.stopAiAnomalyModel(model.id));
      await loadModels();
      setToast({
        type: "success",
        message: t(enable ? "models.started" : "models.stopped", {
          name: model.name,
        }),
      });
    } catch (err) {
      setToast({
        type: "error",
        message: extractApiErrorDetails(err, t("models.actionFailed")).message,
      });
    } finally {
      setChangingModel(null);
    }
  };

  const openReplay = async () => {
    setReplayOpen(true);
    setReplayLoading(true);
    try {
      const response = await apiService.getAiDatasetReplayCatalog();
      const catalog = response.data as AiDatasetReplayCatalog;
      setReplayCatalog(catalog);
      const experiment = catalog.experiments.find((item) => item.supported)?.id ?? "";
      if (experiment) {
        const samplesResponse = await apiService.getAiDatasetReplaySamples(experiment);
        const samples = (samplesResponse.data?.samples ?? []) as string[];
        setReplaySamples(samples);
        setReplayForm((current) => ({ ...current, experiment, timestamp: samples[0] ?? "" }));
      }
    } catch (err) {
      setToast({ type: "error", message: extractApiErrorDetails(err, t("replay.loadFailed")).message });
      setReplayOpen(false);
    } finally {
      setReplayLoading(false);
    }
  };

  const runReplay = async () => {
    if (!replayForm.machineId || !replayForm.experiment || !replayForm.timestamp) return;
    setReplayLoading(true);
    try {
      const response = await apiService.replayAiDatasetSample({
        machine_id: replayForm.machineId,
        experiment: replayForm.experiment,
        timestamp: replayForm.timestamp,
      });
      const created = (response.data?.analyses ?? []) as AiAnomalyAnalysis[];
      setReplayOpen(false);
      await loadData();
      if (created[0]) setSelectedAnalysis(created[0]);
      setToast({ type: "success", message: t("replay.completed") });
    } catch (err) {
      setToast({ type: "error", message: extractApiErrorDetails(err, t("replay.failed")).message });
    } finally {
      setReplayLoading(false);
    }
  };

  const visibleAnalyses = analyses;

  const summary = useMemo(
    () => summarizeAiAnomalyAnalyses(visibleAnalyses),
    [visibleAnalyses],
  );
  const chartData = useMemo(
    () => buildRiskScoreChartData(visibleAnalyses),
    [visibleAnalyses],
  );

  const openDetails = (analysis: AiAnomalyAnalysis) => {
    setSelectedAnalysis(analysis);
    setValidationForm({ status: "CONFIRMED", comment: "" });
  };

  const submitValidation = async () => {
    if (
      !selectedAnalysis ||
      !canValidateAiAnomaly(user?.role, selectedAnalysis)
    ) {
      return;
    }
    setSubmittingValidation(true);
    try {
      const response = await apiService.validateAiAnomalyAnalysis(
        selectedAnalysis.analysis_id,
        {
          validation_status: validationForm.status,
          validation_comment: validationForm.comment || undefined,
        },
      );
      const updated = response.data as AiAnomalyAnalysis;
      setAnalyses((current) =>
        current.map((analysis) =>
          analysis.analysis_id === updated.analysis_id ? updated : analysis,
        ),
      );
      setSelectedAnalysis(updated);
      setToast({ type: "success", message: t("validation.saved") });
    } catch (err) {
      const details = extractApiErrorDetails(err, t("validation.failed"));
      setToast({ type: "error", message: details.message });
    } finally {
      setSubmittingValidation(false);
    }
  };

  const latestRiskIcon = riskIcon(summary.latestRiskLevel);

  return (
    <DashboardLayout title={t("title")}>
      <ToastNotification
        notification={toast}
        closeLabel={tCommon("close")}
        onClose={() => setToast(null)}
      />

      <div className="space-y-6">
        <section className="panel">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                {t("models.title")}
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                {t("models.subtitle")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {user?.role === "admin" ? <button type="button" className="btn-primary" onClick={() => void openReplay()}>{t("replay.open")}</button> : null}
              <button type="button" className="btn-secondary" onClick={() => void loadModels()}>{t("models.refresh")}</button>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <DetailField
              label={t("models.service")}
              value={modelsError ? t("models.offline") : t("models.online")}
            />
            <DetailField
              label={t("models.readiness")}
              value={
                models.some((model) => model.loaded)
                  ? t("models.ready")
                  : tCommon("notAvailable")
              }
            />
            <DetailField
              label={t("models.loaded")}
              value={models.filter((model) => model.loaded).length}
            />
            <DetailField
              label={t("models.active")}
              value={models.filter((model) => model.enabled).length}
            />
          </div>
          {modelsError ? (
            <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              {modelsError}
            </p>
          ) : null}
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {models.map((model) => (
              <article
                key={model.id}
                className="rounded-xl border border-slate-200 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-bold text-slate-900">{model.name}</h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {model.purpose}
                    </p>
                  </div>
                  <span className="rounded-full border px-2.5 py-1 text-xs font-semibold">
                    {model.status}
                  </span>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <DetailField
                    label={t("models.version")}
                    value={model.modelVersion}
                  />
                  <DetailField
                    label={t("models.loadedState")}
                    value={model.loaded ? t("boolean.yes") : t("boolean.no")}
                  />
                  <DetailField
                    label={t("models.lastExecution")}
                    value={
                      model.lastExecutionAt
                        ? formatDateTime(model.lastExecutionAt)
                        : tCommon("notAvailable")
                    }
                  />
                  <DetailField
                    label={t("models.duration")}
                    value={
                      model.lastExecutionDurationMs == null
                        ? tCommon("notAvailable")
                        : `${model.lastExecutionDurationMs} ms`
                    }
                  />
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setSelectedModel(model)}
                  >
                    {t("models.viewDetails")}
                  </button>
                  {user?.role === "admin" ? (
                    <button
                      type="button"
                      className={model.enabled ? "btn-danger" : "btn-primary"}
                      disabled={changingModel === model.id}
                      onClick={() =>
                        model.enabled
                          ? setModelToDisable(model)
                          : void changeModelState(model, true)
                      }
                    >
                      {changingModel === model.id
                        ? t("models.changing")
                        : t(model.enabled ? "models.stop" : "models.start")}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          <p className="mt-4 text-sm text-slate-600">
            {t("models.inputNotice")}
          </p>
        </section>
        <section className="panel">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-800">
                {t("heading")}
              </h1>
              <p className="mt-1 max-w-4xl text-sm text-slate-600">
                {t("limitationNotice")}
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800">
              <SparklesIcon className="h-5 w-5" />
              {t("sources.datasetReplay")}
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <SummaryCard
            title={t("summary.latestRiskScore")}
            value={summary.latestRiskScore ?? tCommon("notAvailable")}
            icon={latestRiskIcon}
            detail={
              summary.latestRiskLevel
                ? t(`riskLevels.${summary.latestRiskLevel}`)
                : t("states.noRisk")
            }
          />
          <SummaryCard
            title={t("summary.riskLevel")}
            value={
              summary.latestRiskLevel
                ? t(`riskLevels.${summary.latestRiskLevel}`)
                : tCommon("notAvailable")
            }
            icon={latestRiskIcon}
            detail={t("summary.latestRecord")}
          />
          <SummaryCard
            title={t("summary.persistentAlerts")}
            value={summary.persistentAlerts}
            icon={ExclamationTriangleIcon}
            detail={t("summary.needsReview")}
          />
          <SummaryCard
            title={t("summary.pendingValidation")}
            value={summary.pendingValidation}
            icon={EyeIcon}
            detail={t("validation.pending")}
          />
          <SummaryCard
            title={t("summary.confirmedRejected")}
            value={`${summary.confirmedAnalyses} / ${summary.rejectedAnalyses}`}
            icon={CheckCircleIcon}
            detail={t("summary.confirmedRejectedDetail")}
          />
        </section>

        <AiAnomalyFiltersSection
          filters={filters}
          machines={machines}
          machineLabel={t("filters.machine")}
          allMachinesLabel={t("filters.allMachines")}
          riskLevelLabel={t("filters.riskLevel")}
          validationStatusLabel={t("filters.validationStatus")}
          riskLevelOptionLabel={(level) =>
            level === "ALL"
              ? t("filters.allRiskLevels")
              : t(`riskLevels.${level}`)
          }
          validationOptionLabel={(status) =>
            status === "ALL"
              ? t("filters.allValidationStatuses")
              : t(`validation.${status}`)
          }
          dateFromLabel={t("filters.dateFrom")}
          dateToLabel={t("filters.dateTo")}
          onChange={(patch) => {
            setPage(1);
            setFilters((current) => ({ ...current, ...patch }));
          }}
        />

        {loading ? <LoadingPanel label={t("states.loading")} /> : null}
        {!loading && error ? (
          <ErrorPanel
            title={
              serviceUnavailable
                ? t("states.unavailableTitle")
                : t("states.errorTitle")
            }
            message={error}
            retryLabel={retrying ? t("states.retrying") : t("states.retry")}
            retrying={retrying}
            onRetry={() => {
              setRetrying(true);
              void loadData();
            }}
          />
        ) : null}
        {!loading && !error && visibleAnalyses.length === 0 ? (
          <EmptyPanel
            title={t("states.emptyTitle")}
            description={t("states.emptyDescription")}
          />
        ) : null}
        {!loading && !error && visibleAnalyses.length > 0 ? (
          <>
            <LineChartCard
              title={t("chart.title")}
              data={chartData}
              emptyLabel={t("chart.empty")}
              color="var(--primary)"
              valueFormatter={(value) => `${value}/100`}
            />

            <AiAnomalyResultsTable
              title={t("table.title")}
              chronologicalLabel={t("table.chronological")}
              headerLabels={{
                machine: t("table.machine"),
                timestamp: t("table.timestamp"),
                anomalyScore: t("table.anomalyScore"),
                riskScore: t("table.riskScore"),
                riskLevel: t("table.riskLevel"),
                rawAnomaly: t("table.rawAnomaly"),
                persistentAlert: t("table.persistentAlert"),
                modelVersion: t("table.modelVersion"),
                source: t("table.source"),
                reasonCodes: t("table.reasonCodes"),
                validationStatus: t("table.validationStatus"),
              }}
              analyses={visibleAnalyses}
              machines={machines}
              onOpenDetails={openDetails}
              formatDateTime={formatDateTime}
              riskLevelLabel={(level) => t(`riskLevels.${level}`)}
              sourceLabel={(source) =>
                t(sourceLabelKey(source as AiAnomalyInputSource))
              }
              validationLabel={(status) => t(`validation.${status}`)}
              yesLabel={t("boolean.yes")}
              noLabel={t("boolean.no")}
              activeLabel={t("persistentAlert.active")}
              clearLabel={t("persistentAlert.clear")}
              notAvailableLabel={tCommon("notAvailable")}
              page={page}
              totalPages={totalPages}
              totalItems={totalItems}
              limit={PAGE_LIMIT}
              onPageChange={setPage}
            />
          </>
        ) : null}
      </div>

      <Modal
        isOpen={Boolean(modelToDisable)}
        onClose={() => setModelToDisable(null)}
        title={t("models.disableTitle")}
        size="sm"
      >
        {modelToDisable ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              {t("models.confirmStop", { name: modelToDisable.name })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setModelToDisable(null)}
              >
                {tCommon("cancel")}
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={changingModel === modelToDisable.id}
                onClick={() =>
                  void changeModelState(modelToDisable, false).then(() =>
                    setModelToDisable(null),
                  )
                }
              >
                {changingModel === modelToDisable.id
                  ? t("models.changing")
                  : t("models.stop")}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        isOpen={Boolean(selectedModel)}
        onClose={() => setSelectedModel(null)}
        title={t("models.detailsTitle")}
        size="xl"
      >
        {selectedModel ? (
          <div className="space-y-5">
            <dl className="grid gap-3 md:grid-cols-2">
              <DetailField
                label={t("models.modelName")}
                value={selectedModel.name}
              />
              <DetailField
                label={t("models.task")}
                value={selectedModel.task}
              />
              <DetailField
                label={t("models.framework")}
                value={selectedModel.framework}
              />
              <DetailField
                label={t("models.dataset")}
                value={selectedModel.sourceDataset}
              />
              <DetailField
                label={t("models.method")}
                value={selectedModel.selectedMethod ?? tCommon("notAvailable")}
              />
              <DetailField
                label={t("models.validationScope")}
                value={selectedModel.validationScope}
              />
              <DetailField
                label={t("models.generalization")}
                value={selectedModel.generalizationStatus}
              />
            </dl>
            <section>
              <h3 className="text-sm font-semibold text-slate-900">
                {t("models.howItWorks")}
              </h3>
              <p className="mt-2 text-sm text-slate-600">
                {t("models.componentsExplanation")}
              </p>
            </section>
            <section>
              <h3 className="text-sm font-semibold text-slate-900">
                {t("models.validation")}
              </h3>
              <dl className="mt-2 grid gap-3 sm:grid-cols-2">
                <DetailField
                  label={t("models.meanPrecision")}
                  value={formatOptionalMetric(
                    selectedModel.validationMetrics.mean_precision,
                  )}
                />
                <DetailField
                  label={t("models.meanRecall")}
                  value={formatOptionalMetric(
                    selectedModel.validationMetrics.mean_recall,
                  )}
                />
                <DetailField
                  label={t("models.meanF1")}
                  value={formatOptionalMetric(
                    selectedModel.validationMetrics.mean_f1,
                  )}
                />
                <DetailField
                  label={t("models.meanPrAuc")}
                  value={formatOptionalMetric(
                    selectedModel.validationMetrics.mean_pr_auc,
                  )}
                />
              </dl>
            </section>
            <details className="rounded-md border border-slate-200 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-900">
                {t("models.technicalDetails")}
              </summary>
              <dl className="mt-3 grid gap-3 md:grid-cols-2">
                <DetailField
                  label={t("models.features")}
                  value={selectedModel.featureOrder.join(", ")}
                />
                <DetailField
                  label={t("models.runtimeId")}
                  value={selectedModel.id}
                />
              </dl>
            </details>
          </div>
        ) : null}
      </Modal>
      <Modal isOpen={replayOpen} onClose={() => setReplayOpen(false)} title={t("replay.title")}>
        <div className="space-y-4">
          <AiDataProvenance
            items={[
              {
                label: t("replay.source"),
                value: replayCatalog?.dataset ?? "IMS Bearing",
              },
              {
                label: t("table.source"),
                value: t("sources.datasetReplay"),
              },
            ]}
            notice={t("replay.notice")}
          />
          <label className="block text-sm font-medium text-slate-700">{t("replay.experiment")}
            <select className="input mt-1 w-full" value={replayForm.experiment} disabled={replayLoading} onChange={(event) => setReplayForm((current) => ({ ...current, experiment: event.target.value }))}>
              {(replayCatalog?.experiments ?? []).map((item) => <option key={item.id} value={item.id} disabled={!item.supported}>{item.id}{item.supported ? "" : ` — ${t("replay.notValidated")}`}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">{t("replay.sample")}
            <select className="input mt-1 w-full" value={replayForm.timestamp} disabled={replayLoading} onChange={(event) => setReplayForm((current) => ({ ...current, timestamp: event.target.value }))}>
              {replaySamples.map((sample) => <option key={sample} value={sample}>{formatDateTime(sample)}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">{t("replay.demoMachine")}
            <select className="input mt-1 w-full" value={replayForm.machineId} disabled={replayLoading} onChange={(event) => setReplayForm((current) => ({ ...current, machineId: event.target.value }))}>
              <option value="">{t("replay.selectMachine")}</option>
              {machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.label}</option>)}
            </select>
          </label>
          <p className="text-xs text-slate-500">{t("replay.demoAssociationNotice")}</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setReplayOpen(false)}>{tCommon("cancel")}</button>
            <button type="button" className="btn-primary" disabled={replayLoading || !replayForm.machineId || !replayForm.timestamp} onClick={() => void runReplay()}>{replayLoading ? t("replay.running") : t("replay.run")}</button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(selectedAnalysis)}
        onClose={() => setSelectedAnalysis(null)}
        title={t("details.title")}
        size="xl"
      >
        {selectedAnalysis ? (
          <AiAnomalyDetailsPanel
            analysis={selectedAnalysis}
            machines={machines}
            t={t}
            tCommon={tCommon}
            userRole={user?.role}
            formatDateTime={formatDateTime}
            validationForm={validationForm}
            setValidationForm={setValidationForm}
            submitValidation={submitValidation}
            submittingValidation={submittingValidation}
          />
        ) : null}
      </Modal>
    </DashboardLayout>
  );
}

function AiAnomalyDetailsPanel({
  analysis,
  machines,
  t,
  tCommon,
  userRole,
  formatDateTime,
  validationForm,
  setValidationForm,
  submitValidation,
  submittingValidation,
}: Readonly<{
  analysis: AiAnomalyAnalysis;
  machines: ReturnType<typeof buildAiAnomalyMachineOptions>;
  t: ReturnType<typeof useTranslations>;
  tCommon: ReturnType<typeof useTranslations>;
  userRole: string | undefined;
  formatDateTime: (value: string) => string;
  validationForm: { status: "CONFIRMED" | "REJECTED"; comment: string };
  setValidationForm: React.Dispatch<
    React.SetStateAction<{ status: "CONFIRMED" | "REJECTED"; comment: string }>
  >;
  submitValidation: () => void;
  submittingValidation: boolean;
}>) {
  const canValidate = canValidateAiAnomaly(userRole, analysis);
  return (
    <div className="space-y-5">
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
        {AI_ANOMALY_LIMITATION_NOTICE}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <DetailField
          label={t("table.machine")}
          value={machineDisplayName(analysis.machine_id, machines)}
        />
        <DetailField
          label={t("table.timestamp")}
          value={formatDateTime(analysis.measurement_timestamp)}
        />
        <DetailField
          label={t("details.componentZScore")}
          value={analysis.component_scores.zScore.toFixed(3)}
        />
        <DetailField
          label={t("details.componentIsolationForest")}
          value={analysis.component_scores.isolationForest.toFixed(3)}
        />
        <DetailField
          label={t("table.modelVersion")}
          value={analysis.model_version}
        />
        <DetailField
          label={t("table.source")}
          value={t(sourceLabelKey(analysis.input_source))}
        />
        <DetailField
          label={t("details.datasetOrigin")}
          value={t("details.imsDataset")}
        />
        <DetailField label={t("details.validationScope")} value="1st_test" />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">
          {t("details.reasonCodes")}
        </h3>
        <div className="flex flex-wrap gap-2">
          {analysis.reason_codes.length ? (
            analysis.reason_codes.map((code) => (
              <span
                key={code}
                className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700"
              >
                {code}
              </span>
            ))
          ) : (
            <span className="text-sm text-slate-500">
              {tCommon("notAvailable")}
            </span>
          )}
        </div>
      </div>

      <div className="rounded-md border border-slate-200 p-3">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">
          {t("validation.title")}
        </h3>
        {canValidate ? (
          <AiAnomalyValidationForm
            t={t}
            tCommon={tCommon}
            validationForm={validationForm}
            setValidationForm={setValidationForm}
            submitValidation={submitValidation}
            submittingValidation={submittingValidation}
          />
        ) : (
          <p className="text-sm text-slate-600">
            {t("validation.alreadyValidated", {
              status: t(`validation.${analysis.validation_status}`),
            })}
          </p>
        )}
      </div>
    </div>
  );
}

function AiAnomalyValidationForm({
  t,
  tCommon,
  validationForm,
  setValidationForm,
  submitValidation,
  submittingValidation,
}: Readonly<{
  t: ReturnType<typeof useTranslations>;
  tCommon: ReturnType<typeof useTranslations>;
  validationForm: { status: "CONFIRMED" | "REJECTED"; comment: string };
  setValidationForm: React.Dispatch<
    React.SetStateAction<{ status: "CONFIRMED" | "REJECTED"; comment: string }>
  >;
  submitValidation: () => void;
  submittingValidation: boolean;
}>) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`btn-secondary ${validationForm.status === "CONFIRMED" ? "ring-2 ring-green-500" : ""}`}
          onClick={() =>
            setValidationForm((current) => ({
              ...current,
              status: "CONFIRMED",
            }))
          }
        >
          <CheckCircleIcon className="h-4 w-4" />
          {t("validation.confirm")}
        </button>
        <button
          type="button"
          className={`btn-secondary ${validationForm.status === "REJECTED" ? "ring-2 ring-red-500" : ""}`}
          onClick={() =>
            setValidationForm((current) => ({ ...current, status: "REJECTED" }))
          }
        >
          <XCircleIcon className="h-4 w-4" />
          {t("validation.reject")}
        </button>
      </div>
      <label className="block text-sm font-medium text-slate-700">
        {t("validation.comment")}
        <textarea
          className="input-field mt-1 min-h-24"
          value={validationForm.comment}
          onChange={(event) =>
            setValidationForm((current) => ({
              ...current,
              comment: event.target.value,
            }))
          }
          maxLength={1000}
        />
      </label>
      <button
        type="button"
        className="btn-primary"
        disabled={submittingValidation}
        onClick={submitValidation}
      >
        {submittingValidation ? tCommon("saving") : t("validation.save")}
      </button>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  icon: Icon,
  detail,
}: Readonly<{
  title: string;
  value: React.ReactNode;
  icon: typeof CheckCircleIcon;
  detail: string;
}>) {
  return (
    <div className="panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-600">{title}</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{value}</p>
          <p className="mt-1 text-xs text-slate-500">{detail}</p>
        </div>
        <Icon className="h-7 w-7 text-blue-600" />
      </div>
    </div>
  );
}

function DetailField({
  label,
  value,
}: Readonly<{ label: string; value: React.ReactNode }>) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <dt className="text-xs font-semibold uppercase text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium text-slate-800">{value}</dd>
    </div>
  );
}

function LoadingPanel({ label }: Readonly<{ label: string }>) {
  return (
    <div className="panel flex min-h-64 items-center justify-center">
      <div className="text-center">
        <div className="mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600" />
        <p className="mt-3 text-sm font-medium text-slate-600">{label}</p>
      </div>
    </div>
  );
}

function ErrorPanel({
  title,
  message,
  retryLabel,
  retrying,
  onRetry,
}: Readonly<{
  title: string;
  message: string;
  retryLabel: string;
  retrying: boolean;
  onRetry: () => void;
}>) {
  return (
    <div className="panel border-amber-200 bg-amber-50">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <NoSymbolIcon className="mt-0.5 h-6 w-6 text-amber-700" />
          <div>
            <h2 className="font-semibold text-amber-900">{title}</h2>
            <p className="mt-1 text-sm text-amber-800">{message}</p>
          </div>
        </div>
        <button
          type="button"
          className="btn-secondary"
          disabled={retrying}
          onClick={onRetry}
        >
          {retryLabel}
        </button>
      </div>
    </div>
  );
}

function EmptyPanel({
  title,
  description,
}: Readonly<{ title: string; description: string }>) {
  return (
    <div className="panel py-12 text-center">
      <EyeIcon className="mx-auto h-10 w-10 text-slate-400" />
      <h2 className="mt-3 text-lg font-semibold text-slate-800">{title}</h2>
      <p className="mt-1 text-sm text-slate-600">{description}</p>
    </div>
  );
}

function AiAnomalyResultsTable({
  title,
  chronologicalLabel,
  headerLabels,
  analyses,
  machines,
  onOpenDetails,
  formatDateTime,
  riskLevelLabel,
  sourceLabel,
  validationLabel,
  yesLabel,
  noLabel,
  activeLabel,
  clearLabel,
  notAvailableLabel,
  page,
  totalPages,
  totalItems,
  limit,
  onPageChange,
}: Readonly<{
  title: string;
  chronologicalLabel: string;
  headerLabels: {
    machine: string;
    timestamp: string;
    anomalyScore: string;
    riskScore: string;
    riskLevel: string;
    rawAnomaly: string;
    persistentAlert: string;
    modelVersion: string;
    source: string;
    reasonCodes: string;
    validationStatus: string;
  };
  analyses: AiAnomalyAnalysis[];
  machines: ReturnType<typeof buildAiAnomalyMachineOptions>;
  onOpenDetails: (analysis: AiAnomalyAnalysis) => void;
  formatDateTime: (value: string) => string;
  riskLevelLabel: (level: AiAnomalyRiskLevel) => string;
  sourceLabel: (source: AiAnomalyInputSource) => string;
  validationLabel: (status: AiAnomalyValidationStatus) => string;
  yesLabel: string;
  noLabel: string;
  activeLabel: string;
  clearLabel: string;
  notAvailableLabel: string;
  page: number;
  totalPages: number;
  totalItems: number;
  limit: number;
  onPageChange: (page: number) => void;
}>) {
  return (
    <section className="panel">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="card-title">{title}</h2>
        <span className="text-sm text-slate-500">{chronologicalLabel}</span>
      </div>
      <div className="wide-table-scroll">
        <table className="table wide-table">
          <thead>
            <tr>
              <th>{headerLabels.machine}</th>
              <th>{headerLabels.timestamp}</th>
              <th>{headerLabels.anomalyScore}</th>
              <th>{headerLabels.riskScore}</th>
              <th>{headerLabels.riskLevel}</th>
              <th>{headerLabels.rawAnomaly}</th>
              <th>{headerLabels.persistentAlert}</th>
              <th>{headerLabels.modelVersion}</th>
              <th>{headerLabels.source}</th>
              <th>{headerLabels.reasonCodes}</th>
              <th>{headerLabels.validationStatus}</th>
            </tr>
          </thead>
          <tbody>
            {analyses.map((analysis) => (
              <tr key={analysis.analysis_id}>
                <td>
                  <button
                    type="button"
                    className="font-semibold text-blue-700 hover:text-blue-900"
                    onClick={() => onOpenDetails(analysis)}
                  >
                    {machineDisplayName(analysis.machine_id, machines)}
                  </button>
                </td>
                <td>{formatDateTime(analysis.measurement_timestamp)}</td>
                <td>{analysis.anomaly_score.toFixed(3)}</td>
                <td>{Math.round(analysis.risk_score)}/100</td>
                <td>
                  <RiskBadge
                    level={analysis.risk_level}
                    label={riskLevelLabel(analysis.risk_level)}
                  />
                </td>
                <td>
                  <BooleanBadge
                    value={analysis.raw_anomaly}
                    trueLabel={yesLabel}
                    falseLabel={noLabel}
                  />
                </td>
                <td>
                  <BooleanBadge
                    value={analysis.persistent_alert}
                    trueLabel={activeLabel}
                    falseLabel={clearLabel}
                    urgent
                  />
                </td>
                <td>{analysis.model_version}</td>
                <td>{sourceLabel(analysis.input_source)}</td>
                <td>
                  {formatReasonCodes(analysis.reason_codes, notAvailableLabel)}
                </td>
                <td>{validationLabel(analysis.validation_status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-6">
        <Pagination
          page={page}
          totalPages={totalPages}
          totalItems={totalItems}
          limit={limit}
          onPageChange={onPageChange}
        />
      </div>
    </section>
  );
}

function formatReasonCodes(codes: string[], notAvailableLabel: string): string {
  return codes.length ? codes.join(", ") : notAvailableLabel;
}

function formatOptionalMetric(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(3)
    : "—";
}

type AiAnomalyFilters = {
  machineId: string;
  riskLevel: "ALL" | AiAnomalyRiskLevel;
  validationStatus: "ALL" | AiAnomalyValidationStatus;
  dateFrom: string;
  dateTo: string;
};

function AiAnomalyFiltersSection({
  filters,
  machines,
  machineLabel,
  allMachinesLabel,
  riskLevelLabel,
  validationStatusLabel,
  riskLevelOptionLabel,
  validationOptionLabel,
  dateFromLabel,
  dateToLabel,
  onChange,
}: Readonly<{
  filters: AiAnomalyFilters;
  machines: ReturnType<typeof buildAiAnomalyMachineOptions>;
  machineLabel: string;
  allMachinesLabel: string;
  riskLevelLabel: string;
  validationStatusLabel: string;
  riskLevelOptionLabel: (level: "ALL" | AiAnomalyRiskLevel) => string;
  validationOptionLabel: (status: "ALL" | AiAnomalyValidationStatus) => string;
  dateFromLabel: string;
  dateToLabel: string;
  onChange: (patch: Partial<AiAnomalyFilters>) => void;
}>) {
  return (
    <section className="panel">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <label className="block text-sm font-medium text-slate-700">
          {machineLabel}
          <select
            className="input-field mt-1"
            value={filters.machineId}
            onChange={(event) => onChange({ machineId: event.target.value })}
          >
            <option value="">{allMachinesLabel}</option>
            {machines.map((machine) => (
              <option key={machine.id} value={machine.id}>
                {machine.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          {riskLevelLabel}
          <select
            className="input-field mt-1"
            value={filters.riskLevel}
            onChange={(event) =>
              onChange({
                riskLevel: event.target.value as "ALL" | AiAnomalyRiskLevel,
              })
            }
          >
            {RISK_LEVELS.map((level) => (
              <option key={level} value={level}>
                {riskLevelOptionLabel(level)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          {validationStatusLabel}
          <select
            className="input-field mt-1"
            value={filters.validationStatus}
            onChange={(event) =>
              onChange({
                validationStatus: event.target.value as
                  | "ALL"
                  | AiAnomalyValidationStatus,
              })
            }
          >
            {VALIDATION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {validationOptionLabel(status)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          {dateFromLabel}
          <input
            className="input-field mt-1"
            type="date"
            value={filters.dateFrom}
            onChange={(event) => onChange({ dateFrom: event.target.value })}
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          {dateToLabel}
          <input
            className="input-field mt-1"
            type="date"
            value={filters.dateTo}
            onChange={(event) => onChange({ dateTo: event.target.value })}
          />
        </label>
      </div>
    </section>
  );
}
