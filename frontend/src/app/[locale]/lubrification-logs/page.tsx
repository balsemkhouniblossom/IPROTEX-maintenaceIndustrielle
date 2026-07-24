"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import DynamicSearchControls from "@/components/DynamicSearchControls";
import { apiService } from "@/services/api";
import { displayText } from "@/services/displayValues";
import { ALL_FIELDS_TOKEN, getSearchableFields, matchesDynamicSearch } from "@/services/dynamicSearch";
import { useTranslations } from "next-intl";

interface LubrificationLog {
  _id: string;
  log_id?: string;
  machine_id?: string | { _id?: string; machine_id?: string };
  lubrifiant_id?: string | { _id?: string; nom?: string };
  date_application?: string;
  quantite?: number;
  remarque?: string;
}

function machineLabel(value: LubrificationLog["machine_id"]): string {
  if (!value) return "N/A";
  if (typeof value === "string") return displayText(value, "N/A");
  return displayText(value.machine_id, "N/A");
}

function lubrifiantLabel(value: LubrificationLog["lubrifiant_id"]): string {
  if (!value) return "N/A";
  if (typeof value === "string") return displayText(value, "N/A");
  return displayText(value.nom, "N/A");
}

export default function LubrificationLogsPage() {
  const tCommon = useTranslations("common");
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<LubrificationLog[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSearchField, setSelectedSearchField] = useState(ALL_FIELDS_TOKEN);

  useEffect(() => {
    async function load() {
      try {
        const res = await apiService.getLubrificationLogs();

        console.log("API Response:", res);
        console.log("API Response data:", res.data);
        console.log("Is res.data array?", Array.isArray(res.data));

        setItems(Array.isArray(res.data) ? res.data : []);
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  const searchableItems = useMemo(() => {
    const list = Array.isArray(items) ? items : [];

    return list.map((item) => ({
      ...item,
      machine_label: machineLabel(item.machine_id),
      lubrifiant_label: lubrifiantLabel(item.lubrifiant_id),
    }));
  }, [items]);

  const searchableFields = useMemo(() => getSearchableFields(searchableItems), [searchableItems]);
  const filteredItems = useMemo(
    () => searchableItems.filter((item) => matchesDynamicSearch(item, searchTerm, selectedSearchField)),
    [searchableItems, searchTerm, selectedSearchField],
  );

  return (
    <DashboardLayout title="Lubrification Logs">
      <div className="bento-grid">
        <div className="col-span-full panel">
          <div className="flex items-center justify-between mb-3">
            <h2 className="card-title">Lubrification Logs</h2>
            <div className="text-sm text-slate-500">{filteredItems.length}</div>
          </div>

          <DynamicSearchControls
            className=""
            selectedField={selectedSearchField}
            onSelectedFieldChange={setSelectedSearchField}
            searchableFields={searchableFields}
            allFieldsLabel={tCommon("table.allFields", { default: "All fields" })}
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            searchPlaceholder="Search lubrication logs..."
          />
        </div>

        <div className="col-span-full panel overflow-x-auto">
          {loading ? (
            <div className="text-sm text-slate-500">{tCommon("loading")}</div>
          ) : filteredItems.length === 0 ? (
            <div className="text-sm text-slate-500">{tCommon("table.noData")}</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Machine</th>
                  <th>Lubrifiant</th>
                  <th>Date</th>
                  <th>Quantity</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr key={item._id}>
                    <td>{displayText(item.log_id, "N/A")}</td>
                    <td>{machineLabel(item.machine_id)}</td>
                    <td>{lubrifiantLabel(item.lubrifiant_id)}</td>
                    <td>{item.date_application ? new Date(item.date_application).toLocaleString() : "N/A"}</td>
                    <td>{item.quantite ?? "N/A"}</td>
                    <td>{item.remarque || "N/A"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
