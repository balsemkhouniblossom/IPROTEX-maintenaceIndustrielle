"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { apiService } from "@/services/api";
import { useTranslations } from "next-intl";

type EntityRef = string | { _id?: string };

interface MachineType {
  _id: string;
  name: string;
}

interface Machine {
  _id: string;
  machine_id: string;
  model?: string;
  type_id: EntityRef;
}

interface DocumentEntity {
  _id: string;
  machine_id: EntityRef;
  type_document?: string;
  file_name: string;
  file_path: string;
  description?: string;
}

function refId(value: EntityRef | undefined): string {
  if (!value) return "";
  return typeof value === "string" ? value : value._id ?? "";
}

function normalizeApiItems<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }

  if (payload && typeof payload === "object") {
    const maybeItems = (payload as { items?: unknown }).items;
    if (Array.isArray(maybeItems)) {
      return maybeItems as T[];
    }
  }

  return [];
}

export default function OperatorManualsPage() {
  const t = useTranslations("dashboard.operator");
  const tCommon = useTranslations("common");
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [machineTypes, setMachineTypes] = useState<MachineType[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [documents, setDocuments] = useState<DocumentEntity[]>([]);

  const [selectedType, setSelectedType] = useState("");
  const [selectedMachine, setSelectedMachine] = useState("");

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const [machineTypesRes, machinesRes, documentsRes] = await Promise.all([
          apiService.getMachineTypes(),
          apiService.getMachines(),
          apiService.getDocuments(),
        ]);

        const machineTypeItems = normalizeApiItems<MachineType>(machineTypesRes.data);
        const machineItems = normalizeApiItems<Machine>(machinesRes.data);

        setMachineTypes(machineTypeItems);
        setMachines(machineItems);
        setDocuments(normalizeApiItems<DocumentEntity>(documentsRes.data));

        const requestedMachineId = searchParams.get("machine");
        if (requestedMachineId) {
          const selected = machineItems.find((machine) => machine._id === requestedMachineId);
          if (selected) {
            setSelectedMachine(selected._id);
            setSelectedType(refId(selected.type_id));
          }
        }
      } catch (error) {
        console.error("Failed to load manuals", error);
      } finally {
        setLoading(false);
      }
    }

    void loadData();
  }, [searchParams]);

  const machinesForType = useMemo(
    () => machines.filter((machine) => refId(machine.type_id) === selectedType),
    [machines, selectedType],
  );

  const visibleDocuments = useMemo(() => {
    return documents.filter((doc) => {
      if (selectedMachine && refId(doc.machine_id) !== selectedMachine) return false;
      if (!selectedMachine && selectedType) {
        const machine = machines.find((item) => item._id === refId(doc.machine_id));
        if (!machine || refId(machine.type_id) !== selectedType) return false;
      }

      const type = (doc.type_document ?? "").toLowerCase();
      return type.includes("manual") || type.includes("pdf") || type.includes("procedure") || type.includes("diagram");
    });
  }, [documents, machines, selectedMachine, selectedType]);

  return (
    <ProtectedRoute requiredRole="operator">
      <DashboardLayout title={t("machineManuals")}>
        <div className="bento-grid">
          <section className="col-span-full rounded-4xl border border-slate-200 bg-linear-to-br from-white via-slate-50 to-blue-50 p-6 shadow-sm">
            <div className="card-title mb-2">{t("machineManuals")}</div>
            <p className="text-sm text-slate-600">{t("manualsIntro")}</p>

            <div className="mt-5">
              <div className="mb-3 text-sm font-semibold text-slate-700">{t("machineCategory")}</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {machineTypes.map((type) => (
                  <button
                    key={type._id}
                    type="button"
                    onClick={() => {
                      setSelectedType(type._id);
                      setSelectedMachine("");
                    }}
                    className={`rounded-3xl border p-4 text-left transition hover:-translate-y-1 hover:shadow-lg ${
                      selectedType === type._id ? "border-blue-500 bg-blue-50 shadow-md" : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="text-base font-semibold text-slate-900">{type.name}</div>
                    <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">{t("viewMachines")}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6">
              <div className="mb-3 text-sm font-semibold text-slate-700">{t("machine")}</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {machinesForType.map((machine) => (
                  <button
                    key={machine._id}
                    type="button"
                    onClick={() => setSelectedMachine(machine._id)}
                    className={`rounded-3xl border p-4 text-left transition hover:-translate-y-1 hover:shadow-lg ${
                      selectedMachine === machine._id ? "border-emerald-500 bg-emerald-50 shadow-md" : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="text-base font-semibold text-slate-900">{machine.machine_id}</div>
                    <div className="mt-1 text-sm text-slate-500">{machine.model || tCommon("notAvailable")}</div>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="col-span-full panel">
            <div className="card-title mb-4">{t("openManual")}</div>

            {loading ? (
              <div className="text-sm text-slate-500">{tCommon("loading")}</div>
            ) : visibleDocuments.length === 0 ? (
              <div className="text-sm text-slate-500">{tCommon("table.noData")}</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {visibleDocuments.map((doc) => (
                  <div key={doc._id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
                    <div className="font-semibold mb-1 text-slate-900">{doc.file_name}</div>
                    <div className="text-xs text-slate-500 mb-3 uppercase tracking-wide">{doc.type_document || tCommon("notAvailable")}</div>
                    {doc.description ? <div className="text-sm text-slate-600 mb-3">{doc.description}</div> : null}
                    <div className="flex gap-2">
                      <a
                        href={doc.file_path}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold"
                      >
                        {t("openManual")}
                      </a>
                      <a
                        href={doc.file_path}
                        download
                        className="px-3 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold"
                      >
                        {t("download")}
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}
