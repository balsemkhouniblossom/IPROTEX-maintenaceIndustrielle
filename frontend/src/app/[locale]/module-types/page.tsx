'use client';

import ResourceCrudPage, { CrudField } from '@/components/ResourceCrudPage';
import { apiService } from '@/services/api';
import { displayText } from '@/services/displayValues';

const fields: CrudField[] = [
  { key: 'module_type_id', label: 'Module Type Code', required: true, render: (value) => displayText(value, 'N/A') },
  { key: 'nom_module', label: 'Name', required: true, render: (value) => String(value || 'N/A') },
  { key: 'description', label: 'Description', type: 'textarea', render: (value) => String(value || 'N/A') },
  { key: 'category', label: 'Category', render: (value) => String(value || 'N/A') },
  {
    key: 'compatibility',
    label: 'Compatibility',
    render: (value) => Array.isArray(value) && value.length > 0 ? value.join(', ') : 'N/A',
    toFormValue: (value) => Array.isArray(value) ? value.join(', ') : '',
  },
  { key: 'specifications', label: 'Specifications', type: 'textarea', render: (value) => String(value || 'N/A') },
];

export default function ModuleTypesPage() {
  return (
    <ResourceCrudPage
      title="MODULE TYPES MANAGEMENT"
      heading="Module Types Management"
      description="Manage different types of modules and components"
      tableTitle="ALL MODULE TYPES"
      totalLabel="Total Module Types"
      fields={fields}
      emptyForm={{
        module_type_id: '',
        nom_module: '',
        description: '',
        category: '',
        compatibility: '',
        specifications: '',
      }}
      load={(page, limit) => apiService.getModuleTypes({ page, limit })}
      createItem={(data) => apiService.createModuleType(data)}
      updateItem={(id, data) => apiService.updateModuleType(id, data)}
      deleteItem={(id) => apiService.deleteModuleType(id)}
      searchable
      normalize={(form) => ({
        ...form,
        compatibility: form.compatibility
          ? String(form.compatibility).split(',').map((entry) => entry.trim())
          : undefined,
      })}
      labels={{
        add: 'Add Module Type',
        edit: 'Edit Module Type',
        delete: 'Delete',
        actions: 'Actions',
        cancel: 'Cancel',
        save: 'Save',
        loading: 'Saving...',
        empty: 'No module types available.',
        filteredEmpty: 'No module types found matching your search.',
        confirmDelete: 'Are you sure you want to delete this module type? This action cannot be undone.',
        loadFailed: 'Failed to load module types',
        saveFailed: 'Failed to save module type',
        deleteFailed: 'Failed to delete module type',
        createSuccess: 'Module type created successfully',
        updateSuccess: 'Module type updated successfully',
        deleteSuccess: 'Module type deleted successfully',
        allFields: 'All fields',
        searchPlaceholder: 'Search module types...',
      }}
    />
  );
}
