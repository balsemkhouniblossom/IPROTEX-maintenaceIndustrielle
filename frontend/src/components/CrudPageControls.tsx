"use client";

import type { ReactNode } from "react";
import { PencilIcon, PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import DashboardLayout from "@/components/DashboardLayout";
import DynamicSearchControls from "@/components/DynamicSearchControls";
import Pagination from "@/components/Pagination";
import {
  ToastNotification,
  type ToastNotificationState,
} from "@/components/ToastNotification";

type CrudLoadingStateProps = Readonly<{
  title: string;
}>;

export function CrudLoadingState(props: CrudLoadingStateProps) {
  const { title } = props;

  return (
    <DashboardLayout title={title}>
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    </DashboardLayout>
  );
}

type CrudListHeaderProps = Readonly<{
  heading: string;
  description: string;
  totalItems: number;
  totalLabel: string;
  addLabel: string;
  onAdd: () => void;
  selectedField: string;
  onSelectedFieldChange: (field: string) => void;
  searchableFields: string[];
  allFieldsLabel: string;
  searchTerm: string;
  onSearchTermChange: (term: string) => void;
  searchPlaceholder: string;
}>;

export function CrudListHeader(props: CrudListHeaderProps) {
  const {
    heading,
    description,
    totalItems,
    totalLabel,
    addLabel,
    onAdd,
    selectedField,
    onSelectedFieldChange,
    searchableFields,
    allFieldsLabel,
    searchTerm,
    onSearchTermChange,
    searchPlaceholder,
  } = props;

  return (
    <div className="col-span-full mb-6 bento-item">
      <div className="panel">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">{heading}</h1>
            <p className="text-slate-600 mt-1">{description}</p>
          </div>
          <div className="flex items-center space-x-4">
            <div className="text-end">
              <div className="text-3xl font-bold text-blue-600">
                {totalItems}
              </div>
              <div className="text-sm text-slate-500">{totalLabel}</div>
            </div>
            <button
              type="button"
              onClick={onAdd}
              className="btn-primary flex items-center space-x-2"
            >
              <PlusIcon className="w-4 h-4" />
              <span>{addLabel}</span>
            </button>
          </div>
        </div>

        <DynamicSearchControls
          selectedField={selectedField}
          onSelectedFieldChange={onSelectedFieldChange}
          searchableFields={searchableFields}
          allFieldsLabel={allFieldsLabel}
          searchTerm={searchTerm}
          onSearchTermChange={onSearchTermChange}
          searchPlaceholder={searchPlaceholder}
        />
      </div>
    </div>
  );
}

type CrudPageScaffoldProps = Readonly<
  CrudListHeaderProps & {
    title: string;
    notification: ToastNotificationState | null;
    onNotificationClose: () => void;
    closeLabel: string;
    children: ReactNode;
  }
>;

export function CrudPageScaffold(props: CrudPageScaffoldProps) {
  const {
    title,
    notification,
    onNotificationClose,
    closeLabel,
    children,
    ...headerProps
  } = props;

  return (
    <DashboardLayout title={title}>
      <ToastNotification
        notification={notification}
        onClose={onNotificationClose}
        closeLabel={closeLabel}
      />

      <div className="bento-grid">
        <CrudListHeader {...headerProps} />
        {children}
      </div>
    </DashboardLayout>
  );
}

type CrudTablePanelProps = Readonly<{
  title: string;
  page: number;
  totalPages: number;
  totalItems: number;
  limit: number;
  onPageChange: (page: number) => void;
  paginationClassName?: string;
  children: ReactNode;
}>;

export function CrudTablePanel(props: CrudTablePanelProps) {
  const {
    title,
    page,
    totalPages,
    totalItems,
    limit,
    onPageChange,
    paginationClassName = "mt-4",
    children,
  } = props;

  return (
    <div className="col-span-full bento-item panel">
      <div className="card-title">{title}</div>
      <div className="overflow-x-auto">
        {children}
        <div className={paginationClassName}>
          <Pagination
            page={page}
            totalPages={totalPages}
            totalItems={totalItems}
            limit={limit}
            onPageChange={onPageChange}
          />
        </div>
      </div>
    </div>
  );
}

type CrudDataTableColumn<TItem> = Readonly<{
  id: string;
  header: ReactNode;
  render: (item: TItem) => ReactNode;
  className?: string;
}>;

type CrudDataTableProps<TItem> = Readonly<{
  columns: ReadonlyArray<CrudDataTableColumn<TItem>>;
  items: ReadonlyArray<TItem>;
  getRowKey: (item: TItem) => string;
  emptyMessage: string;
  actionsHeader: ReactNode;
  renderActions: (item: TItem) => ReactNode;
}>;

export function CrudDataTable<TItem>(props: CrudDataTableProps<TItem>) {
  const {
    columns,
    items,
    getRowKey,
    emptyMessage,
    actionsHeader,
    renderActions,
  } = props;

  return (
    <table className="table">
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.id}>{column.header}</th>
          ))}
          <th>{actionsHeader}</th>
        </tr>
      </thead>
      <tbody>
        {items.length === 0 ? (
          <tr>
            <td
              colSpan={columns.length + 1}
              className="text-center py-8 text-gray-500"
            >
              {emptyMessage}
            </td>
          </tr>
        ) : (
          items.map((item) => (
            <tr key={getRowKey(item)}>
              {columns.map((column) => (
                <td key={column.id} className={column.className}>
                  {column.render(item)}
                </td>
              ))}
              <td>{renderActions(item)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

type CrudDataTablePanelProps<TItem> = Readonly<
  Omit<CrudTablePanelProps, "children"> & CrudDataTableProps<TItem>
>;

export function CrudDataTablePanel<TItem>(
  props: CrudDataTablePanelProps<TItem>,
) {
  const {
    title,
    page,
    totalPages,
    totalItems,
    limit,
    onPageChange,
    paginationClassName,
    columns,
    items,
    getRowKey,
    emptyMessage,
    actionsHeader,
    renderActions,
  } = props;

  return (
    <CrudTablePanel
      title={title}
      page={page}
      totalPages={totalPages}
      totalItems={totalItems}
      limit={limit}
      onPageChange={onPageChange}
      paginationClassName={paginationClassName}
    >
      <CrudDataTable
        columns={columns}
        items={items}
        getRowKey={getRowKey}
        emptyMessage={emptyMessage}
        actionsHeader={actionsHeader}
        renderActions={renderActions}
      />
    </CrudTablePanel>
  );
}

type AdditionalDetailsFieldProps = Readonly<{
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  title: string;
  placeholder: string;
}>;

export function AdditionalDetailsField(props: AdditionalDetailsFieldProps) {
  const { id, label, value, onChange, title, placeholder } = props;

  return (
    <div>
      <label
        htmlFor={id}
        className="block text-sm font-medium text-gray-dark mb-1"
      >
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="input-field"
        rows={3}
        title={title}
        placeholder={placeholder}
      />
    </div>
  );
}

type FormFieldShellProps = Readonly<{
  label: string;
  children: ReactNode;
}>;

export function FormFieldShell(props: FormFieldShellProps) {
  const { label, children } = props;

  return (
    <div>
      <label className="block text-sm font-medium text-gray-dark mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

type TextInputFieldProps = Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  title: string;
  type?: "text" | "datetime-local";
  required?: boolean;
}>;

export function TextInputField(props: TextInputFieldProps) {
  const { label, value, onChange, title, type = "text", required } = props;

  return (
    <FormFieldShell label={label}>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="input-field"
        title={title}
        required={required}
      />
    </FormFieldShell>
  );
}

type InlineTextInputProps = Readonly<{
  value: string;
  onChange: (value: string) => void;
  title: string;
  className?: string;
  placeholder?: string;
  required?: boolean;
}>;

export function InlineTextInput(props: InlineTextInputProps) {
  const {
    value,
    onChange,
    title,
    className = "input-field",
    placeholder,
    required,
  } = props;

  return (
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={className}
      title={title}
      placeholder={placeholder}
      required={required}
    />
  );
}

type TextAreaFieldProps = Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  title: string;
  rows: number;
  required?: boolean;
  className?: string;
  placeholder?: string;
}>;

export function TextAreaField(props: TextAreaFieldProps) {
  const {
    label,
    value,
    onChange,
    title,
    rows,
    required,
    className = "input-field",
    placeholder,
  } = props;

  return (
    <FormFieldShell label={label}>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={className}
        title={title}
        rows={rows}
        required={required}
        placeholder={placeholder}
      />
    </FormFieldShell>
  );
}

type InlineTextAreaProps = Readonly<{
  value: string;
  onChange: (value: string) => void;
  title: string;
  rows: number;
  className?: string;
  placeholder?: string;
  required?: boolean;
}>;

export function InlineTextArea(props: InlineTextAreaProps) {
  const {
    value,
    onChange,
    title,
    rows,
    className = "input-field",
    placeholder,
    required,
  } = props;

  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={className}
      title={title}
      rows={rows}
      placeholder={placeholder}
      required={required}
    />
  );
}

type InlineSelectOption = Readonly<{
  key: string;
  value: string;
  label: ReactNode;
}>;

type InlineSelectInputProps = Readonly<{
  value: string;
  onChange: (value: string) => void;
  title: string;
  options: ReadonlyArray<InlineSelectOption>;
  placeholder: ReactNode;
  customOptionValue?: string;
  customOptionLabel?: ReactNode;
  required?: boolean;
}>;

export function InlineSelectInput(props: InlineSelectInputProps) {
  const {
    value,
    onChange,
    title,
    options,
    placeholder,
    customOptionValue,
    customOptionLabel,
    required,
  } = props;

  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="input-field"
      title={title}
      required={required}
    >
      <option value="">{placeholder}</option>
      {customOptionValue && (
        <option value={customOptionValue}>{customOptionLabel}</option>
      )}
      {options.map((option) => (
        <option key={option.key} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

type SelectFieldProps = Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  title: string;
  children: ReactNode;
  required?: boolean;
}>;

export function SelectField(props: SelectFieldProps) {
  const { label, value, onChange, title, children, required } = props;

  return (
    <FormFieldShell label={label}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="input-field"
        title={title}
        required={required}
      >
        {children}
      </select>
    </FormFieldShell>
  );
}

type RowActionsProps = Readonly<{
  editLabel: string;
  deleteLabel: string;
  itemLabel: string;
  onEdit: () => void;
  onDelete: () => void;
}>;

export function RowActions(props: RowActionsProps) {
  const { editLabel, deleteLabel, itemLabel, onEdit, onDelete } = props;

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={onEdit}
        aria-label={`${editLabel} ${itemLabel}`}
        title={editLabel}
        className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
      >
        <PencilIcon className="h-4 w-4 shrink-0" />
        <span>{editLabel}</span>
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`${deleteLabel} ${itemLabel}`}
        title={deleteLabel}
        className="btn-danger inline-flex items-center gap-1.5 px-3 py-2 text-xs"
      >
        <TrashIcon className="h-4 w-4 shrink-0" />
        <span>{deleteLabel}</span>
      </button>
    </div>
  );
}

type ModalFormActionsProps = Readonly<{
  cancelLabel: string;
  submitLabel: string;
  submitting: boolean;
  onCancel: () => void;
  withTopBorder?: boolean;
}>;

export function ModalFormActions(props: ModalFormActionsProps) {
  const {
    cancelLabel,
    submitLabel,
    submitting,
    onCancel,
    withTopBorder = false,
  } = props;

  const borderClassName = withTopBorder ? " border-t border-gray-200" : "";

  return (
    <div className={`flex justify-end space-x-3 pt-4${borderClassName}`}>
      <button type="button" onClick={onCancel} className="btn-secondary">
        {cancelLabel}
      </button>
      <button type="submit" className="btn-primary" disabled={submitting}>
        {submitLabel}
      </button>
    </div>
  );
}
