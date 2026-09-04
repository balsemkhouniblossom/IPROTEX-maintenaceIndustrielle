"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import {
  ToastNotification,
  type ToastNotificationState,
} from "@/components/ToastNotification";
import MachineHealthCard from "@/components/technician/MachineHealthCard";
import { apiService, quiet } from "@/services/api";
import { extractApiErrorDetails } from "@/services/apiErrors";
import {
  buildAiAnomalyMachineOptions,
  isAiServiceUnavailable,
  type AiAnomalyAnalysis,
  type AiAnomalyMachineRecord,
} from "@/services/aiAnomaly";
import {
  analysisAgeLabel,
  filterLabelKey,
  filterToRiskLevel,
  riskLevelLabel,
  type MachineHealthFilter,
} from "@/components/technician/machineHealthPresentation";

const FILTERS: MachineHealthFilter[] = [
  "ALL",
  "ATTENTION",
  "HIGH_RISK",
  "CRITICAL",
];

export default function TechnicianMachineHealthPage() {
  return (
    <ProtectedRoute requiredRole="technician">
      <TechnicianMachineHealthContent />
    </ProtectedRoute>
  );
}

function TechnicianMachineHealthContent() {
  const t = useTranslations();
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [analyses, setAnalyses] = useState<AiAnomalyAnalysis[]>([]);
  const [machineRecords, setMachineRecords] = useState<AiAnomalyMachineRecord[]>([]);
  const [filter, setFilter] = useState<MachineHealthFilter>("ALL");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serviceUnavailable, setServiceUnavailable] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [toast, setToast] = useState<ToastNotificationState | null>(null);

  const load = useCallback(async () => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setServiceUnavailable(false);
    try {
      const [analysesResponse, machinesResponse] = await Promise.all([
        apiService.getAiAnomalyAnalyses(
          {
            page: 1,
            limit: 200,
            risk_level: filterToRiskLevel(filter),
            input_source: "DATASET_REPLAY",
          },
          { signal: controller.signal },
        ),
        apiService
          .getMachines({ page: 1, limit: 100 }, quiet())
          .catch(() => null),
      ]);

      const items = (analysesResponse.data?.items ||
        analysesResponse.data ||
        []) as AiAnomalyAnalysis[];
      setAnalyses(items);

      const records = machinesResponse
        ? ((machinesResponse.data?.items ||
            machinesResponse.data ||
            []) as AiAnomalyMachineRecord[])
        : [];
      setMachineRecords(records);
    } catch (err) {
      const details = extractApiErrorDetails(err, t("technician.machineHealth.states.error"));
      setError(details.message);
      setServiceUnavailable(isAiServiceUnavailable(err));
    } finally {
      setLoading(false);
      setRetrying(false);
    }
    return () => controller.abort();
  }, [filter, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const machines = useMemo(
    () => buildAiAnomalyMachineOptions(analyses, machineRecords),
    [analyses, machineRecords],
  );

  const latestByMachine = useMemo(() => {
    const map = new Map<string, AiAnomalyAnalysis>();
    for (const analysis of analyses) {
      const existing = map.get(analysis.machine_id);
      if (!existing) {
        map.set(analysis.machine_id, analysis);
        continue;
      }
      if (
        Date.parse(analysis.measurement_timestamp) >
        Date.parse(existing.measurement_timestamp)
      ) {
        map.set(analysis.machine_id, analysis);
      }
    }
    return [...map.values()].sort(
      (left, right) =>
        Date.parse(right.measurement_timestamp) -
        Date.parse(left.measurement_timestamp),
    );
  }, [analyses]);

  const visibleMachines = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return latestByMachine;
    return latestByMachine.filter((analysis) => {
      const label = analysis.machine_id.toLowerCase();
      const model = "";
      return label.includes(query) || model.includes(query);
    });
  }, [latestByMachine, search]);

  const filterCounts = useMemo(() => {
    const counts: Record<MachineHealthFilter, number> = {
      ALL: latestByMachine.length,
      ATTENTION: 0,
      HIGH_RISK: 0,
      CRITICAL: 0,
    };
    for (const analysis of latestByMachine) {
      if (analysis.risk_level === "MONITOR") counts.ATTENTION += 1;
      if (analysis.risk_level === "HIGH") counts.HIGH_RISK += 1;
      if (analysis.risk_level === "CRITICAL") counts.CRITICAL += 1;
    }
    return counts;
  }, [latestByMachine]);

  return (
    <DashboardLayout title={t("technician.machineHealth.title")}>
      <ToastNotification
        notification={toast}
        closeLabel={tCommon("close")}
        onClose={() => setToast(null)}
      />
      <div className="space-y-5">
        <section className="panel">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                {t("technician.machineHealth.heading")}
              </h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-600">
                {t("technician.machineHealth.subtitle")}
              </p>
            </div>
          </div>
        </section>

        <section className="panel space-y-4">
          <div className="flex flex-wrap gap-2" role="tablist">
            {FILTERS.map((value) => {
              const isActive = filter === value;
              const count = filterCounts[value];
              const label = t(`technician.machineHealth.${filterLabelKey(value)}`);
              return (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setFilter(value)}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                    isActive
                      ? "border-blue-500 bg-blue-50 text-blue-800"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {label}
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-700">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="relative max-w-md">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm"
              placeholder={t("technician.machineHealth.searchPlaceholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </section>

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

        {!loading && !error && visibleMachines.length === 0 ? (
          <section className="panel py-12 text-center">
            <p className="text-sm text-slate-600">
              {t("technician.machineHealth.noAnalyses")}
            </p>
          </section>
        ) : null}

        {!loading && !error && visibleMachines.length > 0 ? (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleMachines.map((analysis) => (
              <MachineHealthCard
                key={analysis.analysis_id}
                analysis={analysis}
                machines={machines}
                locale={locale}
                t={t}
                detailHref={`/${locale}/technician/machine-health/${analysis.analysis_id}`}
              />
            ))}
          </section>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
