"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import TechnicianDocumentCard from "@/components/technician/TechnicianDocumentCard";
import {
  documentMachineLabel,
  filterDocumentsByMachine,
  filterDocumentsByType,
  searchDocuments,
  uniqueDocumentMachines,
  uniqueDocumentTypes,
  type TechnicianDocument,
} from "@/components/technician/documentPresentation";
import { apiService } from "@/services/api";

type FetchState =
  | { status: "loading" }
  | { status: "ready"; documents: TechnicianDocument[] }
  | { status: "error" };

export type TechnicianDocumentBrowserProps = Readonly<{
  machineId?: string;
  emptyMessageKey?: string;
  previewLabel: string;
  onPreview?: (document: TechnicianDocument) => void;
}>;

export default function TechnicianDocumentBrowser({
  machineId,
  emptyMessageKey = "manuals.emptyFilters",
  previewLabel,
  onPreview,
}: TechnicianDocumentBrowserProps) {
  const t = useTranslations("technician");
  const locale = useLocale();
  const [documents, setDocuments] = useState<TechnicianDocument[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>({ status: "loading" });
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [machineFilter, setMachineFilter] = useState(machineId || "");

  useEffect(() => {
    let cancelled = false;
    setFetchState({ status: "loading" });
    apiService
      .getTechnicianManuals({ page: 1, limit: 200 })
      .then((response) => {
        if (cancelled) return;
        const items = Array.isArray(response.data?.items) ? response.data.items : [];
        setDocuments(items as TechnicianDocument[]);
        setFetchState({ status: "ready", documents: items as TechnicianDocument[] });
      })
      .catch(() => {
        if (cancelled) return;
        setFetchState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (machineId !== undefined) {
      setMachineFilter(machineId);
    }
  }, [machineId]);

  const filtered = useMemo(() => {
    let result = documents;
    if (machineFilter) {
      result = filterDocumentsByMachine(result, machineFilter);
    }
    if (typeFilter) {
      result = filterDocumentsByType(result, typeFilter);
    }
    if (search.trim()) {
      result = searchDocuments(result, search, t("notAvailable"));
    }
    return result;
  }, [documents, machineFilter, typeFilter, search, t]);

  const types = useMemo(() => uniqueDocumentTypes(documents), [documents]);
  const machines = useMemo(
    () => uniqueDocumentMachines(documents, t("notAvailable")),
    [documents, t],
  );
  const hasFilters = Boolean(search.trim() || typeFilter || machineFilter);
  const localePrefix = locale;
  const machineHref = (id: string) => `/${localePrefix}/machines/${id}`;

  return (
    <div className="space-y-4">
      <div className="panel flex flex-col gap-3 md:flex-row md:items-end">
        <label className="relative flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            aria-label={t("manuals.searchLabel")}
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm"
            placeholder={t("manuals.searchPlaceholder")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <select
          aria-label={t("manuals.typeLabel")}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
        >
          <option value="">{t("manuals.allTypes")}</option>
          {types.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <select
          aria-label={t("manuals.machineLabel")}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          value={machineFilter}
          onChange={(event) => setMachineFilter(event.target.value)}
        >
          <option value="">{t("manuals.allMachines")}</option>
          {machines.map((machine) => (
            <option key={machine.id} value={machine.id}>
              {machine.label}
            </option>
          ))}
        </select>
      </div>

      {fetchState.status === "loading" && (
        <div className="panel text-sm text-slate-500">{t("loading")}</div>
      )}

      {fetchState.status === "error" && (
        <div className="panel border border-red-200 bg-red-50 text-sm text-red-700">
          {t("errors.network")}
        </div>
      )}

      {fetchState.status === "ready" && filtered.length === 0 && (
        <div className="panel border-s-4 border-s-slate-300 text-sm text-slate-600">
          {hasFilters ? t(emptyMessageKey) : t("empty.manuals")}
        </div>
      )}

      {fetchState.status === "ready" && filtered.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((document) => {
            const machine = document.machine_id;
            const machineRef =
              machine && typeof machine === "object" ? machine._id : undefined;
            return (
              <div key={document.document_id || document._id || document.file_name}>
                <TechnicianDocumentCard
                  document={document}
                  onPreview={onPreview}
                  previewLabel={previewLabel}
                />
                {machineRef ? (
                  <p className="mt-2 text-xs text-slate-500">
                    <a
                      className="font-medium text-blue-700 hover:underline"
                      href={machineHref(machineRef)}
                    >
                      {documentMachineLabel(machine, t("notAvailable"))}
                    </a>
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
