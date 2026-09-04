"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import {
  ToastNotification,
  type ToastNotificationState,
} from "@/components/ToastNotification";
import MachineHealthDetail from "@/components/technician/MachineHealthDetail";
import { useAuth } from "@/contexts/AuthContext";
import { apiService, quiet } from "@/services/api";
import { extractApiErrorDetails } from "@/services/apiErrors";
import {
  buildAiAnomalyMachineOptions,
  isAiServiceUnavailable,
  type AiAnomalyAnalysis,
  type AiAnomalyMachineRecord,
} from "@/services/aiAnomaly";

export default function TechnicianMachineHealthDetailPage() {
  return (
    <ProtectedRoute requiredRole="technician">
      <TechnicianMachineHealthDetailContent />
    </ProtectedRoute>
  );
}

function TechnicianMachineHealthDetailContent() {
  const t = useTranslations();
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const analysisId = String(params.analysisId || "");

  const [analysis, setAnalysis] = useState<AiAnomalyAnalysis | null>(null);
  const [machineRecords, setMachineRecords] = useState<AiAnomalyMachineRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serviceUnavailable, setServiceUnavailable] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<ToastNotificationState | null>(null);

  const load = useCallback(async () => {
    if (!analysisId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setServiceUnavailable(false);
    try {
      const [analysisResponse, machinesResponse, historyResponse] = await Promise.all([
        apiService.getAiAnomalyAnalysis(analysisId),
        apiService
          .getMachines({ page: 1, limit: 100 }, quiet())
          .catch(() => null),
        apiService
          .getAiAnomalyMachineHistory("", { limit: 1 }, { signal: controller.signal })
          .catch(() => null),
      ]);
      setAnalysis(analysisResponse.data as AiAnomalyAnalysis);

      const records = machinesResponse
        ? ((machinesResponse.data?.items ||
            machinesResponse.data ||
            []) as AiAnomalyMachineRecord[])
        : [];
      setMachineRecords(records);
      void historyResponse;
    } catch (err) {
      const details = extractApiErrorDetails(
        err,
        t("technician.machineHealth.states.error"),
      );
      setError(details.message);
      setServiceUnavailable(isAiServiceUnavailable(err));
    } finally {
      setLoading(false);
      setRetrying(false);
    }
  }, [analysisId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const machines = useMemo(() => {
    if (!analysis) return [];
    return buildAiAnomalyMachineOptions([analysis], machineRecords);
  }, [analysis, machineRecords]);

  const submitValidation = useCallback(
    async (payload: {
      validation_status: "CONFIRMED" | "REJECTED";
      validation_comment?: string;
    }) => {
      if (!analysis) return;
      setSubmitting(true);
      try {
        const response = await apiService.validateAiAnomalyAnalysis(
          analysis.analysis_id,
          payload,
        );
        setAnalysis(response.data as AiAnomalyAnalysis);
        setToast({
          type: "success",
          message: t("technician.machineHealth.validation.saved"),
        });
      } catch (err) {
        const details = extractApiErrorDetails(
          err,
          t("technician.machineHealth.validation.failed"),
        );
        setToast({ type: "error", message: details.message });
      } finally {
        setSubmitting(false);
      }
    },
    [analysis, t],
  );

  const backHref = `/${locale}/technician/machine-health`;

  return (
    <DashboardLayout title={t("technician.machineHealth.title")}>
      <ToastNotification
        notification={toast}
        closeLabel={tCommon("close")}
        onClose={() => setToast(null)}
      />
      <div className="space-y-5">
        {loading ? (
          <section className="panel flex min-h-48 items-center justify-center">
            <div className="text-center">
              <div className="mx-auto h-10 w-10 animate-spin rounded-full border-b-2 border-blue-600" />
              <p className="mt-3 text-sm text-slate-600">
                {t("technician.machineHealth.states.loading")}
              </p>
            </div>
          </section>
        ) : null}

        {!loading && error ? (
          <section className="panel border border-amber-200 bg-amber-50">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="font-semibold text-amber-900">
                  {serviceUnavailable
                    ? t("technician.machineHealth.states.unavailableTitle")
                    : t("technician.machineHealth.states.errorTitle")}
                </h2>
                <p className="mt-1 text-sm text-amber-800">{error}</p>
              </div>
              <button
                type="button"
                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-semibold text-amber-800 hover:bg-amber-50"
                onClick={() => {
                  setRetrying(true);
                  void load();
                }}
              >
                {retrying
                  ? t("technician.machineHealth.states.retrying")
                  : t("technician.machineHealth.states.retry")}
              </button>
            </div>
          </section>
        ) : null}

        {!loading && !error && !analysis ? (
          <section className="panel py-12 text-center">
            <p className="text-sm text-slate-600">
              {t("technician.machineHealth.noAnalyses")}
            </p>
            <button
              type="button"
              className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              onClick={() => router.push(backHref)}
            >
              {t("technician.machineHealth.backToList")}
            </button>
          </section>
        ) : null}

        {!loading && !error && analysis ? (
          <MachineHealthDetail
            analysis={analysis}
            machines={machines}
            locale={locale}
            t={t}
            userRole={user?.role}
            backHref={backHref}
            onSubmitValidation={submitValidation}
            submitting={submitting}
          />
        ) : null}
      </div>
    </DashboardLayout>
  );
}
