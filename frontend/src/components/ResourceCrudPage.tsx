'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircleIcon, ExclamationTriangleIcon, PencilIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import DashboardLayout from '@/components/DashboardLayout';
import DynamicSearchControls from '@/components/DynamicSearchControls';
import { Modal } from '@/components/Modal';
import Pagination from '@/components/Pagination';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { ALL_FIELDS_TOKEN, getSearchableFields, matchesDynamicSearch } from '@/services/dynamicSearch';
import { displayText } from '@/services/displayValues';
import { normalizeApiItems, readPaginationMeta } from '@/services/pagination';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { WidgetErrorFallback } from '@/components/WidgetErrorFallback';

export interface SelectOption { value: string; label: string }
export interface CrudField {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'datetime-local' | 'textarea' | 'select';
  required?: boolean;
  options?: SelectOption[];
  render?: (value: unknown, item: Record<string, unknown>) => string;
  toFormValue?: (value: unknown, item: Record<string, unknown>) => unknown;
}

interface Props {
  title: string;
  heading?: string;
  description?: string;
  tableTitle?: string;
  totalLabel?: string;
  fields: CrudField[];
  emptyForm: Record<string, unknown>;
  load: (page: number, limit: number) => Promise<{ data: unknown }>;
  createItem: (data: Record<string, unknown>) => Promise<unknown>;
  updateItem: (id: string, data: Record<string, unknown>) => Promise<unknown>;
  deleteItem: (id: string) => Promise<unknown>;
  labels: {
    add: string;
    edit: string;
    delete: string;
    actions: string;
    cancel: string;
    save: string;
    loading: string;
    empty: string;
    filteredEmpty?: string;
    confirmDelete: string;
    loadFailed: string;
    saveFailed: string;
    deleteFailed: string;
    createSuccess?: string;
    updateSuccess?: string;
    deleteSuccess?: string;
    allFields?: string;
    searchPlaceholder?: string;
  };
  normalize?: (form: Record<string, unknown>) => Record<string, unknown>;
  searchable?: boolean;
  getItemId?: (item: Record<string, unknown>) => string;
}

function referenceLabel(value: unknown): string {
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    return displayText(item.capteur_id ?? item.mod_type_id ?? item.part_id ?? item.nom_module ?? item.nom_piece);
  }
  return displayText(value);
}

export default function ResourceCrudPage(props: Props) {
  return (
    <ErrorBoundary
      boundaryName="resource-crud-page"
      fallback={(_error, reset) => <WidgetErrorFallback onRetry={reset} />}
    >
      <ResourceCrudPageInner {...props} />
    </ErrorBoundary>
  );
}

function ResourceCrudPageInner({
  title,
  heading,
  description,
  tableTitle,
  totalLabel,
  fields,
  emptyForm,
  load,
  createItem,
  updateItem,
  deleteItem,
  labels,
  normalize,
  searchable = false,
  getItemId = (item) => String(item._id),
}: Props) {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>(emptyForm);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSearchField, setSelectedSearchField] = useState(ALL_FIELDS_TOKEN);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const limit = 10;

  const notify = (type: 'success' | 'error', message?: string) => {
    if (!message) return;
    setNotification({ type, message });
    window.setTimeout(() => setNotification(null), 5000);
  };

  const loadItems = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await load(page, limit);
      setItems(normalizeApiItems<Record<string, unknown>>(response.data));
      const meta = readPaginationMeta(response.data);
      setTotalPages(meta?.totalPages ?? 1);
      const payload = response.data as { totalItems?: number };
      setTotalItems(Number(payload?.totalItems ?? normalizeApiItems(response.data).length));
    } catch {
      setError(labels.loadFailed);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadItems(); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); }, [searchTerm, selectedSearchField]);

  const visibleFields = useMemo(() => fields, [fields]);
  const searchableFields = useMemo(() => getSearchableFields(items), [items]);
  const visibleItems = useMemo(
    () => searchable ? items.filter((item) => matchesDynamicSearch(item, searchTerm, selectedSearchField)) : items,
    [items, searchTerm, searchable, selectedSearchField],
  );
  const startCreate = () => { setEditing(null); setForm({ ...emptyForm }); setOpen(true); };
  const startEdit = (item: Record<string, unknown>) => {
    const values = { ...emptyForm };
    fields.forEach((field) => {
      let value = field.toFormValue ? field.toFormValue(item[field.key], item) : item[field.key];
      if (value && typeof value === 'object') value = (value as Record<string, unknown>)._id;
      if (field.type === 'datetime-local' && value) value = new Date(String(value)).toISOString().slice(0, 16);
      values[field.key] = value ?? '';
    });
    setEditing(item);
    setForm(values);
    setOpen(true);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const payload = normalize ? normalize(form) : form;
      if (editing) {
        await updateItem(getItemId(editing), payload);
        notify('success', labels.updateSuccess);
      } else {
        await createItem(payload);
        notify('success', labels.createSuccess);
      }
      setOpen(false);
      await loadItems();
    } catch {
      setError(labels.saveFailed);
    } finally {
      setSubmitting(false);
    }
  };
  const remove = async (id: string) => {
    if (!window.confirm(labels.confirmDelete)) return;
    try {
      await deleteItem(id);
      notify('success', labels.deleteSuccess);
      await loadItems();
    } catch {
      setError(labels.deleteFailed);
      notify('error', labels.deleteFailed);
    }
  };
  const renderCellValue = (field: CrudField, item: Record<string, unknown>) => {
    const value = field.render ? field.render(item[field.key], item) : referenceLabel(item[field.key]);
    return <span className="block max-w-[18rem] truncate" title={value}>{value}</span>;
  };

  return <ProtectedRoute allowedRoles={['admin']}><DashboardLayout title={title}>
    {notification && (
      <div className={`fixed right-4 top-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-lg border p-4 shadow-lg ${notification.type === 'success' ? 'border-green-200 bg-green-100 text-green-800' : 'border-red-200 bg-red-100 text-red-800'}`}>
        {notification.type === 'success' ? <CheckCircleIcon className="h-5 w-5 shrink-0" /> : <ExclamationTriangleIcon className="h-5 w-5 shrink-0" />}
        <span className="min-w-0">{notification.message}</span>
        <button type="button" onClick={() => setNotification(null)} className="ms-2 text-gray-500 hover:text-gray-700" aria-label={labels.cancel}>x</button>
      </div>
    )}
    {error && <div className="notification error mb-4">{error}</div>}
    {(heading || description || totalLabel) && (
      <div className="bento-grid mb-6">
        <div className="panel col-span-full bento-item">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              {heading && <h1 className="truncate text-2xl font-bold text-slate-800" title={heading}>{heading}</h1>}
              {description && <p className="mt-1 text-slate-600">{description}</p>}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-4">
              {totalLabel && (
                <div className="text-end">
                  <div className="text-3xl font-bold text-blue-600">{totalItems}</div>
                  <div className="text-sm text-slate-500">{totalLabel}</div>
                </div>
              )}
              <button className="btn-primary inline-flex min-w-0 items-center gap-2" onClick={startCreate}>
                <PlusIcon className="h-5 w-5 shrink-0" />
                <span className="truncate" title={labels.add}>{labels.add}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    <div className="panel min-w-0 p-4 md:p-6">
      <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
        {tableTitle ? <div className="card-title mb-0">{tableTitle}</div> : <div />}
        {searchable && (
          <DynamicSearchControls
            className=""
            selectedField={selectedSearchField}
            onSelectedFieldChange={setSelectedSearchField}
            searchableFields={searchableFields}
            allFieldsLabel={labels.allFields ?? 'All fields'}
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            searchPlaceholder={labels.searchPlaceholder ?? labels.empty}
          />
        )}
        {!heading && !description && !totalLabel && <button className="btn-primary inline-flex min-w-0 items-center gap-2" onClick={startCreate}>
          <PlusIcon className="h-5 w-5 shrink-0" />
          <span className="truncate" title={labels.add}>{labels.add}</span>
        </button>}
      </div>
      <div className="min-w-0 overflow-x-auto">
        <table className="data-table responsive-table">
          <thead>
            <tr>
              {visibleFields.map((field) => (
                <th key={field.key} title={field.label}>
                  <span className="block max-w-full truncate">{field.label}</span>
                </th>
              ))}
              <th title={labels.actions}>
                <span className="block max-w-full truncate">{labels.actions}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={fields.length + 1}>{labels.loading}</td></tr>
            ) : visibleItems.length === 0 ? (
              <tr><td colSpan={fields.length + 1}>{searchTerm ? (labels.filteredEmpty ?? labels.empty) : labels.empty}</td></tr>
            ) : visibleItems.map((item) => (
              <tr key={getItemId(item)}>
                {visibleFields.map((field) => <td key={field.key}>{renderCellValue(field, item)}</td>)}
                <td className="whitespace-nowrap">
                  <div className="flex gap-2">
                    <button className="btn-secondary p-2" onClick={() => startEdit(item)} title={labels.edit} aria-label={labels.edit}>
                      <PencilIcon className="h-4 w-4 shrink-0" />
                    </button>
                    <button className="btn-danger p-2" onClick={() => void remove(getItemId(item))} title={labels.delete} aria-label={labels.delete}>
                      <TrashIcon className="h-4 w-4 shrink-0" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalItems > 0 && <Pagination page={page} totalPages={totalPages} totalItems={totalItems} limit={limit} onPageChange={setPage} className="mt-4" />}
    </div>
    <Modal isOpen={open} onClose={() => setOpen(false)} title={editing ? labels.edit : labels.add} size="lg">
      <form className="min-w-0 space-y-4" onSubmit={submit}>
        {fields.map((field) => {
          const fieldId = `resource-crud-field-${field.key}`;
          return (
          <div key={field.key} className="min-w-0">
            <label htmlFor={fieldId} className="mb-1 block min-w-0 truncate text-sm font-medium" title={field.label}>
              {field.label}
            </label>
            {field.type === 'select' ? (
              <select
                id={fieldId}
                className="input-field w-full"
                required={field.required}
                value={String(form[field.key] ?? '')}
                onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
              >
                <option value="">---</option>
                {field.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.type === 'textarea' ? (
              <textarea
                id={fieldId}
                className="input-field min-h-24 w-full"
                required={field.required}
                value={String(form[field.key] ?? '')}
                onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
              />
            ) : (
              <input
                id={fieldId}
                className="input-field w-full"
                type={field.type ?? 'text'}
                required={field.required}
                value={String(form[field.key] ?? '')}
                onChange={(e) =>
                  setForm({ ...form, [field.key]: field.type === 'number' ? Number(e.target.value) : e.target.value })
                }
              />
            )}
          </div>
          );
        })}
        <div className="flex min-w-0 flex-wrap justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
            <span className="truncate" title={labels.cancel}>{labels.cancel}</span>
          </button>
          <button className="btn-primary" disabled={submitting}>
            <span className="truncate" title={submitting ? labels.loading : labels.save}>
              {submitting ? labels.loading : labels.save}
            </span>
          </button>
        </div>
      </form>
    </Modal>
  </DashboardLayout></ProtectedRoute>;
}
