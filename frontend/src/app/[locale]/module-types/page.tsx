'use client';

import ResourceCrudPage, { CrudField } from '@/components/ResourceCrudPage';
import { apiService } from '@/services/api';
import { displayText } from '@/services/displayValues';

function moduleTypeText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') {
    return displayText(value, 'N/A');
  }
  return 'N/A';
}

function compatibilityText(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return 'N/A';
  return value.map(moduleTypeText).filter((entry) => entry !== 'N/A').join(', ') || 'N/A';
}

function compatibilityFormValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(moduleTypeText).filter((entry) => entry !== 'N/A').join(', ');
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  return '';
}

function compatibilityPayload(value: unknown): string[] | undefined {
  const entries = compatibilityFormValue(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length ? entries : undefined;
}

const fields: CrudField[] = [
  { key: 'module_type_id', label: 'Module Type Code', required: true, render: moduleTypeText },
  { key: 'nom_module', label: 'Name', required: true, render: moduleTypeText },
  { key: 'description', label: 'Description', type: 'textarea', render: moduleTypeText },
  { key: 'category', label: 'Category', render: moduleTypeText },
  {
    key: 'compatibility',
    label: 'Compatibility',
    render: compatibilityText,
    toFormValue: compatibilityFormValue,
  },
  { key: 'specifications', label: 'Specifications', type: 'textarea', render: moduleTypeText },
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
        compatibility: compatibilityPayload(form.compatibility),
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
