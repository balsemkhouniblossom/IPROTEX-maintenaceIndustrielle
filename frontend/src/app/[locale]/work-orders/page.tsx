"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import DynamicSearchControls from "@/components/DynamicSearchControls";
import { Modal } from "@/components/Modal";
import ProfileAvatar from "@/components/ProfileAvatar";
import Pagination from "@/components/Pagination";
import { apiService } from "@/services/api";
import { ALL_FIELDS_TOKEN, getSearchableFields, matchesDynamicSearch } from "@/services/dynamicSearch";
import { PencilIcon, TrashIcon, PlusIcon, CheckCircleIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
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
  technician_id?: { _id: string; nom_complet: string };
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

export default function WorkOrdersPage() {
  const tWorkOrders = useTranslations("workOrders");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingWorkOrder, setEditingWorkOrder] = useState<WorkOrder | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSearchField, setSelectedSearchField] = useState(ALL_FIELDS_TOKEN);
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

  const loadData = useCallback(async () => {
    try {
      const [workOrdersRes, machinesRes, usersRes] = await Promise.all([
        apiService.getWorkOrders({ page, limit }),
        apiService.getMachines(),
        apiService.getUsers(),
      ]);
      setTotalItems(workOrdersRes.data.totalItems || 0);
      setTotalPages(workOrdersRes.data.totalPages || 1);
      setUsers(usersRes.data.items || []);
      setMachines(machinesRes.data.items || []);
      setWorkOrders(workOrdersRes.data.items || []);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  }, [page, limit]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const handleWorkOrdersChanged = () => {
      loadData();
    };

    window.addEventListener('work-orders:changed', handleWorkOrdersChanged);
    window.addEventListener('focus', handleWorkOrdersChanged);

    return () => {
      window.removeEventListener('work-orders:changed', handleWorkOrdersChanged);
      window.removeEventListener('focus', handleWorkOrdersChanged);
    };
  }, []);

  const searchableWorkOrders = useMemo(
    () =>
      workOrders.map((workOrder) => ({
        ...workOrder,
        machine_label: workOrder.machine_id?.machine_id || '',
        technician_label: workOrder.technician_id?.nom_complet || '',
      })),
    [workOrders],
  );

  const searchableFields = useMemo(() => getSearchableFields(searchableWorkOrders), [searchableWorkOrders]);

  const filteredWorkOrders = useMemo(
    () => searchableWorkOrders.filter((workOrder) => matchesDynamicSearch(workOrder, searchTerm, selectedSearchField)),
    [searchableWorkOrders, searchTerm, selectedSearchField],
  );

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  async function refreshWorkOrders() {
    await loadData();
    router.refresh();
    window.dispatchEvent(new Event('work-orders:changed'));
  }

  const validateForm = () => {
    if (!formData.ot_id.trim()) {
      showNotification('error', tWorkOrders("validation.workOrderIdRequired"));
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setSubmitting(true);
    try {
      const data = {
        ...formData,
        estimated_duration: parseInt(formData.estimated_duration) || undefined,
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

  if (loading) {
    return (
      <DashboardLayout title={tWorkOrders("title")}>
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={tWorkOrders("title")}>
      {/* Notification */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg flex items-center space-x-2 ${notification.type === 'success' ? 'bg-green-100 text-green-800 border border-green-200' : 'bg-red-100 text-red-800 border border-red-200'
          }`}>
          {notification.type === 'success' ? (
            <CheckCircleIcon className="w-5 h-5" />
          ) : (
            <ExclamationTriangleIcon className="w-5 h-5" />
          )}
          <span>{notification.message}</span>
          <button
            onClick={() => setNotification(null)}
            className="ml-2 text-gray-500 hover:text-gray-700"
          >
            ×
          </button>
        </div>
      )}

      <div className="bento-grid">
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
                  <div className="text-3xl font-bold text-blue-600">{totalItems}</div>
                  <div className="text-sm text-slate-500">{tWorkOrders("totalWorkOrders")}</div>
                </div>
                <button
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
          <div className="flex items-center justify-between mb-4 gap-3">
            <div className="card-title">{tWorkOrders("allWorkOrders")}</div>
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
              searchPlaceholder={tWorkOrders("searchPlaceholder")}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{tWorkOrders("table.otId")}</th>
                  <th>{tWorkOrders("table.description")}</th>
                  <th>{tWorkOrders("table.machine")}</th>
                  <th>{tWorkOrders("table.technician")}</th>
                  <th>{tWorkOrders("table.status")}</th>
                  <th>{tWorkOrders("table.priority")}</th>
                  <th>{tWorkOrders("table.created")}</th>
                  <th>{tWorkOrders("table.startDate")}</th>
                  <th>{tWorkOrders("table.endDate")}</th>
                  <th>{tCommon("table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredWorkOrders.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-8 text-gray-500">
                      {searchTerm ? tWorkOrders("empty.search") : tWorkOrders("empty.default")}
                    </td>
                  </tr>
                ) : (
                  filteredWorkOrders.map((wo: WorkOrder) => (
                    <tr key={wo._id}>
                      <td className="font-medium">{wo.ot_id}</td>
                      <td>{wo.description || tCommon("notAvailable")}</td>
                      <td>{wo.machine_id?.machine_id || tCommon("notAvailable")}</td>
                      <td>
                        {wo.technician_id ? (
                          <div className="flex items-center gap-2">
                            <ProfileAvatar
                              name={wo.technician_id.nom_complet}
                              photo={(wo.technician_id as { photo?: string }).photo}
                              alt={wo.technician_id.nom_complet}
                              size="sm"
                            />
                            <span>{wo.technician_id.nom_complet}</span>
                          </div>
                        ) : (
                          tWorkOrders("unassigned")
                        )}
                      </td>
                      <td>
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${wo.status === 'completed' ? 'bg-green-100 text-green-800' :
                          wo.status === 'in_progress' ? 'bg-blue-100 text-blue-800' :
                            'bg-yellow-100 text-yellow-800'
                          }`}>
                          {tWorkOrders(`status.${wo.status}`)}
                        </span>
                      </td>
                      <td>
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${wo.priorite === 'high' ? 'bg-red-100 text-red-800' :
                          wo.priorite === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-green-100 text-green-800'
                          }`}>
                          {tWorkOrders(`priority.${wo.priorite || "low"}`)}
                        </span>
                      </td>
                      <td>{new Date(wo.date_created).toLocaleDateString()}</td>
                      <td>{wo.date_start ? new Date(wo.date_start).toLocaleDateString() : tCommon("notAvailable")}</td>
                      <td>{wo.date_end ? new Date(wo.date_end).toLocaleDateString() : tCommon("notAvailable")}</td>
                      <td>
                        <div className="flex space-x-2">
                          <button
                            onClick={() => handleEdit(wo)}
                            className="btn-secondary p-2"
                            title={tCommon("edit")}
                          >
                            <PencilIcon className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(wo._id)}
                            className="btn-danger p-2"
                            title={tCommon("delete")}
                          >
                            <TrashIcon className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <div className="col-span-full">
              <Pagination
                page={page}
                totalPages={totalPages}
                totalItems={totalItems}
                limit={limit}
                onPageChange={setPage}
              />
            </div>
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
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">
                {tWorkOrders("form.otId")}
              </label>
              <input
                type="text"
                value={formData.ot_id}
                onChange={(e) => setFormData({ ...formData, ot_id: e.target.value })}
                className="input-field"
                title={tWorkOrders("form.otId")}
                placeholder={tWorkOrders("form.otId")}
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
                editingWorkOrder ? tWorkOrders("actions.update") : tWorkOrders("actions.create")
              )}
            </button>
          </div>
        </form>
      </Modal>
    </DashboardLayout>
  );
}
