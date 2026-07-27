'use client';

import { useState, useEffect, useMemo } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import DynamicSearchControls from '@/components/DynamicSearchControls';
import { Modal } from '@/components/Modal';
import { apiService } from '@/services/api';
import { ALL_FIELDS_TOKEN, getSearchableFields, matchesDynamicSearch } from '@/services/dynamicSearch';
import {
  PencilIcon,
  TrashIcon,
  PlusIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import Pagination from '@/components/Pagination';

interface MachineType {
  _id: string;
  type_id: number;
  name: string;
  description?: string;
}

export default function MachineTypesPage() {
  const [machineTypes, setMachineTypes] = useState<MachineType[]>([]);
  const [loading, setLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<MachineType | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [limit] = useState(10);

  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedSearchField, setSelectedSearchField] = useState(ALL_FIELDS_TOKEN);
  const [notification, setNotification] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const [form, setForm] = useState({
    name: '',
    description: '',
  });

  useEffect(() => {
    setPage(1);
  }, [searchTerm, selectedSearchField]);

  useEffect(() => {
    load();
  }, [page]);
  async function load() {
    try {
      const res = await apiService.getMachineTypes({
        page,
        limit,
      });
      setMachineTypes(res.data.items ?? []);
      setTotalItems(res.data.totalItems ?? 0);
      setTotalPages(res.data.totalPages ?? 1);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setForm({
      name: '',
      description: '',
    });
    setEditing(null);
  }

  function notify(type: 'success' | 'error', message: string) {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  }

  function openCreate() {
    reset();
    setShowModal(true);
  }

  function openEdit(m: MachineType) {
    setEditing(m);
    setForm({
      name: m.name,
      description: m.description || '',
    });
    setShowModal(true);
  }

  const searchableFields = useMemo(() => getSearchableFields(machineTypes), [machineTypes]);

  const filtered = useMemo(
    () => machineTypes.filter((machineType) => matchesDynamicSearch(machineType, searchTerm, selectedSearchField)),
    [machineTypes, searchTerm, selectedSearchField],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);

    try {
      const payload = {
        name: form.name,
        description: form.description,
      };

      if (editing) {
        await apiService.updateMachineType(editing._id, payload);
        notify('success', 'Machine type updated successfully');
      } else {
        await apiService.createMachineType(payload);
        notify('success', 'Machine type created successfully');
      }

      setShowModal(false);
      reset();
      load();
    } catch (err) {
      console.error(err);
      notify('error', 'Failed to save machine type');
    } finally {
      setSubmitting(false);
    }
  }
  async function remove(id: string) {
    if (!confirm('Are you sure you want to delete this machine type? This action cannot be undone.')) return;
    try {
      await apiService.deleteMachineType(id);
      notify('success', 'Machine type deleted successfully');
      load();
    } catch (err) {
      console.error(err);
      notify('error', 'Failed to delete machine type');
    }
  }

  if (loading) {
    return (
      <DashboardLayout title="MACHINE TYPES MANAGEMENT">
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="MACHINE TYPES MANAGEMENT">
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg flex items-center space-x-2 ${notification.type === 'success'
            ? 'bg-green-100 text-green-800 border border-green-200'
            : 'bg-red-100 text-red-800 border border-red-200'
            }`}
        >
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
                <h1 className="text-2xl font-bold text-slate-800">Machine Types Management</h1>
                <p className="text-slate-600 mt-1">Manage the machine types used across your fleet</p>
              </div>
              <div className="flex items-center space-x-4">
                <div className="text-right">
                  <div className="text-3xl font-bold text-blue-600">{totalItems}</div>
                  <div className="text-sm text-slate-500">Total Machine Types</div>
                </div>
                <button
                  onClick={openCreate}
                  className="btn-primary flex items-center space-x-2"
                >
                  <PlusIcon className="w-4 h-4" />
                  <span>Add Machine Type</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Machine Types Table */}
        <div className="col-span-full bento-item panel">
          <div className="flex items-center justify-between mb-4 gap-3">
            <div className="card-title">ALL MACHINE TYPES</div>
            <DynamicSearchControls
              className=""
              selectClassName="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              inputClassName="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent w-full"
              selectedField={selectedSearchField}
              onSelectedFieldChange={setSelectedSearchField}
              searchableFields={searchableFields}
              allFieldsLabel="All fields"
              searchTerm={searchTerm}
              onSearchTermChange={setSearchTerm}
              searchPlaceholder="Search machine types..."
            />
          </div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="text-center py-8 text-gray-500">
                      {searchTerm ? 'No machine types found matching your search.' : 'No machine types available.'}
                    </td>
                  </tr>
                ) : (
                  filtered.map((m) => (
                    <tr key={m._id}>
                      <td className="font-medium">{m.name || 'N/A'}</td>
                      <td>{m.description || 'N/A'}</td>
                      <td>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(m)}
                            aria-label="Edit"
                            title="Edit"
                            className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
                          >
                            <PencilIcon className="h-4 w-4 shrink-0" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(m._id)}
                            aria-label="Delete"
                            title="Delete"
                            className="btn-danger inline-flex items-center gap-1.5 px-3 py-2 text-xs"
                          >
                            <TrashIcon className="h-4 w-4 shrink-0" />
                            <span>Delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
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
          reset();
        }}
        title={editing ? 'Edit Machine Type' : 'Add New Machine Type'}
      >
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">
              Name
            </label>
            <input
              type="text"
              className="input-field"
              value={form.name}
              onChange={(e) =>
                setForm({ ...form, name: e.target.value })
              }
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">
              Description
            </label>
            <textarea
              className="input-field"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              rows={3}
            />
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowModal(false)}
            >
              Cancel
            </button>

            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? (
                <div className="flex items-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>Saving...</span>
                </div>
              ) : (
                `${editing ? 'Update' : 'Create'} Machine Type`
              )}
            </button>
          </div>
        </form>
      </Modal>
    </DashboardLayout>
  );
}
