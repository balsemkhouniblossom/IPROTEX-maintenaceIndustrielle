'use client';

import ResourceCrudPage, { CrudField } from '@/components/ResourceCrudPage';
import { apiService } from '@/services/api';

const fields: CrudField[] = [
  { key: 'name', label: 'Name', required: true },
  { key: 'description', label: 'Description', type: 'textarea', render: (value) => String(value || 'N/A') },
];

export default function MachineTypesPage() {
  return (
    <ResourceCrudPage
      title="MACHINE TYPES MANAGEMENT"
      heading="Machine Types Management"
      description="Manage the machine types used across your fleet"
      tableTitle="ALL MACHINE TYPES"
      totalLabel="Total Machine Types"
      fields={fields}
      emptyForm={{ name: '', description: '' }}
      load={(page, limit) => apiService.getMachineTypes({ page, limit })}
      createItem={(data) => apiService.createMachineType(data)}
      updateItem={(id, data) => apiService.updateMachineType(id, data)}
      deleteItem={(id) => apiService.deleteMachineType(id)}
      searchable
      normalize={(form) => ({ name: form.name, description: form.description })}
      labels={{
        add: 'Add Machine Type',
        edit: 'Edit Machine Type',
        delete: 'Delete',
        actions: 'Actions',
        cancel: 'Cancel',
        save: 'Save',
        loading: 'Saving...',
        empty: 'No machine types available.',
        filteredEmpty: 'No machine types found matching your search.',
        confirmDelete: 'Are you sure you want to delete this machine type? This action cannot be undone.',
        loadFailed: 'Failed to load machine types',
        saveFailed: 'Failed to save machine type',
        deleteFailed: 'Failed to delete machine type',
        createSuccess: 'Machine type created successfully',
        updateSuccess: 'Machine type updated successfully',
        deleteSuccess: 'Machine type deleted successfully',
        allFields: 'All fields',
        searchPlaceholder: 'Search machine types...',
      }}
    />
  );
}
