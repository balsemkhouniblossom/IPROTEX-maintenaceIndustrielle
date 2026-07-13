'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import DynamicSearchControls from '@/components/DynamicSearchControls';
import { Modal } from '@/components/Modal';
import Pagination from '@/components/Pagination';
import { apiService } from '@/services/api';
import { ALL_FIELDS_TOKEN, getSearchableFields, matchesDynamicSearch } from '@/services/dynamicSearch';
import { PencilIcon, TrashIcon, PlusIcon, ExclamationTriangleIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
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

export default function MachinesPage() {
  const tMachines = useTranslations('machines');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [machineTypes, setMachineTypes] = useState<MachineType[]>([]);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
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

      const items = Array.isArray(machinesRes.data?.items)
        ? machinesRes.data.items
        : [];

      const normalized = items.map((m: any) => ({
        ...m,
        type_id:
          typeof m.type_id === 'object'
            ? m.type_id?._id
            : String(m.type_id),
      }));

      setMachines(normalized);

      const types = Array.isArray(typesRes.data)
        ? typesRes.data
        : Array.isArray(typesRes.data?.items)
          ? typesRes.data.items
          : Array.isArray(typesRes.data?.data)
            ? typesRes.data.data
            : [];

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
      showNotification('error', tMachines('notifications.machineIdRequired'));
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
        poids_kg: formData.poids_kg ? parseFloat(formData.poids_kg) : 0,
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
                <p className="text-slate-600 mt-1">{tMachines('description')}</p>
              </div>
              <div className="flex items-center space-x-4">
                <div className="text-right">
                  <div className="text-3xl font-bold text-blue-600">{totalItems}</div>
                  <div className="text-sm text-slate-500">{tMachines('totalMachines')}</div>
                </div>
                <button
                  onClick={handleCreate}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white font-medium shadow-md hover:bg-blue-700 transition-all duration-200"
                >
                  <PlusIcon className="w-5 h-5" />
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
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{tMachines('table.machineId')}</th>
                  <th>{tMachines('table.serialNumber')}</th>
                  <th>{tMachines('table.manufacturer')}</th>
                  <th>{tMachines('table.model')}</th>
                  <th>{tMachines('table.type')}</th>
                  <th>{tMachines('table.status')}</th>
                  <th>{tMachines('table.installationDate')}</th>
                  <th>{tMachines('table.weight')}</th>
                  <th>{tMachines('table.location')}</th>
                  <th>{tCommon('table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-8 text-gray-500">
                      {searchTerm ? tMachines('empty.search') : tMachines('empty.default')}
                    </td>
                  </tr>
                ) : (
                  filtered.map((machine: Machine) => {
                    const machineType = machineTypeMap[String(machine.type_id)];
                    return (
                      <tr key={machine._id}>
                        <td className="font-medium">{machine.machine_id}</td>
                        <td>{machine.serial_no}</td>
                        <td>{machine.fabricant || tCommon('notAvailable')}</td>
                        <td>{machine.model || tCommon('notAvailable')}</td>
                        <td>{machineType?.name || tCommon('notAvailable')}</td>
                        <td>
                          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${machine.status === 'operational' ? 'bg-green-100 text-green-800' :
                            machine.status === 'maintenance' ? 'bg-yellow-100 text-yellow-800' :
                              machine.status === 'out_of_service' ? 'bg-red-100 text-red-800' :
                                'bg-gray-100 text-gray-600'
                            }`}>
                            {machine.status?.replace('_', ' ') || tCommon('role')}
                          </span>
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
                          <div className="flex space-x-2">
                            <button
                              onClick={() => handleEdit(machine)}
                              className="btn-secondary p-2"
                              title={tCommon('edit')}
                            >
                              <PencilIcon className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(machine._id)}
                              className="btn-danger p-2"
                              title={tCommon('delete')}
                            >
                              <TrashIcon className="w-4 h-4" />
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
                {tMachines('form.machineId')}
              </label>
              <input
                type="text"
                value={formData.machine_id}
                onChange={(e) => setFormData({ ...formData, machine_id: e.target.value })}
                className="input-field"
                title={tMachines('form.machineId')}
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
                `${editingMachine ? tMachines('button.update') : tMachines('button.create')}`
              )}
            </button>
          </div>
        </form>
      </Modal>
    </DashboardLayout>
  );
}
