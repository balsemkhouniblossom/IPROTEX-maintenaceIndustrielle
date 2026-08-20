"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Modal } from "@/components/Modal";
import ProfileAvatar from "@/components/ProfileAvatar";
import Pagination from "@/components/Pagination";
import { StatusBadge } from "@/components/StatusBadge";
import { VirtualizedDataTable, DataTableColumn } from "@/components/VirtualizedDataTable";
import { SavedViewsBar, SavedView } from "@/components/SavedViewsBar";
import { apiService } from "@/services/api";
import { extractApiErrorMessage } from "@/services/apiErrors";
import { useServerTable, ServerTableQuery } from "@/hooks/useServerTable";
import { invalidateList, LIST_EVENTS, useListInvalidation } from "@/services/listInvalidation";
import {
  PencilIcon,
  TrashIcon,
  PlusIcon,
  CheckIcon,
  XMarkIcon,
  ArrowUturnLeftIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

interface WorkOrder {
  _id: string;
  ot_id: string;
  description?: string;
  priorite?: string;
  status: string;
  estimated_duration?: number;
  machine_id?: { _id: string; machine_id: string };
  technician_id?: { _id: string; nom_complet: string; photo?: string };
  date_created: string;
  date_start?: string;
  date_end?: string;
}

interface Machine {
  _id: string;
  machine_id: string;
}

interface User {
  _id: string;
  nom_complet: string;
  photo?: string;
}

interface WorkOrdersFilters {
  status: string;
  priority: string;
  [key: string]: string;
}

// Statuses where an independent validator (never the technician who
// performed the work — enforced server-side by applyValidationAction) can
// still decide the outcome of a corrective/preventive intervention.
const VALIDATABLE_STATUSES = new Set(['waiting_validation', 'technician_required', 'returned']);

const STATUS_BADGE_CLASSES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  in_progress: 'bg-blue-100 text-blue-800 border-blue-200',
  completed: 'bg-green-100 text-green-800 border-green-200',
  cancelled: 'bg-yellow-100 text-yellow-800 border-yellow-200',
};
const DEFAULT_STATUS_BADGE_CLASS = 'bg-yellow-100 text-yellow-800 border-yellow-200';

const PRIORITY_BADGE_CLASSES: Record<string, string> = {
  high: 'bg-red-100 text-red-800 border-red-200',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  low: 'bg-green-100 text-green-800 border-green-200',
};
const DEFAULT_PRIORITY_BADGE_CLASS = 'bg-green-100 text-green-800 border-green-200';

// Matches backend WORK_ORDERS_SORT_ALLOWED_FIELDS exactly (see
// backend/src/work-orders/work-orders.service.ts) so a saved-view sort is
// always one the server actually honors.
type SavedWorkOrdersQuery = {
  search?: string;
  status?: string;
  priority?: string;
  sort?: string;
};

export default function WorkOrdersPage() {
  const tWorkOrders = useTranslations("workOrders");
  const tCommon = useTranslations("common");
  const router = useRouter();

  const [machines, setMachines] = useState<Machine[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingWorkOrder, setEditingWorkOrder] = useState<WorkOrder | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [formData, setFormData] = useState({
    ot_id: '',
    description: '',
    priorite: 'medium',
    status: 'pending',
    estimated_duration: '',
    machine_id: '',
    technician_id: '',
    date_start: '',
    date_end: '',
  });
  const selectedTechnician = users.find((user) => user._id === formData.technician_id);

  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeSavedViewId, setActiveSavedViewId] = useState<string | null>(null);

  const fetcher = useCallback(
    async (query: ServerTableQuery<WorkOrdersFilters>, signal: AbortSignal) => {
      const response = await apiService.getWorkOrders(
        {
          page: query.page,
          limit: query.limit,
          search: query.search || undefined,
          sort: query.sort,
          status: query.filters.status || undefined,
          priority: query.filters.priority || undefined,
        },
        { signal },
      );
      return {
        items: response.data.items ?? [],
        page: response.data.page ?? query.page,
        limit: response.data.limit ?? query.limit,
        totalItems: response.data.totalItems ?? 0,
        totalPages: response.data.totalPages ?? 1,
      };
    },
    [],
  );

  const table = useServerTable<WorkOrder, WorkOrdersFilters>({
    fetcher,
    initialFilters: { status: '', priority: '' },
    pageSize: 10,
  });

  // Picks up: this page's own CRUD (below), plus Operator corrective/
  // preventive submissions and Technician work-order actions, all of
  // which mutate a WorkOrder this list may currently be showing.
  useListInvalidation(LIST_EVENTS.workOrders, table.reload);

  useEffect(() => {
    window.addEventListener('focus', table.reload);
    return () => window.removeEventListener('focus', table.reload);
  }, [table.reload]);

  const loadFormOptions = useCallback(async () => {
    try {
      const [machinesRes, usersRes] = await Promise.all([
        apiService.getMachines(),
        apiService.getUsers(),
      ]);
      setMachines(machinesRes.data.items || []);
      setUsers(usersRes.data.items || []);
    } catch (error) {
      console.error('Error loading machines/users:', error);
    }
  }, []);

  useEffect(() => {
    void loadFormOptions();
  }, [loadFormOptions]);

  const loadSavedViews = useCallback(async () => {
    try {
      const response = await apiService.getSavedViews('work-orders');
      setSavedViews(Array.isArray(response.data) ? response.data : []);
    } catch {
      // Non-fatal — the saved-views bar just stays empty.
    }
  }, []);

  useEffect(() => {
    void loadSavedViews();
  }, [loadSavedViews]);

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  async function refreshWorkOrders() {
    invalidateList(LIST_EVENTS.workOrders);
    router.refresh();
  }

  const validateForm = () => {
    if (!formData.ot_id.trim()) {
      showNotification('error', tWorkOrders("validation.referenceRequired", { default: "Work order reference is required" }));
      return false;
    }
    if (!formData.machine_id) {
      showNotification('error', tWorkOrders("validation.machineRequired"));
      return false;
    }
    if (!formData.technician_id) {
      showNotification('error', tWorkOrders("validation.technicianRequired"));
      return false;
    }
    return true;
  };

  const resetForm = () => {
    setFormData({
      ot_id: '',
      description: '',
      priorite: 'medium',
      status: 'pending',
      estimated_duration: '',
      machine_id: '',
      technician_id: '',
      date_start: '',
      date_end: '',
    });
    setEditingWorkOrder(null);
  };

  const handleCreate = () => {
    resetForm();
    setShowModal(true);
  };

  const handleEdit = (workOrder: WorkOrder) => {
    setEditingWorkOrder(workOrder);
    setFormData({
      ot_id: workOrder.ot_id,
      description: workOrder.description || '',
      priorite: workOrder.priorite || 'medium',
      status: workOrder.status,
      estimated_duration: workOrder.estimated_duration?.toString() || '',
      machine_id: workOrder.machine_id?._id || '',
      technician_id: workOrder.technician_id?._id || '',
      date_start: workOrder.date_start ? new Date(workOrder.date_start).toISOString().split('T')[0] : '',
      date_end: workOrder.date_end ? new Date(workOrder.date_end).toISOString().split('T')[0] : '',
    });
    setShowModal(true);
  };

  const handleDelete = async (workOrderId: string) => {
    if (confirm(tWorkOrders("confirmDelete"))) {
      try {
        await apiService.deleteWorkOrder(workOrderId);
        await refreshWorkOrders();
        showNotification('success', tWorkOrders("notifications.deleted"));
      } catch (error) {
        console.error('Error deleting work order:', error);
        showNotification('error', tWorkOrders("notifications.deleteFailed"));
      }
    }
  };

  const handleValidate = async (
    workOrderId: string,
    action: 'approve' | 'reject' | 'request_correction',
  ) => {
    const confirmMessages: Record<typeof action, string> = {
      approve: tWorkOrders("confirmApprove", { default: "Approve this work order?" }),
      reject: tWorkOrders("confirmReject", { default: "Reject this work order?" }),
      request_correction: tWorkOrders("confirmRequestCorrection", {
        default: "Send this work order back for correction?",
      }),
    };
    if (!confirm(confirmMessages[action])) return;
    try {
      await apiService.validateWorkOrder(workOrderId, { action });
      await refreshWorkOrders();
      const successMessages: Record<typeof action, string> = {
        approve: tWorkOrders("notifications.approved"),
        reject: tWorkOrders("notifications.rejected"),
        request_correction: tWorkOrders("notifications.correctionRequested"),
      };
      showNotification('success', successMessages[action]);
    } catch (error) {
      const failureMessages: Record<typeof action, string> = {
        approve: tWorkOrders("notifications.approveFailed"),
        reject: tWorkOrders("notifications.rejectFailed"),
        request_correction: tWorkOrders("notifications.correctionFailed"),
      };
      showNotification('error', extractApiErrorMessage(error, failureMessages[action]));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setSubmitting(true);
    try {
      const data = {
        ...formData,
        estimated_duration: Number.parseInt(formData.estimated_duration) || undefined,
        machine_id: formData.machine_id || undefined,
        technician_id: formData.technician_id || undefined,
        date_start: formData.date_start || undefined,
        date_end: formData.date_end || undefined,
      };

      if (editingWorkOrder) {
        await apiService.updateWorkOrder(editingWorkOrder._id, data);
        showNotification('success', tWorkOrders("notifications.updated"));
      } else {
        await apiService.createWorkOrder(data);
        showNotification('success', tWorkOrders("notifications.created"));
      }

      setShowModal(false);
      resetForm();
      await refreshWorkOrders();
    } catch (error) {
      console.error('Error saving work order:', error);
      showNotification('error', tWorkOrders("notifications.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  function applySavedView(view: SavedView) {
    const query = view.query as SavedWorkOrdersQuery;
    setActiveSavedViewId(view._id);
    table.setSearchInput(query.search ?? '');
    table.setFilters({ status: query.status ?? '', priority: query.priority ?? '' });
    table.setSort(query.sort);
    table.setPage(1);
  }

  async function saveCurrentView(name: string) {
    try {
      const query: SavedWorkOrdersQuery = {
        search: table.searchInput || undefined,
        status: table.filters.status || undefined,
        priority: table.filters.priority || undefined,
        sort: table.sort,
      };
      const response = await apiService.createSavedView({ pageKey: 'work-orders', name, query });
      setSavedViews((prev) => [response.data, ...prev]);
    } catch (error) {
      showNotification('error', extractApiErrorMessage(error, tCommon('savedViews.save')));
    }
  }

  async function deleteSavedView(view: SavedView) {
    try {
      await apiService.deleteSavedView(view._id);
      setSavedViews((prev) => prev.filter((v) => v._id !== view._id));
      if (activeSavedViewId === view._id) setActiveSavedViewId(null);
    } catch (error) {
      showNotification('error', extractApiErrorMessage(error, tCommon('savedViews.delete')));
    }
  }

  const columns: DataTableColumn<WorkOrder>[] = useMemo(
    () => [
      {
        key: 'ot_id',
        header: tWorkOrders("table.reference", { default: "Work Order Reference" }),
        width: 'minmax(9rem, 1fr)',
        render: (wo) => <span className="font-medium">{wo.ot_id}</span>,
      },
      {
        key: 'description',
        header: tWorkOrders("table.description"),
        width: 'minmax(10rem, 1.5fr)',
        render: (wo) => wo.description || tCommon("notAvailable"),
      },
      {
        key: 'machine',
        header: tWorkOrders("table.machine"),
        width: 'minmax(7rem, 1fr)',
        render: (wo) => wo.machine_id?.machine_id || tCommon("notAvailable"),
      },
      {
        key: 'technician',
        header: tWorkOrders("table.technician"),
        width: 'minmax(9rem, 1fr)',
        render: (wo) =>
          wo.technician_id ? (
            <div className="flex items-center gap-2">
              <ProfileAvatar name={wo.technician_id.nom_complet} photo={wo.technician_id.photo} alt={wo.technician_id.nom_complet} size="sm" />
              <span className="truncate">{wo.technician_id.nom_complet}</span>
            </div>
          ) : (
            tWorkOrders("unassigned")
          ),
      },
      {
        key: 'status',
        header: tWorkOrders("table.status"),
        sortable: true,
        width: '9rem',
        render: (wo) => (
          <StatusBadge
            label={tWorkOrders(`status.${wo.status}`)}
            colorClassName={STATUS_BADGE_CLASSES[wo.status] ?? DEFAULT_STATUS_BADGE_CLASS}
          />
        ),
      },
      {
        key: 'priorite',
        header: tWorkOrders("table.priority"),
        sortable: true,
        width: '9rem',
        render: (wo) => (
          <StatusBadge
            label={tWorkOrders(`priority.${wo.priorite || "low"}`)}
            colorClassName={PRIORITY_BADGE_CLASSES[wo.priorite || 'low'] ?? DEFAULT_PRIORITY_BADGE_CLASS}
          />
        ),
      },
      {
        key: 'date_created',
        header: tWorkOrders("table.created"),
        sortable: true,
        width: '8rem',
        render: (wo) => new Date(wo.date_created).toLocaleDateString(),
      },
      {
        key: 'date_start',
        header: tWorkOrders("table.startDate"),
        width: '8rem',
        render: (wo) => (wo.date_start ? new Date(wo.date_start).toLocaleDateString() : tCommon("notAvailable")),
      },
      {
        key: 'date_end',
        header: tWorkOrders("table.endDate"),
        width: '8rem',
        render: (wo) => (wo.date_end ? new Date(wo.date_end).toLocaleDateString() : tCommon("notAvailable")),
      },
      {
        key: 'actions',
        header: tCommon("table.actions"),
        align: 'end',
        width: 'minmax(18rem, 36rem)',
        render: (wo) => (
          <div className="flex justify-end gap-2">
            {VALIDATABLE_STATUSES.has(wo.status) && (
              <>
                <button
                  type="button"
                  onClick={() => void handleValidate(wo._id, 'approve')}
                  className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs text-green-700"
                  title={tWorkOrders("actions.approve")}
                  aria-label={`${tWorkOrders("actions.approve")} ${wo.ot_id}`}
                >
                  <CheckIcon className="h-4 w-4 shrink-0" />
                  <span>{tWorkOrders("actions.approve")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleValidate(wo._id, 'request_correction')}
                  className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs text-amber-700"
                  title={tWorkOrders("actions.requestCorrection")}
                  aria-label={`${tWorkOrders("actions.requestCorrection")} ${wo.ot_id}`}
                >
                  <ArrowUturnLeftIcon className="h-4 w-4 shrink-0" />
                  <span>{tWorkOrders("actions.requestCorrection")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleValidate(wo._id, 'reject')}
                  className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs text-red-700"
                  title={tWorkOrders("actions.reject")}
                  aria-label={`${tWorkOrders("actions.reject")} ${wo.ot_id}`}
                >
                  <XMarkIcon className="h-4 w-4 shrink-0" />
                  <span>{tWorkOrders("actions.reject")}</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => handleEdit(wo)}
              className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
              title={tCommon("edit")}
              aria-label={`${tCommon("edit")} ${wo.ot_id}`}
            >
              <PencilIcon className="h-4 w-4 shrink-0" />
              <span>{tCommon("edit")}</span>
            </button>
            <button
              type="button"
              onClick={() => handleDelete(wo._id)}
              className="btn-danger inline-flex items-center gap-1.5 px-3 py-2 text-xs"
              title={tCommon("delete")}
              aria-label={`${tCommon("delete")} ${wo.ot_id}`}
            >
              <TrashIcon className="h-4 w-4 shrink-0" />
              <span>{tCommon("delete")}</span>
            </button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tWorkOrders, tCommon, users, machines],
  );

  const workOrderSubmitLabel = editingWorkOrder
    ? tWorkOrders("actions.update")
    : tWorkOrders("actions.create");

  return (
    <DashboardLayout title={tWorkOrders("title")}>
      {/* Notification */}
      {notification && (
        <div className={`work-orders-toast fixed top-4 right-4 z-50 flex items-center space-x-2 rounded-lg border p-4 shadow-lg ${notification.type === 'success' ? 'work-orders-toast-success' : 'work-orders-toast-error'
          }`}>
          {notification.type === 'success' ? (
            <CheckCircleIcon className="w-5 h-5" />
          ) : (
            <ExclamationTriangleIcon className="w-5 h-5" />
          )}
          <span>{notification.message}</span>
          <button type="button"
            onClick={() => setNotification(null)}
            aria-label={tCommon('dismiss')}
            style={{ minWidth: 24, minHeight: 24 }}
            className="ml-2 flex items-center justify-center text-current opacity-70 transition-opacity hover:opacity-100"
          >
            ×
          </button>
        </div>
      )}

      <div className="bento-grid work-orders-theme">
        {/* Header */}
        <div className="col-span-full mb-6 bento-item">
          <div className="panel">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-slate-800">{tWorkOrders("heading")}</h1>
                <p className="text-slate-600 mt-1">{tWorkOrders("subtitle")}</p>
              </div>
              <div className="flex items-center space-x-4">
                <div className="text-right">
                  <div className="text-3xl font-bold text-blue-600">{table.totalItems}</div>
                  <div className="text-sm text-slate-500">{tWorkOrders("totalWorkOrders")}</div>
                </div>
                <button type="button"
                  onClick={handleCreate}
                  className="btn-primary flex items-center space-x-2"
                >
                  <PlusIcon className="w-4 h-4" />
                  <span>{tWorkOrders("addWorkOrder")}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Work Orders Table */}
        <div className="col-span-full bento-item panel">
          <div className="flex flex-wrap items-center justify-between mb-4 gap-3">
            <div className="card-title">{tWorkOrders("allWorkOrders")}</div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={table.searchInput}
                onChange={(e) => table.setSearchInput(e.target.value)}
                className="input-field"
                placeholder={tWorkOrders("searchPlaceholder")}
                aria-label={tWorkOrders("searchPlaceholder")}
              />
              <select
                value={table.filters.status}
                onChange={(e) => { table.setFilters({ ...table.filters, status: e.target.value }); table.setPage(1); }}
                className="input-field"
                aria-label={tWorkOrders('table.status')}
              >
                <option value="">{tWorkOrders('filters.allStatuses')}</option>
                <option value="pending">{tWorkOrders('status.pending')}</option>
                <option value="in_progress">{tWorkOrders('status.in_progress')}</option>
                <option value="completed">{tWorkOrders('status.completed')}</option>
                <option value="cancelled">{tWorkOrders('status.cancelled')}</option>
              </select>
              <select
                value={table.filters.priority}
                onChange={(e) => { table.setFilters({ ...table.filters, priority: e.target.value }); table.setPage(1); }}
                className="input-field"
                aria-label={tWorkOrders('table.priority')}
              >
                <option value="">{tWorkOrders('filters.allPriorities')}</option>
                <option value="low">{tWorkOrders('priority.low')}</option>
                <option value="medium">{tWorkOrders('priority.medium')}</option>
                <option value="high">{tWorkOrders('priority.high')}</option>
              </select>
            </div>
          </div>

          <div className="mb-4">
            <SavedViewsBar
              views={savedViews}
              activeViewId={activeSavedViewId}
              onApply={applySavedView}
              onSaveCurrent={(name) => void saveCurrentView(name)}
              onDelete={(view) => void deleteSavedView(view)}
              saveLabel={tCommon('savedViews.save')}
              namePlaceholder={tCommon('savedViews.namePlaceholder')}
              emptyLabel={tCommon('savedViews.empty')}
              deleteLabel={tCommon('savedViews.delete')}
            />
          </div>

          <VirtualizedDataTable
            columns={columns}
            rows={table.items}
            rowKey={(wo) => wo._id}
            loading={table.loading}
            error={table.error}
            onRetry={table.reload}
            emptyMessage={table.searchInput ? tWorkOrders("empty.search") : tWorkOrders("empty.default")}
            loadingLabel={tCommon('loading')}
            errorRetryLabel={tCommon('retry')}
            sortField={table.sortField}
            sortDirection={table.sortDirection}
            onSortChange={table.toggleSort}
            ariaLabel={tWorkOrders('allWorkOrders')}
            // Fits a full page of rows without its own nested scrollbar (double scroll).
            height={Math.max(480, table.limit * 60)}
          />

          <div className="col-span-full mt-4">
            <Pagination
              page={table.page}
              totalPages={table.totalPages}
              totalItems={table.totalItems}
              limit={table.limit}
              onPageChange={table.setPage}
            />
          </div>
        </div>
      </div>

      <Modal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          resetForm();
        }}
        title={editingWorkOrder ? tWorkOrders("modal.editTitle") : tWorkOrders("modal.addTitle")}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="work-orders-theme space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">
                {tWorkOrders("form.reference", { default: "Work Order Reference" })}
              </label>
              <input
                type="text"
                value={formData.ot_id}
                onChange={(e) => setFormData({ ...formData, ot_id: e.target.value })}
                className="input-field"
                title={tWorkOrders("form.reference", { default: "Work Order Reference" })}
                placeholder={tWorkOrders("form.reference", { default: "Work Order Reference" })}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">
                {tWorkOrders("form.priority")}
              </label>
              <select
                value={formData.priorite}
                onChange={(e) => setFormData({ ...formData, priorite: e.target.value })}
                className="input-field"
                title={tWorkOrders("form.priority")}
              >
                <option value="low">{tWorkOrders("priority.low")}</option>
                <option value="medium">{tWorkOrders("priority.medium")}</option>
                <option value="high">{tWorkOrders("priority.high")}</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">
              {tWorkOrders("form.description")}
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="input-field"
              rows={3}
              title={tWorkOrders("form.description")}
              placeholder={tWorkOrders("form.description")}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">
                {tWorkOrders("form.machine")}
              </label>
              <select
                value={formData.machine_id}
                onChange={(e) => setFormData({ ...formData, machine_id: e.target.value })}
                className="input-field"
                title={tWorkOrders("form.machine")}
              >
                <option value="">{tWorkOrders("placeholders.selectMachine")}</option>
                {machines.map((machine) => (
                  <option key={machine._id} value={machine._id}>
                    {machine.machine_id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">
                {tWorkOrders("form.technician")}
              </label>
              <select
                value={formData.technician_id}
                onChange={(e) => setFormData({ ...formData, technician_id: e.target.value })}
                className="input-field"
                title={tWorkOrders("form.technician")}
              >
                <option value="">{tWorkOrders("placeholders.selectTechnician")}</option>
                {users.map((user) => (
                  <option key={user._id} value={user._id}>
                    {user.nom_complet}
                  </option>
                ))}
              </select>
              {selectedTechnician && (
                <div className="mt-3 flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <ProfileAvatar
                    name={selectedTechnician.nom_complet}
                    photo={selectedTechnician.photo}
                    alt={selectedTechnician.nom_complet}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-800 truncate">{selectedTechnician.nom_complet}</div>
                    <div className="text-xs text-slate-500">{tWorkOrders("form.technician")}</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">
                {tWorkOrders("form.status")}
              </label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="input-field"
                title={tWorkOrders("form.status")}
              >
                <option value="pending">{tWorkOrders("status.pending")}</option>
                <option value="in_progress">{tWorkOrders("status.in_progress")}</option>
                <option value="completed">{tWorkOrders("status.completed")}</option>
                <option value="cancelled">{tWorkOrders("status.cancelled")}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">
                {tWorkOrders("form.estimatedDuration")}
              </label>
              <input
                type="number"
                value={formData.estimated_duration}
                onChange={(e) => setFormData({ ...formData, estimated_duration: e.target.value })}
                className="input-field"
                min="0"
                step="0.5"
                title={tWorkOrders("form.estimatedDuration")}
                placeholder={tWorkOrders("form.estimatedDuration")}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">
                {tWorkOrders("form.startDate")}
              </label>
              <input
                type="date"
                value={formData.date_start}
                onChange={(e) => setFormData({ ...formData, date_start: e.target.value })}
                className="input-field"
                title={tWorkOrders("form.startDate")}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">
                {tWorkOrders("form.endDate")}
              </label>
              <input
                type="date"
                value={formData.date_end}
                onChange={(e) => setFormData({ ...formData, date_end: e.target.value })}
                className="input-field"
                title={tWorkOrders("form.endDate")}
              />
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={() => {
                setShowModal(false);
                resetForm();
              }}
              className="btn-secondary"
            >
              {tCommon("cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? (
                <div className="flex items-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>{tCommon("saving")}</span>
                </div>
              ) : (
                workOrderSubmitLabel
              )}
            </button>
          </div>
        </form>
      </Modal>
    </DashboardLayout>
  );
}
