'use client';

import { ReactNode } from 'react';
import { PencilIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';

interface Column {
  key: string;
  header: string;
  render?: (value: unknown, row: Record<string, unknown>) => ReactNode;
}

interface DataTableProps {
  columns: Column[];
  data: Record<string, unknown>[];
  onEdit?: (item: Record<string, unknown>) => void;
  onDelete?: (item: Record<string, unknown>) => void;
  loading?: boolean;
}

export function DataTable({ columns, data, onEdit, onDelete, loading = false }: DataTableProps) {
  const t = useTranslations('common.table');
  const tCommon = useTranslations('common');

  if (loading) {
    return (
      <div className="panel p-4">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-4 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="table responsive-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} title={column.header}>
                  <span className="block max-w-full truncate">{column.header}</span>
                </th>
              ))}
              {(onEdit || onDelete) && (
                <th className="text-end">
                  {t('actions')}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (onEdit || onDelete ? 1 : 0)}
                  className="text-center py-8 text-gray-500 italic"
                >
                  {t('noData')}
                </td>
              </tr>
            ) : (
              data.map((row, index) => (
                <tr key={index}>
                  {columns.map((column) => (
                    <td key={column.key} className="align-top">
                      {column.render ? (
                        <div className="min-w-0 max-w-full">
                          {column.render(row[column.key], row) as ReactNode}
                        </div>
                      ) : (
                        <span
                          className="block max-w-[18rem] truncate"
                          title={String(row[column.key] ?? '-')}
                        >
                          {String(row[column.key] ?? '-')}
                        </span>
                      )}
                    </td>
                  ))}
                  {(onEdit || onDelete) && (
                    <td className="text-end whitespace-nowrap">
                      <div className="flex shrink-0 justify-end gap-2">
                        {onEdit && (
                          <button
                            onClick={() => onEdit(row)}
                            className="p-1 text-indigo-600 bg-transparent border border-indigo-600 rounded hover:bg-indigo-600 hover:text-white transition-colors"
                            title={t('actions') + ' - ' + tCommon('edit')}
                            aria-label={t('actions') + ' - ' + tCommon('edit')}
                          >
                            <PencilIcon className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {onDelete && (
                          <button
                            onClick={() => onDelete(row)}
                            className="p-1 text-red-600 bg-transparent border border-red-600 rounded hover:bg-red-600 hover:text-white transition-colors"
                            title={t('actions') + ' - ' + tCommon('delete')}
                            aria-label={t('actions') + ' - ' + tCommon('delete')}
                          >
                            <TrashIcon className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
