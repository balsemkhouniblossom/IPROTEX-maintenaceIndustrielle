'use client';

import { useState, useEffect, useMemo } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import DynamicSearchControls from '@/components/DynamicSearchControls';
import { Modal } from '@/components/Modal';
import { apiService } from '@/services/api';
import { displayText } from '@/services/displayValues';
import { ALL_FIELDS_TOKEN, getSearchableFields, matchesDynamicSearch } from '@/services/dynamicSearch';
import { PencilIcon, TrashIcon, PlusIcon, ExclamationTriangleIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import Pagination from '@/components/Pagination';
interface ModuleType {
  _id: string;
  module_type_id?: string;
  nom_module?: string;
  description?: string;
  category?: string;
  compatibility?: string[];
  specifications?: string;
}

export default function ModuleTypesPage() {
  const [moduleTypes, setModuleTypes] = useState<ModuleType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingModuleType, setEditingModuleType] = useState<ModuleType | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedSearchField, setSelectedSearchField] = useState(ALL_FIELDS_TOKEN);
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [formData, setFormData] = useState({
    module_type_id: '',
    nom_module: '',
    description: '',
    category: '',
    compatibility: '',
    specifications: '',
  });

  useEffect(() => {
    loadModuleTypes();
  }, [page]);
  useEffect(() => {
    setPage(1);
  }, [searchTerm, selectedSearchField]);
  async function loadModuleTypes() {
    try {
      const response = await apiService.getModuleTypes({
        page,
        limit,
      });
      console.log(response.data);
      setModuleTypes(response.data.items || []);
      setTotalItems(response.data.totalItems || 0);
      setTotalPages(response.data.totalPages || 1);
    } catch (error) {
      console.error('Error loading module types:', error);
    } finally {
      setLoading(false);
    }
  }

  const searchableFields = useMemo(() => getSearchableFields(moduleTypes), [moduleTypes]);

  const filteredModuleTypes = useMemo(
    () => moduleTypes.filter((moduleType) => matchesDynamicSearch(moduleType, searchTerm, selectedSearchField)),
    [moduleTypes, searchTerm, selectedSearchField],
  );

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  const validateForm = () => {
    if (!formData.module_type_id.trim()) {
      showNotification('error', 'Module type code is required');
      return false;
    }
    if (!formData.nom_module.trim()) {
      showNotification('error', 'Module name is required');
      return false;
    }
    return true;
  };

  const resetForm = () => {
    setFormData({
      module_type_id: '',
      nom_module: '',
      description: '',
      category: '',
      compatibility: '',
      specifications: '',
    });
    setEditingModuleType(null);
  };

  const handleCreate = () => {
    resetForm();
    setShowModal(true);
  };

  const handleEdit = (moduleType: ModuleType) => {
    setEditingModuleType(moduleType);
    setFormData({
      module_type_id: moduleType.module_type_id || '',
      nom_module: moduleType.nom_module || '',
      description: moduleType.description || '',
      category: moduleType.category || '',
      compatibility: moduleType.compatibility?.join(', ') || '',
      specifications: moduleType.specifications || '',
    });
    setShowModal(true);
  };

  const handleDelete = async (moduleTypeId: string) => {
    if (confirm('Are you sure you want to delete this module type? This action cannot be undone.')) {
      try {
        await apiService.deleteModuleType(moduleTypeId);
        await loadModuleTypes();
        showNotification('success', 'Module type deleted successfully');
      } catch (error) {
        console.error('Error deleting module type:', error);
        showNotification('error', 'Failed to delete module type');
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
        compatibility: formData.compatibility ? formData.compatibility.split(',').map(s => s.trim()) : undefined,
      };

      if (editingModuleType) {
        await apiService.updateModuleType(editingModuleType._id, data);
        showNotification('success', 'Module type updated successfully');
      } else {
        await apiService.createModuleType(data);
        showNotification('success', 'Module type created successfully');
      }

      setShowModal(false);
      resetForm();
      await loadModuleTypes();
    } catch (error) {
      console.error('Error saving module type:', error);
      showNotification('error', 'Failed to save module type');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <DashboardLayout title="MODULE TYPES MANAGEMENT">
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="MODULE TYPES MANAGEMENT">
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
                <h1 className="text-2xl font-bold text-slate-800">Module Types Management</h1>
                <p className="text-slate-600 mt-1">Manage different types of modules and components</p>
              </div>
              <div className="flex items-center space-x-4">
                <div className="text-right">
                  <div className="text-3xl font-bold text-blue-600">{totalItems}</div>
                  <div className="text-sm text-slate-500">Total Module Types</div>
                </div>
                <button
                  onClick={handleCreate}
                  className="btn-primary flex items-center space-x-2"
                >
                  <PlusIcon className="w-4 h-4" />
                  <span>Add Module Type</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Module Types Table */}
        <div className="col-span-full bento-item panel">
          <div className="flex items-center justify-between mb-4 gap-3">
            <div className="card-title">ALL MODULE TYPES</div>
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
              searchPlaceholder="Search module types..."
            />
          </div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Module Type Code</th>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Compatibility</th>
                  <th>Specifications</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredModuleTypes.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-gray-500">
                      {searchTerm ? 'No module types found matching your search.' : 'No module types available.'}
                    </td>
                  </tr>
                ) : (
                  filteredModuleTypes.map((module: ModuleType) => (
                    <tr key={module._id}>
                      <td className="font-medium">{displayText(module.module_type_id, 'N/A')}</td>
                      <td>{module.nom_module || 'N/A'}</td>
                      <td>{module.description || 'N/A'}</td>
                      <td>{module.category || 'N/A'}</td>
                      <td>{module.compatibility?.join(', ') || 'N/A'}</td>
                      <td>{module.specifications || 'N/A'}</td>
                      <td>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleEdit(module)}
                            aria-label="Edit"
                            title="Edit"
                            className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
                          >
                            <PencilIcon className="h-4 w-4 shrink-0" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(module._id)}
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
          resetForm();
        }}
        title={editingModuleType ? 'Edit Module Type' : 'Add New Module Type'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">
                Module Type Code
              </label>
              <input
                type="text"
                value={formData.module_type_id}
                onChange={(e) => setFormData({ ...formData, module_type_id: e.target.value })}
                className="input-field"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">
                Name
              </label>
              <input
                type="text"
                value={formData.nom_module}
                onChange={(e) => setFormData({ ...formData, nom_module: e.target.value })}
                className="input-field"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">
                Category
              </label>
              <input
                type="text"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="input-field"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-dark mb-1">
                Compatibility (comma-separated)
              </label>
              <input
                type="text"
                value={formData.compatibility}
                onChange={(e) => setFormData({ ...formData, compatibility: e.target.value })}
                className="input-field"
                placeholder="e.g., Machine A, Machine B"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="input-field"
              rows={3}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-dark mb-1">
              Specifications
            </label>
            <textarea
              value={formData.specifications}
              onChange={(e) => setFormData({ ...formData, specifications: e.target.value })}
              className="input-field"
              rows={3}
              placeholder="Technical specifications, requirements, etc."
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
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? (
                <div className="flex items-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>Saving...</span>
                </div>
              ) : (
                `${editingModuleType ? 'Update' : 'Create'} Module Type`
              )}
            </button>
          </div>
        </form>
      </Modal>
    </DashboardLayout>
  );
}
