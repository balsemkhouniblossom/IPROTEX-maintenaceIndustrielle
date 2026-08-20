"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import DynamicSearchControls from "@/components/DynamicSearchControls";
import { apiService } from "@/services/api";
import { displayText } from "@/services/displayValues";
import { ALL_FIELDS_TOKEN, getSearchableFields, matchesDynamicSearch } from "@/services/dynamicSearch";
import { useTranslations } from "next-intl";

interface OtPiece {
  _id: string;
  ot_id?: string | { _id?: string; ot_id?: string };
  part_id?: string | { _id?: string; part_id?: string; nom_piece?: string };
  quantite?: number;
}

function workOrderLabel(value: OtPiece["ot_id"]): string {
  if (!value) return "N/A";
  if (typeof value === "string") return displayText(value, "N/A");
  return displayText(value.ot_id, "N/A");
}

function partLabel(value: OtPiece["part_id"]): string {
  if (!value) return "N/A";
  if (typeof value === "string") return displayText(value, "N/A");
  return displayText(value.part_id ?? value.nom_piece, "N/A");
}

export default function OtPiecesPage() {
  const tCommon = useTranslations("common");
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<OtPiece[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSearchField, setSelectedSearchField] = useState(ALL_FIELDS_TOKEN);

  useEffect(() => {
    async function load() {
      try {
        const res = await apiService.getOtPieces();

        setItems(res.data.items);
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  const searchableItems = useMemo(
    () =>
      (Array.isArray(items) ? items : []).map((item) => ({
        ...item,
        work_order_label: workOrderLabel(item.ot_id),
        part_label: partLabel(item.part_id),
      })),
    [items],
  );

  const searchableFields = useMemo(() => getSearchableFields(searchableItems), [searchableItems]);
  const filteredItems = useMemo(
    () => searchableItems.filter((item) => matchesDynamicSearch(item, searchTerm, selectedSearchField)),
    [searchableItems, searchTerm, selectedSearchField],
  );

  let tableContent;
  if (loading) {
    tableContent = <div className="text-sm text-slate-500">{tCommon("loading")}</div>;
  } else if (filteredItems.length === 0) {
    tableContent = <div className="text-sm text-slate-500">{tCommon("table.noData")}</div>;
  } else {
    tableContent = (
      <table className="table">
        <thead>
          <tr>
            <th>Work Order</th>
            <th>Part</th>
            <th>Quantity</th>
          </tr>
        </thead>
        <tbody>
          {filteredItems.map((item) => (
            <tr key={item._id}>
              <td>{workOrderLabel(item.ot_id)}</td>
              <td>{partLabel(item.part_id)}</td>
              <td>{item.quantite ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <DashboardLayout title="OT Pieces">
      <div className="bento-grid">
        <div className="col-span-full panel">
          <div className="flex items-center justify-between mb-3">
            <h2 className="card-title">OT Pieces</h2>
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
            searchPlaceholder="Search OT pieces..."
          />
        </div>

        <div className="col-span-full panel overflow-x-auto">
          {tableContent}
        </div>
      </div>
    </DashboardLayout>
  );
}
