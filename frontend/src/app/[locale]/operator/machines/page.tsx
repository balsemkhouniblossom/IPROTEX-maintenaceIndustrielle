"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { apiService } from "@/services/api";
import { fetchAllPaginated } from "@/services/pagination";
import { useTranslations } from "next-intl";

interface Machine {
  _id: string;
  machine_id: string;
  serial_no: string;
  type_id?: string | { name?: string };
  status: string;
  location?: string;
  model?: string;
  fabricant?: string;
}

interface MachineType {
  _id: string;
  name: string;
}

function stringId(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object" && "_id" in value) {
    return stringId((value as { _id?: unknown })._id);
  }
  return "";
}

function getMachineTypeName(machine: Machine): string {
  if (!machine.type_id) return "";
  if (typeof machine.type_id === "string") return "";
  return machine.type_id.name || "";
}

function machineStatusBadge(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "operational") {
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
  }
  if (normalized === "maintenance") {
    return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";
  }
  return "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300";
}

const STATUS_FILTERS = [
  { key: "all", labelKey: "filters.all" },
  { key: "operational", labelKey: "status.operational" },
  { key: "attention", labelKey: "status.attention" },
  { key: "stopped", labelKey: "status.stopped" },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]["key"];

function matchesStatusFilter(machine: Machine, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  const status = machine.status.toLowerCase();
  if (filter === "operational") return status === "operational";
  if (filter === "attention") return status === "maintenance" || status === "inactive";
  if (filter === "stopped") return status === "retired" || status === "out_of_service";
  return true;
}

function OperatorMachinesPageContent() {
  const router = useRouter();
  const params = useParams<{ locale?: string }>();
  const tMachines = useTranslations("operatorMachines");
  const tCommon = useTranslations("common");
  const locale = params?.locale ?? "en";

  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const loadMachines = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(false);
      const response = await fetchAllPaginated<Machine>((pagination) =>
        apiService.getMyMachines(pagination),
      );
      setMachines(response);
    } catch (error) {
      console.error("Error loading machines:", error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMachines();
  }, [loadMachines]);

  const filteredMachines = useMemo(() => {
    const query = search.trim().toLowerCase();
    return machines.filter((machine) => {
      const matchesSearch = !query
        ? true
        : [
            machine.machine_id,
            machine.serial_no,
            machine.model,
            machine.fabricant,
            getMachineTypeName(machine),
            machine.location,
          ]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(query));
      const matchesStatus = matchesStatusFilter(machine, statusFilter);
      return matchesSearch && matchesStatus;
    });
  }, [machines, search, statusFilter]);

  const handleViewMachine = (machineId: string) => {
    router.push(`/${locale}/operator/machines/${machineId}`);
  };

  const handleReportProblem = (machineId: string) => {
    router.push(`/${locale}/operator/corrective?machine=${machineId}&intent=report-issue`);
  };

  return (
    <ProtectedRoute requiredRole="operator">
      <DashboardLayout title={tMachines("pageTitle")}>
        <div className="operator-dashboard-theme space-y-6 p-4 md:p-6 lg:p-8">
          <section className="space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h1 className="text-xl font-semibold text-text-primary">
                  {tMachines("pageTitle")}
                </h1>
                <p className="mt-1 text-sm text-text-secondary">
                  {tMachines("subtitle", {
                    defaultValue: "Search and manage your assigned machines.",
                  })}
                </p>
              </div>
              <div className="relative">
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={tMachines("searchPlaceholder", {
                    defaultValue: "Search machine name or serial number...",
                  })}
                  className="w-full rounded-2xl border border-border bg-(--surface-elevated) px-4 py-2.5 pl-10 text-sm text-text-primary placeholder:text-text-muted focus:border-cyan-700/60 focus:outline-none"
                />
                <svg
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => setStatusFilter(filter.key)}
                  className={`inline-flex items-center rounded-2xl border px-4 py-2 text-sm font-semibold transition ${
                    statusFilter === filter.key
                      ? "border-cyan-700/55 bg-cyan-900/15 text-cyan-700"
                      : "border-border bg-(--surface-elevated) text-text-secondary hover:border-cyan-700/40 hover:text-text-primary"
                  }`}
                >
                  {tMachines(filter.labelKey)}
                </button>
              ))}
            </div>
          </section>

          {loading ? (
            <div className="rounded-3xl border border-border bg-(--surface-elevated) px-4 py-12 text-center text-sm text-text-secondary">
              {tCommon("loading")}
            </div>
          ) : loadError ? (
            <div className="rounded-3xl border border-red-200 bg-red-50 px-4 py-12 text-center text-sm text-red-800">
              <div>{tMachines("loadFailed", { defaultValue: "Unable to load machines." })}</div>
              <button type="button" onClick={() => void loadMachines()} className="mt-3 rounded-xl border border-red-300 bg-white px-4 py-2 font-semibold text-red-800">
                {tCommon("retry", { defaultValue: "Retry" })}
              </button>
            </div>
          ) : filteredMachines.length === 0 ? (
            <div className="rounded-3xl border border-border bg-(--surface-elevated) px-4 py-12 text-center text-sm text-text-secondary">
              {search || statusFilter !== "all"
                ? tMachines("noMachinesMatchFilters", { defaultValue: "No machines match your filters." })
                : tMachines("noMachinesFound")}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredMachines.map((machine) => (
                <div
                  key={machine._id}
                  className="rounded-3xl border border-border bg-(--surface-secondary) p-4 md:p-5"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-text-primary">
                          {machine.machine_id}
                        </span>
                        <span
                          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semib capitalize ${machineStatusBadge(machine.status)}`}
                        >
                          {tMachines(`status.${machine.status}`, {
                            defaultValue: machine.status,
                          })}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-text-secondary">
                        {machine.model || machine.fabricant || getMachineTypeName(machine) || tCommon("notAvailable")}
                      </div>
                      {machine.location ? (
                        <div className="mt-1 flex items-center gap-1 text-xs text-text-muted">
                          <svg
                            aria-hidden="true"
                            className="h-3.5 w-3.5"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                            <circle cx="12" cy="10" r="3" />
                          </svg>
                          <span>{machine.location}</span>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleViewMachine(machine._id)}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-border bg-(--surface-elevated) px-4 py-2 text-sm font-semibold text-text-primary transition hover:border-cyan-700/55"
                      >
                        {tMachines("viewMachine", { defaultValue: "View Machine" })}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReportProblem(machine._id)}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-700/55 bg-linear-to-r from-[#1E3A8A] via-[#1D4ED8] to-[#155E75] px-4 py-2 text-sm font-semibold text-slate-50 shadow-[0_14px_30px_rgba(6,78,59,0.35)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(6,78,59,0.45)]"
                      >
                        {tMachines("reportIssue", { defaultValue: "Report Problem" })}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}

export default function OperatorMachinesPage() {
  return (
    <ProtectedRoute requiredRole="operator">
      <OperatorMachinesPageContent />
    </ProtectedRoute>
  );
}
