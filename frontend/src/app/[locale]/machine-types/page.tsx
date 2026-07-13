'use client';

import { useState, useEffect, useMemo } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import DynamicSearchControls from '@/components/DynamicSearchControls';
import { Modal } from '@/components/Modal';
import { apiService } from '@/services/api';
import { ALL_FIELDS_TOKEN, getSearchableFields } from '@/services/dynamicSearch';
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
    setTimeout(() => setNotification(null), 4000);
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

  const filtered = useMemo(() => machineTypes, [machineTypes]);

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
        notify('success', 'Machine type updated');
      } else {
        await apiService.createMachineType(payload);
        notify('success', 'Machine type created');
      }

      setShowModal(false);
      reset();
      load();
    } catch (err) {
      console.error(err);
      notify('error', 'Operation failed');
    } finally {
      setSubmitting(false);
    }
  }
  async function remove(id: string) {
    if (!confirm('Delete this machine type?')) return;
    await apiService.deleteMachineType(id);
    notify('success', 'Deleted successfully');
    load();
  }

  if (loading) {
    return (
      <DashboardLayout title="Machine Types">
        <div className="flex justify-center items-center min-h-screen">
          Loading...
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="Machine Types">
      {/* NOTIFICATION */}
      {notification && (
        <div
          className={`fixed top-4 right-4 p-3 rounded shadow-lg flex items-center gap-2 ${notification.type === 'success'
            ? 'bg-green-100 text-green-800'
            : 'bg-red-100 text-red-800'
            }`}
        >
          {notification.type === 'success' ? (
            <CheckCircleIcon className="w-5 h-5" />
          ) : (
            <ExclamationTriangleIcon className="w-5 h-5" />
          )}
          {notification.message}
        </div>
      )}

      {/* HEADER */}
      <div className="flex justify-between mb-4 gap-3">
        <DynamicSearchControls
          className="w-full max-w-2xl"
          selectedField={selectedSearchField}
          onSelectedFieldChange={setSelectedSearchField}
          searchableFields={searchableFields}
          allFieldsLabel="All fields"
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          searchPlaceholder="Search..."
        />

        <button onClick={openCreate} className="btn-primary flex gap-2">
          <PlusIcon className="w-4 h-4" />
          Add
        </button>
      </div>

      {/* TABLE */}
      <div className="panel">
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
                <td colSpan={4} className="text-center py-6 text-gray-500">
                  No machine types found
                </td>
              </tr>
            ) : (
              filtered.map((m) => (
                <tr key={m._id}>
                  <td>{m.name}</td>
                  <td>{m.description || '-'}</td>
                  <td>
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(m)}>
                        <PencilIcon className="w-4 h-4" />
                      </button>

                      <button onClick={() => remove(m._id)}>
                        <TrashIcon className="w-4 h-4 text-red-500" />
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

      {/* MODAL */}
      <Modal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          reset();
        }}
        title={editing ? 'Edit Machine Type' : 'Add Machine Type'}
      >
        <form onSubmit={submit} className="space-y-3">


          <input
            className="input-field"
            placeholder="Name"
            value={form.name}
            onChange={(e) =>
              setForm({ ...form, name: e.target.value })
            }
            required
          />

          <textarea
            className="input-field"
            placeholder="Description"
            value={form.description}
            onChange={(e) =>
              setForm({ ...form, description: e.target.value })
            }
          />

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowModal(false)}
            >
              Cancel
            </button>

            <button className="btn-primary" disabled={submitting}>
              {submitting ? 'Saving...' : editing ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </Modal>
    </DashboardLayout>
  );
}
