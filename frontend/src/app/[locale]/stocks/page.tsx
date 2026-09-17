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
  ref_constructeur?: string;
  categorie_piece?: string;
  fabricant?: string;
}

interface StockItem {
  _id: string;
  stock_id: string;
  part_id?: string | CatalogueOption;
  quantite_en_stock?: number;
  quantite_reservee?: number;
  seuil_alerte_stock?: number;
  quantite_minimale?: number;
  emplacement?: string;
  version?: number;
}

type MovementType = "reservation" | "consumption" | "return" | "adjustment" | "cancellation";
type StockStatus = "available" | "low" | "out";
type StockFilter = "all" | "available" | "reserved" | "low" | "out";
type StockTableItem = StockItem & { available: number; presentationStatus: StockStatus };

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
  if (!part) return "—";
  if (typeof part === "string") return displayText(part, "—");
  return displayText(part.nom_piece ?? part.part_id, "—");
}

function partReference(part: StockItem["part_id"]): string {
  return typeof part === "object" && part ? displayText(part.part_id ?? part.ref_constructeur, "—") : "—";
}

function partCategory(part: StockItem["part_id"]): string {
  return typeof part === "object" && part ? displayText(part.categorie_piece, "—") : "—";
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

type CreateStockForm = typeof emptyCreateForm;
type MetadataStockForm = typeof emptyMetadataForm;

function metadataPayload(form: MetadataStockForm) {
  return {
    seuil_alerte_stock: optionalNumber(form.seuil_alerte_stock),
    quantite_minimale: optionalNumber(form.quantite_minimale),
    emplacement: optionalText(form.emplacement),
  };
}

function stockStatus(item: StockItem): StockStatus {
  const availableQuantity = available(item);
  if (availableQuantity <= 0) return "out";
  const threshold = item.seuil_alerte_stock ?? item.quantite_minimale;
  return threshold !== undefined && availableQuantity <= threshold ? "low" : "available";
}

const STOCK_STATUS_PRESENTATION: Record<StockStatus, { label: string; className: string }> = {
  available: { label: "Available", className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  low: { label: "Low stock", className: "border-amber-200 bg-amber-50 text-amber-800" },
  out: { label: "Out of stock", className: "border-red-200 bg-red-50 text-red-800" },
};

function createStockPayload(form: CreateStockForm, initialQuantity: number) {
  return {
    stock_id: form.stock_id.trim(),
    part_id: form.part_id,
    quantite_en_stock: initialQuantity,
    seuil_alerte_stock: optionalNumber(form.seuil_alerte_stock),
    quantite_minimale: optionalNumber(form.quantite_minimale),
    emplacement: optionalText(form.emplacement),
  };
}

function optionalNumber(value: string): number | undefined {
  return value ? Number(value) : undefined;
}

function optionalText(value: string): string | undefined {
  return value.trim() || undefined;
}

type StocksTableContentProps = {
  readonly loading: boolean;
  readonly error: string | null;
  readonly items: StockTableItem[];
  readonly searchTerm: string;
  readonly t: ReturnType<typeof useTranslations>;
  readonly tCommon: ReturnType<typeof useTranslations>;
  readonly onAdjust: (item: StockTableItem) => void;
  readonly onHistory: (item: StockTableItem) => void;
  readonly onEdit: (item: StockTableItem) => void;
  readonly onDelete: (item: StockTableItem) => void;
  readonly onRetry: () => void;
};

function StocksTableContent({
  loading,
  error,
  items,
  searchTerm,
  t,
  tCommon,
  onAdjust,
  onHistory,
  onEdit,
  onDelete,
  onRetry,
}: StocksTableContentProps) {
  if (loading) {
    return <div className="space-y-2 p-4" role="status" aria-live="polite"><span className="sr-only">{tCommon("loading")}</span>{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-11 animate-pulse rounded bg-slate-100" />)}</div>;
  }

  if (error) {
    return <div className="flex flex-col items-center gap-3 py-10 text-center" role="alert"><ExclamationTriangleIcon className="h-8 w-8 text-red-500" /><p className="text-sm text-slate-600">{error}</p><button type="button" className="btn-secondary" onClick={onRetry}>Retry</button></div>;
  }

  if (items.length === 0) {
    return (
      <div className="text-sm text-slate-500">
        {searchTerm ? "No live stock records match the current search and filters." : "No live stock records exist in the database yet."}
      </div>
    );
  }

  return (
    <table className="table min-w-[1120px]">
      <thead>
        <tr>
          <th>Part</th>
          <th>Reference</th>
          <th>Category</th>
          <th>{t("table.available", { default: "Available" })}</th>
          <th>{t("table.reserved", { default: "Reserved" })}</th>
          <th>Total stock</th>
          <th>{t("table.location", { default: "Location" })}</th>
          <th>Stock status</th>
          <th>{tCommon("table.actions")}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <StockTableRow
            key={item._id}
            item={item}
            t={t}
            onAdjust={onAdjust}
            onHistory={onHistory}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </tbody>
    </table>
  );
}

function StockHistoryContent({
  loading,
  movements,
  t,
  tCommon,
}: Readonly<{
  loading: boolean;
  movements: StockMovement[];
  t: ReturnType<typeof useTranslations>;
  tCommon: ReturnType<typeof useTranslations>;
}>) {
  if (loading) {
    return <div className="text-sm text-slate-500">{tCommon("loading")}</div>;
  }

  if (movements.length === 0) {
    return (
      <div className="text-sm text-slate-500">
        {t("history.empty", { default: "No movements recorded for this stock yet." })}
      </div>
    );
  }

  return (
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
          {movements.map((movement) => (
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
              <td>{movement.reason || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StockTableRow({
  item,
  t,
  onAdjust,
  onHistory,
  onEdit,
  onDelete,
}: Omit<StocksTableContentProps, "loading" | "error" | "items" | "searchTerm" | "onRetry" | "tCommon"> & {
  readonly item: StockTableItem;
}) {
  const isDeletable = canDelete(item);
  return (
    <tr>
      <td>{partLabel(item.part_id)}</td>
      <td>{partReference(item.part_id)}</td>
      <td>{partCategory(item.part_id)}</td>
      <td className={item.available <= 0 ? "text-red-600 font-semibold" : ""}>{item.available}</td>
      <td>{item.quantite_reservee ?? 0}</td>
      <td>{item.quantite_en_stock ?? 0}</td>
      <td>{item.emplacement || "—"}</td>
      <td><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${STOCK_STATUS_PRESENTATION[item.presentationStatus].className}`}>{STOCK_STATUS_PRESENTATION[item.presentationStatus].label}</span></td>
      <td>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary p-2" title={t("actions.adjust", { default: "Adjust" })} onClick={() => onAdjust(item)}>
            <ScaleIcon className="w-4 h-4" />
          </button>
          <button type="button" className="btn-secondary p-2" title={t("actions.history", { default: "History" })} onClick={() => onHistory(item)}>
            <ClockIcon className="w-4 h-4" />
          </button>
          <button type="button" className="btn-secondary p-2" title={t("actions.edit", { default: "Edit" })} onClick={() => onEdit(item)}>
            <PencilIcon className="w-4 h-4" />
          </button>
          {isDeletable ? (
            <button type="button" className="btn-danger p-2" title={t("actions.delete", { default: "Delete" })} onClick={() => onDelete(item)}>
              <TrashIcon className="w-4 h-4" />
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

export default function StocksPage() {
  const t = useTranslations("stocks");
  const tCommon = useTranslations("common");

  const [items, setItems] = useState<StockItem[]>([]);
  const [catalogues, setCatalogues] = useState<CatalogueOption[]>([]);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSearchField, setSelectedSearchField] = useState(ALL_FIELDS_TOKEN);
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
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
      setLoadError(null);
      const [firstStocksResponse, cataloguesResponse] = await Promise.all([
        apiService.getStocks({ page: 1, limit: 100 }),
        apiService.getCatalogues({ page: 1, limit: 100 }),
      ]);
      const stockPages = firstStocksResponse.data?.totalPages ?? 1;
      const additionalResponses = stockPages > 1
        ? await Promise.all(Array.from({ length: stockPages - 1 }, (_, index) => apiService.getStocks({ page: index + 2, limit: 100 })))
        : [];
      const allStocks = [
        ...(firstStocksResponse.data?.items ?? []),
        ...additionalResponses.flatMap((response) => response.data?.items ?? []),
      ];
      setItems(allStocks);
      setTotalItems(firstStocksResponse.data?.totalItems ?? allStocks.length);
      const cataloguePages = cataloguesResponse.data?.totalPages ?? 1;
      const additionalCatalogueResponses = cataloguePages > 1
        ? await Promise.all(Array.from({ length: cataloguePages - 1 }, (_, index) => apiService.getCatalogues({ page: index + 2, limit: 100 })))
        : [];
      setCatalogues([
        ...(cataloguesResponse.data?.items ?? []),
        ...additionalCatalogueResponses.flatMap((response) => response.data?.items ?? []),
      ]);
    } catch (error) {
      console.error("Error loading stocks:", error);
      setLoadError(extractApiErrorMessage(error, t("notifications.loadFailed")).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const watermark = document.querySelector<HTMLElement>(".themed-logo-watermark");
    if (!watermark) return;
    const previousOpacity = watermark.style.opacity;
    watermark.style.opacity = "0.025";
    return () => { watermark.style.opacity = previousOpacity; };
  }, []);

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
          ...metadataPayload(metadataForm),
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
      await apiService.createStock(createStockPayload(createForm, initialQuantity));
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
        part_reference: partReference(item.part_id),
        part_category: partCategory(item.part_id),
        available: available(item),
        presentationStatus: stockStatus(item),
      })),
    [items],
  );
  const searchableFields = useMemo(() => getSearchableFields(searchableItems), [searchableItems]);
  const filteredItems = useMemo(
    () => searchableItems.filter((item) => {
      if (!matchesDynamicSearch(item, searchTerm, selectedSearchField)) return false;
      if (stockFilter === "available") return item.available > 0;
      if (stockFilter === "reserved") return (item.quantite_reservee ?? 0) > 0;
      if (stockFilter === "low") return item.presentationStatus === "low";
      if (stockFilter === "out") return item.presentationStatus === "out";
      return true;
    }),
    [searchableItems, searchTerm, selectedSearchField, stockFilter],
  );
  const liveSummary = useMemo(() => ({
    available: searchableItems.filter((item) => item.available > 0).length,
    reserved: searchableItems.filter((item) => (item.quantite_reservee ?? 0) > 0).length,
    low: searchableItems.filter((item) => item.presentationStatus === "low").length,
    out: searchableItems.filter((item) => item.presentationStatus === "out").length,
  }), [searchableItems]);
  const liveTotalPages = Math.max(1, Math.ceil(filteredItems.length / limit));
  const visibleLiveItems = filteredItems.slice((page - 1) * limit, page * limit);
  const submitLabel = editingStock
    ? t("actions.update", { default: "Update" })
    : t("actions.create", { default: "Create" });

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
          <button type="button" className="ml-2 text-gray-600 hover:text-gray-800" onClick={() => setNotification(null)}>
            ×
          </button>
        </div>
      )}

      <main className="w-full space-y-4">
        <header className="panel flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div><h1 className="text-xl font-bold text-slate-800 sm:text-2xl">Inventory</h1><p className="mt-1 text-sm text-slate-600">{totalItems} live stock records · See what is available, reserved, low, or unavailable.</p></div>
          <button type="button" onClick={handleCreate} className="btn-primary flex min-h-11 items-center justify-center gap-2"><PlusIcon className="h-4 w-4" /><span>{t("addStock", { default: "Add Stock Record" })}</span></button>
        </header>

          <section aria-label="Live stock summary" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {([['available', 'Available', liveSummary.available], ['reserved', 'Reserved', liveSummary.reserved], ['low', 'Low stock', liveSummary.low], ['out', 'Out of stock', liveSummary.out]] as const).map(([key, label, value]) => (
              <button key={key} type="button" onClick={() => { setStockFilter(key); setPage(1); }} className={`panel min-h-24 border-s-4 p-4 text-start ${stockFilter === key ? 'border-s-blue-600 ring-2 ring-blue-200' : 'border-s-slate-300'}`} aria-pressed={stockFilter === key}><span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span><span className="mt-1 block text-2xl font-bold text-slate-800">{value}</span><span className="text-xs text-slate-500">Live records</span></button>
            ))}
          </section>

          <section className="panel min-w-0 p-3 sm:p-5" aria-labelledby="live-stock-title">
            <div className="mb-4 space-y-3">
              <div><h2 id="live-stock-title" className="card-title">Live Stock</h2><p className="mt-1 text-sm text-slate-500">Authoritative quantities from Catalogue and Stock records.</p></div>
              <div className="flex w-full min-w-0 flex-col gap-3 md:flex-row md:items-center">
                <div className="min-w-0 md:flex-[1.3]"><select value={stockFilter} onChange={(event) => { setStockFilter(event.target.value as StockFilter); setPage(1); }} className="input-field min-h-11 w-full" aria-label="Filter live stock by status"><option value="all">All stock statuses</option><option value="available">Available</option><option value="reserved">Has reservations</option><option value="low">Low stock</option><option value="out">Out of stock</option></select></div>
                <DynamicSearchControls className="w-full min-w-0 md:flex-[2]" layoutClassName="md:grid-cols-[minmax(110px,0.8fr)_minmax(180px,1.4fr)]" selectClassName="min-h-11 w-full min-w-0 rounded-lg border border-gray-300 px-3 py-2" inputClassName="min-h-11 w-full min-w-0 rounded-lg border border-gray-300 py-2 pe-4 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500" selectedField={selectedSearchField} onSelectedFieldChange={(value) => { setSelectedSearchField(value); setPage(1); }} searchableFields={searchableFields} allFieldsLabel={tCommon("table.allFields", { default: "All fields" })} searchTerm={searchTerm} onSearchTermChange={(value) => { setSearchTerm(value); setPage(1); }} searchPlaceholder="Search stock..." />
              </div>
            </div>
            <div className="overflow-x-auto"><StocksTableContent loading={loading} error={loadError} items={visibleLiveItems} searchTerm={searchTerm || (stockFilter !== "all" ? stockFilter : "")} t={t} tCommon={tCommon} onAdjust={handleOpenAdjust} onHistory={(item) => void handleOpenHistory(item)} onEdit={handleEditMetadata} onDelete={(item) => void handleDelete(item)} onRetry={() => void loadData()} /></div>
            {!loading && !loadError && filteredItems.length > 0 ? <Pagination page={page} totalPages={liveTotalPages} totalItems={filteredItems.length} limit={limit} onPageChange={setPage} /> : null}
          </section>
      </main>

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
                      {displayText(part.part_id ?? part.nom_piece, "—")}
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
              {submitting ? tCommon("saving") : submitLabel}
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
        <StockHistoryContent
          loading={historyLoading}
          movements={historyMovements}
          t={t}
          tCommon={tCommon}
        />
      </Modal>
    </DashboardLayout>
  );
}
