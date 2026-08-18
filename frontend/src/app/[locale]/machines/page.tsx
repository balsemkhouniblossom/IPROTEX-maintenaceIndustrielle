'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import DynamicSearchControls from '@/components/DynamicSearchControls';
import DocumentAttachmentViewer from '@/components/DocumentAttachmentViewer';
import { Modal } from '@/components/Modal';
import Pagination from '@/components/Pagination';
import MachineHealthBadge from '@/components/predictive-maintenance/MachineHealthBadge';
import { usePredictiveHealth } from '@/hooks/usePredictiveHealth';
import { apiService } from '@/services/api';
import { ALL_FIELDS_TOKEN, getSearchableFields, matchesDynamicSearch } from '@/services/dynamicSearch';
import { sortMachineDocumentsForMachine } from '@/services/machineManuals';
import { PencilIcon, TrashIcon, PlusIcon, ExclamationTriangleIcon, CheckCircleIcon, ClockIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';

interface Machine {
  _id: string;
  machine_id: string;
  serial_no: string;
  type_id: string;
  status: string;
  installation_date: string;
  poids_kg: number;
  fabricant: string;
  model: string;
  location: string;
}

interface MachineType {
  _id: string;
  type_id: number;
  name: string;
  description?: string;
}

type EntityRef = string | { _id?: string; id?: string };

interface DocumentEntity {
  _id: string;
  machine_id: EntityRef;
  type_document?: string;
  file_name: string;
  file_path: string;
  file_url?: string;
  preview_path?: string;
  description?: string;
  tags?: string[];
  status?: string;
}

function machineStatusTranslationKey(status?: string): string {
  switch (status) {
    case 'operational':
      return 'status.operational';
    case 'maintenance':
      return 'status.maintenance';
    case 'out_of_service':
      return 'status.outOfService';
    case 'retired':
      return 'status.retired';
    default:
      return '';
  }
}

function machineStatusClassName(status?: string): string {
  if (status === 'operational') return 'bg-green-100 text-green-800';
  if (status === 'maintenance') return 'bg-yellow-100 text-yellow-800';
  if (status === 'out_of_service') return 'bg-red-100 text-red-800';
  return 'bg-gray-100 text-gray-600';
}

function machineTypeId(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && '_id' in value) {
    return machineTypeId((value as { _id?: unknown })._id);
  }
  return '';
}

function apiItems<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object' && 'items' in value) {
    const items = (value as { items?: unknown }).items;
    if (Array.isArray(items)) return items as T[];
  }
  if (value && typeof value === 'object' && 'data' in value) {
    const data = (value as { data?: unknown }).data;
    if (Array.isArray(data)) return data as T[];
  }
  return [];
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof error.response === 'object' &&
    error.response !== null &&
    'status' in error.response &&
    error.response.status === 404
  );
}

const PAGE_LIMIT = 10;

export default function MachinesPage() {
  const tMachines = useTranslations('machines');
  const tCommon = useTranslations('common');
  const tPredictiveMaintenance = useTranslations('predictiveMaintenance');
  const { healthByMachine } = usePredictiveHealth();
  const router = useRouter();
  const locale = useLocale();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [machineTypes, setMachineTypes] = useState<MachineType[]>([]);
  const [page, setPage] = useState(1);
  const limit = PAGE_LIMIT;
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [previewManual, setPreviewManual] = useState<DocumentEntity | null>(null);
  const previewManualQueueRef = useRef<DocumentEntity[]>([]);
  const [manualsByMachine, setManualsByMachine] = useState<Record<string, DocumentEntity[]>>({});
  const [loadingManualMachineId, setLoadingManualMachineId] = useState<string | null>(null);
  const [editingMachine, setEditingMachine] = useState<Machine | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSearchField, setSelectedSearchField] = useState(ALL_FIELDS_TOKEN);
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [formData, setFormData] = useState({
    machine_id: '',
    serial_no: '',
    type_id: '' as string | number,
    status: 'operational',
    installation_date: '',
    poids_kg: '',
    fabricant: '',
    model: '',
    location: '',
  });

  const loadMachines = useCallback(async () => {
    try {
      const [machinesRes, typesRes] = await Promise.all([
        apiService.getMachines({ page, limit }),
        apiService.getMachineTypes(),
      ]);

      const items = apiItems<Record<string, unknown>>(machinesRes.data);

      const normalized = items.map((m: any) => ({
        ...m,
        type_id: machineTypeId(m.type_id),
      }));

      setMachines(normalized);

      const manualEntries = await Promise.all(
        normalized.map(async (machine: Machine) => {
          try {
            const response = await apiService.getDocumentsByMachine(machine._id);
            const documents = Array.isArray(response.data) ? response.data : [];
            return [machine._id, sortMachineDocumentsForMachine(machine._id, documents)] as const;
          } catch (error) {
            if (!isNotFoundError(error)) {
              console.error(`Error loading manuals for machine ${machine._id}:`, error);
            }
            return [machine._id, []] as const;
          }
        }),
      );

      setManualsByMachine(Object.fromEntries(manualEntries));

      const types = apiItems<MachineType>(typesRes.data);

      setMachineTypes(types);

      setTotalItems(machinesRes.data?.totalItems ?? 0);
      setTotalPages(machinesRes.data?.totalPages ?? 1);
    } catch (error) {
      console.error('Error loading machines:', error);
      showNotification('error', tMachines('notifications.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [page, limit, tMachines]);
  function showNotification(type: 'success' | 'error', message: string) {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  }

  async function refreshMachines() {
    await loadMachines();
    router.refresh();
    window.dispatchEvent(new Event('machines:changed'));
  }

  useEffect(() => {
    loadMachines();
  }, [loadMachines]);

  useEffect(() => {
    const handleMachinesChanged = () => {
      loadMachines();
    };

    window.addEventListener('machines:changed', handleMachinesChanged);
    window.addEventListener('focus', handleMachinesChanged);

    return () => {
      window.removeEventListener('machines:changed', handleMachinesChanged);
      window.removeEventListener('focus', handleMachinesChanged);
    };
    // keep the existing event listener lifecycle stable; loadMachines reads current state when the event fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const machineTypeMap = useMemo(() => {
    const map: Record<string, MachineType> = {};

    machineTypes.forEach((type) => {
      map[String(type._id)] = type;
      map[String(type.type_id)] = type; // fallback if backend uses numeric IDs
    });

    return map;
  }, [machineTypes]);

  const searchableMachines = useMemo(() => {
    const safeMachines = Array.isArray(machines) ? machines : [];

    return safeMachines.map((machine) => ({
      ...machine,
      machine_type_name:
        machineTypeMap[String(machine.type_id)]?.name || '',
    }));
  }, [machines, machineTypeMap]);

  const searchableFields = useMemo(() => {
    if (searchableMachines.length === 0) {
      return [];
    }

    return getSearchableFields(searchableMachines);
  }, [searchableMachines]);

  const filtered = useMemo(
    () => searchableMachines.filter((machine) => matchesDynamicSearch(machine, searchTerm, selectedSearchField)),
    [searchableMachines, searchTerm, selectedSearchField],
  );

  const validateForm = () => {
    if (!formData.machine_id.trim()) {
      showNotification('error', tMachines('notifications.machineCodeRequired', { default: 'Machine code is required' }));
      return false;
    }
    if (!formData.serial_no.trim()) {
      showNotification('error', tMachines('notifications.serialRequired'));
      return false;
    }
    if (!formData.fabricant.trim()) {
      showNotification('error', tMachines('notifications.manufacturerRequired'));
      return false;
    }
    if (!formData.model.trim()) {
      showNotification('error', tMachines('notifications.modelRequired'));
      return false;
    }
    if (!formData.installation_date) {
      showNotification('error', tMachines('notifications.installationRequired'));
      return false;
    }
    return true;
  };

  const resetForm = () => {
    setFormData({
      machine_id: '',
      serial_no: '',
      type_id: '',
      status: 'operational',
      installation_date: '',
      poids_kg: '',
      fabricant: '',
      model: '',
      location: '',
    });
    setEditingMachine(null);
  };

  const handleCreate = () => {
    resetForm();
    setShowModal(true);
  };

  const handleEdit = (machine: Machine) => {
    setEditingMachine(machine);
    setFormData({
      machine_id: machine.machine_id,
      serial_no: machine.serial_no,
      type_id: machine.type_id || '',
      status: machine.status,
      installation_date: machine.installation_date ? machine.installation_date.split('T')[0] : '',
      poids_kg: machine.poids_kg?.toString() || '',
      fabricant: machine.fabricant || '',
      model: machine.model || '',
      location: machine.location || '',
    });
    setShowModal(true);
  };

  const openManualQueue = (manuals: DocumentEntity[]) => {
    previewManualQueueRef.current = manuals;
    setPreviewManual(manuals[0] ?? null);
  };

  // A machine can have several manual-like documents (e.g. an uploaded PDF
  // whose underlying file is missing, plus a seeded xlsx that still works).
  // If the one we're showing fails to load, fall through to the next one
  // instead of leaving the user stuck on a broken preview.
  const handleManualLoadError = () => {
    const queue = previewManualQueueRef.current;
    const currentIndex = previewManual ? queue.findIndex((doc) => doc._id === previewManual._id) : -1;
    const next = queue[currentIndex + 1];
    if (next) {
      setPreviewManual(next);
      return;
    }

    previewManualQueueRef.current = [];
    setPreviewManual(null);
    showNotification('error', tMachines('notifications.manualOpenFailed', { default: 'Could not open the machine manual' }));
  };

  const handleOpenManual = async (machine: Machine) => {
    const cachedManuals = manualsByMachine[machine._id];
    if (cachedManuals) {
      if (cachedManuals[0]) {
        openManualQueue(cachedManuals);
      } else {
        showNotification('error', tMachines('notifications.manualNotFound', { default: 'No available document for this machine.' }));
      }
      return;
    }

    setLoadingManualMachineId(machine._id);
    try {
      const response = await apiService.getDocumentsByMachine(machine._id);
      const manuals = sortMachineDocumentsForMachine(machine._id, Array.isArray(response.data) ? response.data : []);
      setManualsByMachine((current) => ({ ...current, [machine._id]: manuals }));

      if (manuals[0]) {
        openManualQueue(manuals);
      } else {
        showNotification('error', tMachines('notifications.manualNotFound', { default: 'No available document for this machine.' }));
      }
    } catch (error) {
      if (isNotFoundError(error)) {
        showNotification('error', tMachines('notifications.manualNotFound', { default: 'No available document for this machine.' }));
      } else {
        console.error('Error opening machine manual:', error);
        showNotification('error', tMachines('notifications.manualOpenFailed', { default: 'Could not open the machine manual' }));
      }
    } finally {
      setLoadingManualMachineId(null);
    }
  };

  const handleDelete = async (machineId: string) => {
    if (confirm(tMachines('notifications.confirmDelete'))) {
      try {
        await apiService.deleteMachine(machineId);
        await refreshMachines();
        showNotification('success', tMachines('notifications.deleted'));
      } catch (error) {
        console.error('Error deleting machine:', error);
        showNotification('error', tMachines('notifications.deleteFailed'));
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
        type_id: formData.type_id || null,
        poids_kg: formData.poids_kg ? Number.parseFloat(formData.poids_kg) : 0,
      };

      if (editingMachine) {
        await apiService.updateMachine(editingMachine._id, data);
        showNotification('success', tMachines('notifications.updated'));
      } else {
        await apiService.createMachine(data);
        showNotification('success', tMachines('notifications.created'));
      }

      setShowModal(false);
      resetForm();
      await refreshMachines();
    } catch (error) {
      console.error('Error saving machine:', error);
      showNotification('error', tMachines('notifications.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <DashboardLayout title={tMachines('pageTitle')}>
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
        </div>
      </DashboardLayout>
    );
  }

  const submitButtonLabel = editingMachine
    ? tMachines('button.update')
    : tMachines('button.create');

  return (
    <DashboardLayout title={tMachines('pageTitle')}>
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
          <button type="button"
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
                <h1 className="text-2xl font-bold text-slate-800">{tMachines('heading')}</h1>
                <p className="text-slate-600 mt-1">{tMachines('description')}</p>
              </div>
              <div className="flex items-center space-x-4">
                <div className="text-right">
                  <div className="text-3xl font-bold text-blue-600">{totalItems}</div>
                  <div className="text-sm text-slate-500">{tMachines('totalMachines')}</div>
                </div>
                <button type="button"
                  onClick={handleCreate}
                  className="btn-primary flex items-center space-x-2"
                >
                  <PlusIcon className="w-4 h-4" />
                  <span>{tMachines('addMachine')}</span>
                </button>
              </div>
            </div>

            {/* Search Bar */}
            <DynamicSearchControls
              selectedField={selectedSearchField}
              onSelectedFieldChange={setSelectedSearchField}
              searchableFields={searchableFields}
              allFieldsLabel={tCommon('table.allFields', { default: 'All fields' })}
              searchTerm={searchTerm}
              onSearchTermChange={setSearchTerm}
              searchPlaceholder={tMachines('searchPlaceholder')}
            />
          </div>
        </div>

        {/* Machines Table */}
        <div className="col-span-full bento-item panel">
          <div className="card-title">{tMachines('allMachines')}</div>
          <div className="wide-table-scroll">
            <table className="table wide-table">
              <colgroup>
                <col className="machines-table__code" />
                <col className="machines-table__serial" />
                <col className="machines-table__manufacturer" />
                <col className="machines-table__model" />
                <col className="machines-table__type" />
                <col className="machines-table__status" />
                <col className="machines-table__health" />
                <col className="machines-table__date" />
                <col className="machines-table__weight" />
                <col className="machines-table__location" />
                <col className="machines-table__actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>{tMachines('table.machineCode', { default: 'Machine Code' })}</th>
                  <th>{tMachines('table.serialNumber')}</th>
                  <th>{tMachines('table.manufacturer')}</th>
                  <th>{tMachines('table.model')}</th>
                  <th>{tMachines('table.type')}</th>
                  <th>{tMachines('table.status')}</th>
                  <th>{tPredictiveMaintenance('table.health')}</th>
                  <th>{tMachines('table.installationDate')}</th>
                  <th>{tMachines('table.weight')}</th>
                  <th>{tMachines('table.location')}</th>
                  <th>{tCommon('table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="text-center py-8 text-gray-500">
                      {searchTerm ? tMachines('empty.search') : tMachines('empty.default')}
                    </td>
                  </tr>
                ) : (
                  filtered.map((machine: Machine) => {
                    const machineType = machineTypeMap[String(machine.type_id)];
                    const statusTranslationKey = machineStatusTranslationKey(machine.status);
                    return (
                      <tr key={machine._id}>
                        <td className="font-medium">
                          <button
                            type="button"
                            onClick={() => handleOpenManual(machine)}
                            disabled={loadingManualMachineId === machine._id}
                            aria-label={tMachines('actions.openManual', { default: 'Open manual' })}
                            title={tMachines('actions.openManual', { default: 'Open manual' })}
                            className="inline-flex max-w-full items-center gap-1.5 text-left font-semibold text-blue-700 hover:text-blue-900 disabled:cursor-wait disabled:text-slate-400"
                          >
                            <DocumentTextIcon className="h-4 w-4 shrink-0" />
                            <span className="truncate">{machine.machine_id || tCommon('notAvailable')}</span>
                          </button>
                        </td>
                        <td>{machine.serial_no}</td>
                        <td>{machine.fabricant || tCommon('notAvailable')}</td>
                        <td>{machine.model || tCommon('notAvailable')}</td>
                        <td>{machineType?.name || tCommon('notAvailable')}</td>
                        <td>
                          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${machineStatusClassName(machine.status)}`}>
                            {statusTranslationKey
                              ? tMachines(statusTranslationKey)
                              : tCommon('notAvailable')}
                          </span>
                        </td>
                        <td>
                          <MachineHealthBadge status={healthByMachine[machine._id]} />
                        </td>
                        <td>
                          {machine.installation_date
                            ? new Date(machine.installation_date).getFullYear()
                            : tCommon('notAvailable')}
                        </td>
                        <td>
                          {machine.poids_kg != null
                            ? `${machine.poids_kg} kg`
                            : tCommon('notAvailable')}
                        </td>

                        <td>
                          {machine.location || tCommon('notAvailable')}
                        </td>

                        <td>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => router.push(`/${locale}/machines/${machine._id}`)}
                              aria-label={tMachines('actions.viewTimeline', { default: 'View timeline' })}
                              title={tMachines('actions.viewTimeline', { default: 'View timeline' })}
                              className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
                            >
                              <ClockIcon className="h-4 w-4 shrink-0" />
                              <span>{tMachines('actions.viewTimeline', { default: 'Timeline' })}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleEdit(machine)}
                              aria-label={tCommon('edit')}
                              title={tCommon('edit')}
                              className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
                            >
                              <PencilIcon className="h-4 w-4 shrink-0" />
                              <span>{tCommon('edit')}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(machine._id)}
                              aria-label={tCommon('delete')}
                              title={tCommon('delete')}
                              className="btn-danger inline-flex items-center gap-1.5 px-3 py-2 text-xs"
                            >
                              <TrashIcon className="h-4 w-4 shrink-0" />
                              <span>{tCommon('delete')}</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-6">
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

      <Modal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          resetForm();
        }}
        title={editingMachine ? tMachines('modal.edit') : tMachines('modal.add')}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">
                {tMachines('form.machineCode', { default: 'Machine Code' })}
              </label>
              <input
                type="text"
                value={formData.machine_id}
                onChange={(e) => setFormData({ ...formData, machine_id: e.target.value })}
                className="input-field"
                title={tMachines('form.machineCode', { default: 'Machine Code' })}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">
                {tMachines('form.serialNumber')}
              </label>
              <input
                type="text"
                value={formData.serial_no}
                onChange={(e) => setFormData({ ...formData, serial_no: e.target.value })}
                className="input-field"
                title={tMachines('form.serialNumber')}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">
                {tMachines('form.manufacturer')}
              </label>
              <input
                type="text"
                value={formData.fabricant}
                onChange={(e) => setFormData({ ...formData, fabricant: e.target.value })}
                className="input-field"
                title={tMachines('form.manufacturer')}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">
                {tMachines('form.model')}
              </label>
              <input
                type="text"
                value={formData.model}
                onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                className="input-field"
                title={tMachines('form.model')}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">
                {tMachines('form.machineType')}
              </label>
              <select
                value={formData.type_id}
                onChange={(e) => setFormData({ ...formData, type_id: e.target.value })}
                className="input-field"
                title={tMachines('form.machineType')}
                required
              >
                <option value="">{tMachines('placeholders.selectType')}</option>

                {machineTypes.map((type) => (
                  <option key={type._id} value={type._id}>
                    {type.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">
                {tMachines('form.status')}
              </label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="input-field"
                title={tMachines('form.status')}
              >
                <option value="operational">{tMachines('options.operational')}</option>
                <option value="maintenance">{tMachines('options.maintenance')}</option>
                <option value="out_of_service">{tMachines('options.outOfService')}</option>
                <option value="retired">{tMachines('options.retired')}</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">
                {tMachines('form.installationDate')}
              </label>
              <input
                type="date"
                value={formData.installation_date}
                onChange={(e) => setFormData({ ...formData, installation_date: e.target.value })}
                className="input-field"
                title={tMachines('form.installationDate')}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">
                {tMachines('form.weight')}
              </label>
              <input
                type="number"
                value={formData.poids_kg}
                onChange={(e) => setFormData({ ...formData, poids_kg: e.target.value })}
                className="input-field"
                min="0"
                step="0.1"
                title={tMachines('form.weight')}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">
              {tMachines('form.location')}
            </label>
            <input
              type="text"
              value={formData.location}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              className="input-field"
              title={tMachines('form.location')}
            />
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
              {tCommon('cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? (
                <div className="flex items-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>{tCommon('saving')}</span>
                </div>
              ) : (
                submitButtonLabel
              )}
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        isOpen={Boolean(previewManual)}
        onClose={() => {
          previewManualQueueRef.current = [];
          setPreviewManual(null);
        }}
        title={previewManual?.file_name || tMachines('actions.openManual', { default: 'Open manual' })}
        size="xl"
      >
        {previewManual ? (
          <DocumentAttachmentViewer
            document={previewManual}
            title={previewManual.file_name}
            onError={handleManualLoadError}
          />
        ) : null}
      </Modal>
    </DashboardLayout>
  );
}
