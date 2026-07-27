"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import DynamicSearchControls from "@/components/DynamicSearchControls";
import Pagination from "@/components/Pagination";
import { Modal } from "@/components/Modal";
import { apiService } from "@/services/api";
import { displayText } from "@/services/displayValues";
import { ALL_FIELDS_TOKEN, getSearchableFields, matchesDynamicSearch } from "@/services/dynamicSearch";
import { extractApiErrorDetails as extractApiErrorMessage } from "@/services/apiErrors";
import { useTranslations } from "next-intl";
import {
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  PencilIcon,
  PlusIcon,
  ScaleIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

interface CatalogueOption {
  _id: string;
  part_id?: string;
  nom_piece?: string;
}

interface StockItem {
  _id: string;
  stock_id: string;
  part_id?: string | { _id?: string; part_id?: string; nom_piece?: string };
  quantite_en_stock?: number;
  quantite_reservee?: number;
  seuil_alerte_stock?: number;
  quantite_minimale?: number;
  emplacement?: string;
  version?: number;
}

type MovementType = "reservation" | "consumption" | "return" | "adjustment" | "cancellation";

interface StockMovement {
  _id: string;
  movement_id: string;
  type: MovementType;
  quantity_delta: number;
  reserved_delta: number;
  quantite_en_stock_after: number;
  quantite_reservee_after: number;
  work_order_id?: string;
  reason?: string;
  createdAt?: string;
}

const MOVEMENT_BADGE_CLASSES: Record<MovementType, string> = {
  reservation: "bg-amber-100 text-amber-800 border-amber-200",
  consumption: "bg-red-100 text-red-800 border-red-200",
  return: "bg-blue-100 text-blue-800 border-blue-200",
  adjustment: "bg-slate-100 text-slate-700 border-slate-200",
  cancellation: "bg-gray-200 text-gray-600 border-gray-300",
};

function partLabel(part: StockItem["part_id"]): string {
  if (!part) return "N/A";
  if (typeof part === "string") return displayText(part, "N/A");
  return displayText(part.part_id ?? part.nom_piece, "N/A");
}


function available(item: StockItem): number {
  return (item.quantite_en_stock ?? 0) - (item.quantite_reservee ?? 0);
}

function canDelete(item: StockItem): boolean {
  return (item.quantite_en_stock ?? 0) === 0 && (item.quantite_reservee ?? 0) === 0;
}

function formatDelta(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

const emptyCreateForm = {
  stock_id: "",
  part_id: "",
  quantite_en_stock: "0",
  seuil_alerte_stock: "",
  quantite_minimale: "",
  emplacement: "",
};

const emptyMetadataForm = {
  seuil_alerte_stock: "",
  quantite_minimale: "",
  emplacement: "",
};

export default function StocksPage() {
  const t = useTranslations("stocks");
  const tCommon = useTranslations("common");

  const [items, setItems] = useState<StockItem[]>([]);
  const [catalogues, setCatalogues] = useState<CatalogueOption[]>([]);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSearchField, setSelectedSearchField] = useState(ALL_FIELDS_TOKEN);
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const [showFormModal, setShowFormModal] = useState(false);
  const [editingStock, setEditingStock] = useState<StockItem | null>(null);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [metadataForm, setMetadataForm] = useState(emptyMetadataForm);

  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustingStock, setAdjustingStock] = useState<StockItem | null>(null);
  const [adjustDelta, setAdjustDelta] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyStock, setHistoryStock] = useState<StockItem | null>(null);
  const [historyMovements, setHistoryMovements] = useState<StockMovement[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  function showNotification(type: "success" | "error", message: string) {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  }

  const loadData = async () => {
    try {
      setLoading(true);
      const [stocksResponse, cataloguesResponse] = await Promise.all([
        apiService.getStocks({ page, limit }),
        apiService.getCatalogues({ page: 1, limit: 500 }),
      ]);

      setItems(stocksResponse.data?.items ?? []);
      setTotalItems(stocksResponse.data?.totalItems ?? 0);
      setTotalPages(stocksResponse.data?.totalPages ?? 1);
      setCatalogues(cataloguesResponse.data?.items ?? []);
    } catch (error) {
      console.error("Error loading stocks:", error);
      showNotification("error", t("notifications.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function handleCreate() {
    setEditingStock(null);
    setCreateForm(emptyCreateForm);
    setShowFormModal(true);
  }

  function handleEditMetadata(stock: StockItem) {
    setEditingStock(stock);
    setMetadataForm({
      seuil_alerte_stock: stock.seuil_alerte_stock !== undefined ? String(stock.seuil_alerte_stock) : "",
      quantite_minimale: stock.quantite_minimale !== undefined ? String(stock.quantite_minimale) : "",
      emplacement: stock.emplacement || "",
    });
    setShowFormModal(true);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (editingStock) {
      setSubmitting(true);
      try {
        await apiService.updateStock(editingStock._id, {
          seuil_alerte_stock: metadataForm.seuil_alerte_stock ? Number(metadataForm.seuil_alerte_stock) : undefined,
          quantite_minimale: metadataForm.quantite_minimale ? Number(metadataForm.quantite_minimale) : undefined,
          emplacement: metadataForm.emplacement.trim() || undefined,
        });
        showNotification("success", t("notifications.updateSuccess"));
        setShowFormModal(false);
        await loadData();
      } catch (error) {
        console.error("Error updating stock:", error);
        showNotification("error", extractApiErrorMessage(error, t("notifications.saveFailed")).message);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!createForm.stock_id.trim()) {
      showNotification("error", t("notifications.stockCodeRequired"));
      return;
    }
    if (!createForm.part_id) {
      showNotification("error", t("notifications.partRequired"));
      return;
    }
    const initialQuantity = Number(createForm.quantite_en_stock);
    if (!Number.isInteger(initialQuantity) || initialQuantity < 0) {
      showNotification("error", t("notifications.quantityNonNegative"));
      return;
    }

    setSubmitting(true);
    try {
      await apiService.createStock({
        stock_id: createForm.stock_id.trim(),
        part_id: createForm.part_id,
        quantite_en_stock: initialQuantity,
        seuil_alerte_stock: createForm.seuil_alerte_stock ? Number(createForm.seuil_alerte_stock) : undefined,
        quantite_minimale: createForm.quantite_minimale ? Number(createForm.quantite_minimale) : undefined,
        emplacement: createForm.emplacement.trim() || undefined,
      });
      showNotification("success", t("notifications.createSuccess"));
      setShowFormModal(false);
      await loadData();
    } catch (error) {
      console.error("Error creating stock:", error);
      showNotification("error", extractApiErrorMessage(error, t("notifications.saveFailed")).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(stock: StockItem) {
    if (!confirm(t("notifications.confirmDelete"))) return;

    try {
      await apiService.deleteStock(stock._id);
      showNotification("success", t("notifications.deleteSuccess"));
      await loadData();
    } catch (error) {
      console.error("Error deleting stock:", error);
      showNotification("error", extractApiErrorMessage(error, t("notifications.deleteFailed")).message);
    }
  }

  function handleOpenAdjust(stock: StockItem) {
    setAdjustingStock(stock);
    setAdjustDelta("");
    setAdjustReason("");
    setShowAdjustModal(true);
  }

  async function handleSubmitAdjust(event: React.FormEvent) {
    event.preventDefault();
    if (!adjustingStock) return;

    const delta = Number(adjustDelta);
    if (!Number.isInteger(delta) || delta === 0) {
      showNotification("error", t("notifications.deltaRequired"));
      return;
    }
    if (!adjustReason.trim()) {
      showNotification("error", t("notifications.reasonRequired"));
      return;
    }

    const confirmed = confirm(
      t("notifications.confirmAdjust", {
        delta: formatDelta(delta),
        part: partLabel(adjustingStock.part_id),
      }),
    );
    if (!confirmed) return;

    setSubmitting(true);
    try {
      await apiService.adjustStock(adjustingStock._id, {
        delta,
        reason: adjustReason.trim(),
        expected_version: adjustingStock.version,
      });
      showNotification("success", t("notifications.adjustSuccess"));
      setShowAdjustModal(false);
      await loadData();
    } catch (error) {
      const { message, status } = extractApiErrorMessage(error, t("notifications.adjustFailed"));
      if (status === 409) {
        showNotification("error", t("notifications.versionConflict"));
        await loadData();
      } else {
        showNotification("error", message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOpenHistory(stock: StockItem) {
    setHistoryStock(stock);
    setShowHistoryModal(true);
    setHistoryLoading(true);
    try {
      const response = await apiService.getStockMovements(stock._id, { page: 1, limit: 50 });
      setHistoryMovements(response.data?.items ?? []);
    } catch (error) {
      console.error("Error loading stock movement history:", error);
      showNotification("error", t("notifications.historyLoadFailed"));
    } finally {
      setHistoryLoading(false);
    }
  }

  const searchableItems = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        part_label: partLabel(item.part_id),
        available: available(item),
      })),
    [items],
  );
  const searchableFields = useMemo(() => getSearchableFields(searchableItems), [searchableItems]);
  const filteredItems = useMemo(
    () => searchableItems.filter((item) => matchesDynamicSearch(item, searchTerm, selectedSearchField)),
    [searchableItems, searchTerm, selectedSearchField],
  );

  return (
    <DashboardLayout title={t("title", { default: "Stocks" })}>
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg flex items-center gap-2 ${notification.type === "success"
            ? "bg-green-100 text-green-800 border border-green-200"
            : "bg-red-100 text-red-800 border border-red-200"
            }`}
        >
          {notification.type === "success" ? <CheckCircleIcon className="w-5 h-5" /> : <ExclamationTriangleIcon className="w-5 h-5" />}
          <span>{notification.message}</span>
          <button className="ml-2 text-gray-600 hover:text-gray-800" onClick={() => setNotification(null)}>
            ×
          </button>
        </div>
      )}

      <div className="bento-grid">
        <div className="col-span-full mb-6 bento-item">
          <div className="panel">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-800">{t("heading", { default: "Stocks Management" })}</h1>
                <p className="text-slate-600 mt-1">
                  {t("description", {
                    default: "Track available quantities, reservations, and the full audit trail for every part in inventory.",
                  })}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-3xl font-bold text-blue-600">{totalItems}</div>
                  <div className="text-sm text-slate-500">{t("totalStocks", { default: "Total Stock Records" })}</div>
                </div>
                <button onClick={handleCreate} className="btn-primary flex items-center gap-2">
                  <PlusIcon className="w-4 h-4" />
                  <span>{t("addStock", { default: "Add Stock Record" })}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-full bento-item panel overflow-x-auto">
          <div className="flex items-center justify-between mb-4 gap-4">
            <div className="card-title">{t("allStocks", { default: "All Stock Records" })}</div>
            <DynamicSearchControls
              className=""
              selectClassName="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              inputClassName="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent w-full"
              selectedField={selectedSearchField}
              onSelectedFieldChange={setSelectedSearchField}
              searchableFields={searchableFields}
              allFieldsLabel={tCommon("table.allFields", { default: "All fields" })}
              searchTerm={searchTerm}
              onSearchTermChange={setSearchTerm}
              searchPlaceholder={t("searchPlaceholder", { default: "Search by part, location..." })}
            />
          </div>

          {loading ? (
            <div className="text-sm text-slate-500">{tCommon("loading")}</div>
          ) : filteredItems.length === 0 ? (
            <div className="text-sm text-slate-500">
              {searchTerm ? t("empty.search", { default: "No stock records match your search." }) : t("empty.default", { default: "No stock records available." })}
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{t("table.part", { default: "Part" })}</th>
                  <th>{t("table.quantity", { default: "In Stock" })}</th>
                  <th>{t("table.reserved", { default: "Reserved" })}</th>
                  <th>{t("table.available", { default: "Available" })}</th>
                  <th>{t("table.threshold", { default: "Alert Threshold" })}</th>
                  <th>{t("table.location", { default: "Location" })}</th>
                  <th>{tCommon("table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const isDeletable = canDelete(item);
                  return (
                    <tr key={item._id}>
                      <td>{partLabel(item.part_id)}</td>
                      <td>{item.quantite_en_stock ?? 0}</td>
                      <td>{item.quantite_reservee ?? 0}</td>
                      <td className={item.available <= 0 ? "text-red-600 font-semibold" : ""}>{item.available}</td>
                      <td>{item.seuil_alerte_stock ?? tCommon("notAvailable")}</td>
                      <td>{item.emplacement || tCommon("notAvailable")}</td>
                      <td>
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="btn-secondary p-2"
                            title={t("actions.adjust", { default: "Adjust" })}
                            onClick={() => handleOpenAdjust(item)}
                          >
                            <ScaleIcon className="w-4 h-4" />
                          </button>
                          <button
                            className="btn-secondary p-2"
                            title={t("actions.history", { default: "History" })}
                            onClick={() => void handleOpenHistory(item)}
                          >
                            <ClockIcon className="w-4 h-4" />
                          </button>
                          <button
                            className="btn-secondary p-2"
                            title={t("actions.edit", { default: "Edit" })}
                            onClick={() => handleEditMetadata(item)}
                          >
                            <PencilIcon className="w-4 h-4" />
                          </button>
                          {isDeletable ? (
                            <button
                              className="btn-danger p-2"
                              title={t("actions.delete", { default: "Delete" })}
                              onClick={() => handleDelete(item)}
                            >
                              <TrashIcon className="w-4 h-4" />
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="col-span-full">
            <Pagination page={page} totalPages={totalPages} totalItems={totalItems} limit={limit} onPageChange={setPage} />
          </div>
        </div>
      </div>

      <Modal
        isOpen={showFormModal}
        onClose={() => setShowFormModal(false)}
        title={editingStock ? t("modal.edit", { default: "Edit Stock Record" }) : t("modal.add", { default: "Add Stock Record" })}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {!editingStock && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t("form.stockCode", { default: "Stock Code" })}</label>
                <input
                  type="text"
                  value={createForm.stock_id}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, stock_id: event.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  placeholder={t("placeholders.stockCode", { default: "Enter a unique stock code" })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t("form.part", { default: "Part" })}</label>
                <select
                  value={createForm.part_id}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, part_id: event.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  title={t("form.part", { default: "Part" })}
                  required
                >
                  <option value="">{t("placeholders.part", { default: "Select a part" })}</option>
                  {catalogues.map((part) => (
                    <option key={part._id} value={part._id}>
                      {displayText(part.part_id ?? part.nom_piece, part._id)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t("form.initialQuantity", { default: "Initial Quantity" })}</label>
                <input
                  type="number"
                  min="0"
                  value={createForm.quantite_en_stock}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, quantite_en_stock: event.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  required
                />
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t("form.threshold", { default: "Alert Threshold" })}</label>
              <input
                type="number"
                min="0"
                value={editingStock ? metadataForm.seuil_alerte_stock : createForm.seuil_alerte_stock}
                onChange={(event) =>
                  editingStock
                    ? setMetadataForm((prev) => ({ ...prev, seuil_alerte_stock: event.target.value }))
                    : setCreateForm((prev) => ({ ...prev, seuil_alerte_stock: event.target.value }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder={t("placeholders.threshold", { default: "Optional" })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t("form.minimum", { default: "Minimum Quantity" })}</label>
              <input
                type="number"
                min="0"
                value={editingStock ? metadataForm.quantite_minimale : createForm.quantite_minimale}
                onChange={(event) =>
                  editingStock
                    ? setMetadataForm((prev) => ({ ...prev, quantite_minimale: event.target.value }))
                    : setCreateForm((prev) => ({ ...prev, quantite_minimale: event.target.value }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder={t("placeholders.minimum", { default: "Optional" })}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t("form.location", { default: "Location" })}</label>
            <input
              type="text"
              value={editingStock ? metadataForm.emplacement : createForm.emplacement}
              onChange={(event) =>
                editingStock
                  ? setMetadataForm((prev) => ({ ...prev, emplacement: event.target.value }))
                  : setCreateForm((prev) => ({ ...prev, emplacement: event.target.value }))
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder={t("placeholders.location", { default: "Optional" })}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setShowFormModal(false)}>
              {t("actions.cancel", { default: "Cancel" })}
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? tCommon("saving") : editingStock ? t("actions.update", { default: "Update" }) : t("actions.create", { default: "Create" })}
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={showAdjustModal} onClose={() => setShowAdjustModal(false)} title={t("modal.adjust", { default: "Adjust Stock" })}>
        <form onSubmit={handleSubmitAdjust} className="space-y-4">
          {adjustingStock && (
            <div className="text-sm text-slate-600">
              <div className="font-medium text-slate-800">{partLabel(adjustingStock.part_id)}</div>
              <div>
                {t("table.available", { default: "Available" })}: {available(adjustingStock)}
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t("form.delta", { default: "Adjustment (+/-)" })}</label>
            <input
              type="number"
              value={adjustDelta}
              onChange={(event) => setAdjustDelta(event.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder={t("placeholders.delta", { default: "e.g. 10 or -5" })}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t("form.reason", { default: "Reason" })}</label>
            <textarea
              rows={3}
              value={adjustReason}
              onChange={(event) => setAdjustReason(event.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder={t("placeholders.reason", { default: "Explain this adjustment" })}
              required
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setShowAdjustModal(false)}>
              {t("actions.cancel", { default: "Cancel" })}
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? tCommon("saving") : t("actions.apply", { default: "Apply" })}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
        title={t("modal.history", { default: "Movement History" })}
        size="lg"
      >
        {historyStock && (
          <div className="mb-3 text-sm font-medium text-slate-800">{partLabel(historyStock.part_id)}</div>
        )}
        {historyLoading ? (
          <div className="text-sm text-slate-500">{tCommon("loading")}</div>
        ) : historyMovements.length === 0 ? (
          <div className="text-sm text-slate-500">{t("history.empty", { default: "No movements recorded for this stock yet." })}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("history.type", { default: "Type" })}</th>
                  <th>{t("history.quantityChange", { default: "Quantity Change" })}</th>
                  <th>{t("history.reservedChange", { default: "Reserved Change" })}</th>
                  <th>{t("history.stockAfter", { default: "Stock After" })}</th>
                  <th>{t("history.reservedAfter", { default: "Reserved After" })}</th>
                  <th>{t("history.reason", { default: "Reason" })}</th>
                </tr>
              </thead>
              <tbody>
                {historyMovements.map((movement) => (
                  <tr key={movement._id}>
                    <td>
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${MOVEMENT_BADGE_CLASSES[movement.type]}`}
                      >
                        {t(`movementTypes.${movement.type}`, { default: movement.type })}
                      </span>
                    </td>
                    <td>{formatDelta(movement.quantity_delta)}</td>
                    <td>{formatDelta(movement.reserved_delta)}</td>
                    <td>{movement.quantite_en_stock_after}</td>
                    <td>{movement.quantite_reservee_after}</td>
                    <td>{movement.reason || tCommon("notAvailable")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </DashboardLayout>
  );
}
