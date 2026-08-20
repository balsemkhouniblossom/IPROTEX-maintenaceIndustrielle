"use client";

import { PencilIcon, TrashIcon } from "@heroicons/react/24/outline";

type RowActionsProps = Readonly<{
  editLabel: string;
  deleteLabel: string;
  itemLabel: string;
  onEdit: () => void;
  onDelete: () => void;
}>;

export function RowActions({
  editLabel,
  deleteLabel,
  itemLabel,
  onEdit,
  onDelete,
}: RowActionsProps) {
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

export function ModalFormActions({
  cancelLabel,
  submitLabel,
  submitting,
  onCancel,
  withTopBorder = false,
}: ModalFormActionsProps) {
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
