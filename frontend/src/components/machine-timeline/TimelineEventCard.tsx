'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  DocumentMagnifyingGlassIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline';
import { Modal } from '@/components/Modal';
import DocumentAttachmentViewer from '@/components/DocumentAttachmentViewer';
import { useAuth } from '@/contexts/AuthContext';
import { apiService } from '@/services/api';
import { CATEGORY_COLOR_CLASSES, EVENT_COLOR_CLASSES, EVENT_ICONS } from './eventMeta';
import type { MachineTimelineEvent } from './types';

interface TimelineEventCardProps {
  event: MachineTimelineEvent;
}

export default function TimelineEventCard({ event }: TimelineEventCardProps) {
  const t = useTranslations('machineTimeline');
  const locale = useLocale();
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [documentPreview, setDocumentPreview] = useState<Record<string, unknown> | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentError, setDocumentError] = useState('');

  const Icon = EVENT_ICONS[event.type];
  const label = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback);
  const colorClass = EVENT_COLOR_CLASSES[event.type] ?? 'bg-gray-100 text-gray-600 border-gray-200';
  const categoryClass = CATEGORY_COLOR_CLASSES[event.category] ?? 'bg-slate-50 text-slate-700 border-slate-200';
  const title = t.has(`eventTypes.${event.type}`) ? t(`eventTypes.${event.type}`) : event.title;
  const category = t.has(`filters.categories.${event.category}`)
    ? t(`filters.categories.${event.category}`)
    : event.category;
  const at = new Date(event.at);
  const metadataEntries = event.metadata
    ? Object.entries(event.metadata).filter(([, value]) => value !== undefined && value !== null && value !== '')
    : [];
  const primaryMetadata = metadataEntries.filter(([key]) =>
    ['otId', 'reportId', 'faultCode', 'planId', 'documentId', 'taskId', 'typeMaintenance', 'quantity', 'partName'].includes(
      key,
    ),
  );
  const visibleMetadata = (primaryMetadata.length ? primaryMetadata : metadataEntries).slice(0, 4);
  const canExpand = metadataEntries.length > visibleMetadata.length || metadataEntries.some(([key]) => key === 'notes');
  const actorInitials = event.actor?.name
    ?.split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  async function openDocumentPreview(documentId: string) {
    try {
      setDocumentLoading(true);
      setDocumentError('');
      const response = await apiService.getDocument(documentId);
      setDocumentPreview(response.data);
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        t('errors.loadDocument');
      setDocumentError(message);
    } finally {
      setDocumentLoading(false);
    }
  }

  function closeDocumentPreview() {
    setDocumentPreview(null);
    setDocumentError('');
  }

  const documentPreviewName =
    typeof documentPreview?.file_name === 'string' ? documentPreview.file_name : t('actions.viewDocument');
  const workOrderHref =
    event.relatedEntity?.kind === 'work_order' && user?.role === 'technician'
      ? `/${locale}/technician/work-orders/${event.relatedEntity.id}`
      : null;
  const isDocumentEvent = event.relatedEntity?.kind === 'document';

  return (
    <article className="relative grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3 sm:grid-cols-[3.5rem_minmax(0,1fr)]">
      <div className="relative flex justify-center">
        <div className="absolute inset-y-0 start-1/2 w-px -translate-x-1/2 bg-(--border)" aria-hidden="true" />
        <div
          className={`relative z-10 mt-5 flex h-11 w-11 items-center justify-center rounded-full border-2 ${colorClass} shadow-(--shadow-sm)`}
          aria-hidden="true"
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>

      <div className="rounded-2xl border border-(--border) bg-(--surface) p-4 shadow-(--shadow-sm) transition hover:border-(--border-hover) hover:shadow-(--shadow) sm:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${categoryClass}`}>
                {category}
              </span>
              {event.machineStatus && (
                <span className="inline-flex rounded-full border border-(--border) bg-(--surface-secondary) px-2.5 py-1 text-xs font-semibold text-(--text-secondary)">
                  {event.machineStatus}
                </span>
              )}
            </div>
            <h3 className="text-lg font-bold leading-snug text-(--text-primary)">{title}</h3>
          </div>
          <time
            dateTime={event.at}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-(--border) bg-(--surface-secondary) px-3 py-2 text-sm font-medium text-(--text-secondary)"
            title={at.toLocaleString(locale)}
          >
            <ClockIcon className="h-4 w-4" aria-hidden="true" />
            <span>
              {at.toLocaleDateString(locale)} / {at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
            </span>
          </time>
        </div>

        {event.description && (
          <p className="mt-3 text-base leading-7 text-(--text-primary)">{event.description}</p>
        )}

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="flex flex-wrap gap-2">
            {event.relatedEntity?.refCode && (
              <span className="inline-flex min-h-9 items-center rounded-lg border border-(--border) bg-(--surface-secondary) px-3 font-mono text-sm font-semibold text-(--primary)">
                {event.relatedEntity.refCode}
              </span>
            )}
            {visibleMetadata.map(([key, value]) => (
              <span
                key={key}
                className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-(--border) bg-(--surface-secondary) px-3 text-sm text-(--text-secondary)"
              >
                <span className="font-medium text-(--text-primary)">
                  {t.has(`metadataLabels.${key}`) ? t(`metadataLabels.${key}`) : key}
                </span>
                <span>{String(value)}</span>
              </span>
            ))}
          </div>

          {event.actor && (
            <div className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-(--border) bg-(--surface-secondary) px-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-(--primary) text-xs font-bold text-(--text-inverse)">
                {actorInitials || <UserCircleIcon className="h-5 w-5" aria-hidden="true" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-5 text-(--text-primary)">{event.actor.name}</span>
                {event.actor.role && (
                  <span className="block text-xs text-(--text-secondary)">
                    {t.has(`roles.${event.actor.role}`) ? t(`roles.${event.actor.role}`) : event.actor.role}
                  </span>
                )}
              </span>
            </div>
          )}
        </div>

        {expanded && metadataEntries.length > 0 && (
          <dl className="mt-4 grid gap-3 rounded-xl border border-(--border) bg-(--surface-secondary) p-3 text-sm sm:grid-cols-2">
            {metadataEntries.map(([key, value]) => (
              <div key={key} className="min-w-0">
                <dt className="font-medium text-(--text-secondary)">
                  {t.has(`metadataLabels.${key}`) ? t(`metadataLabels.${key}`) : key}
                </dt>
                <dd className="mt-0.5 break-words font-semibold text-(--text-primary)">{String(value)}</dd>
              </div>
            ))}
          </dl>
        )}

        {(workOrderHref || isDocumentEvent || canExpand) && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-(--border) pt-4">
            {workOrderHref && (
              <Link
                href={workOrderHref}
                className="inline-flex min-h-10 items-center rounded-lg border border-(--border) bg-(--surface-secondary) px-3 text-sm font-semibold text-(--primary) transition hover:border-(--border-hover) hover:bg-(--surface) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--primary)"
              >
                {label('actions.viewWorkOrder', 'View work order')}
              </Link>
            )}
            {isDocumentEvent && (
              <button
                type="button"
                onClick={() => void openDocumentPreview(event.relatedEntity!.id)}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-(--border) bg-(--surface-secondary) px-3 text-sm font-semibold text-(--primary) transition hover:border-(--border-hover) hover:bg-(--surface) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--primary)"
              >
                <DocumentMagnifyingGlassIcon className="h-4 w-4" aria-hidden="true" />
                {label('actions.previewDocument', 'Preview document')}
              </button>
            )}
            {canExpand && (
              <button
                type="button"
                onClick={() => setExpanded((current) => !current)}
                aria-expanded={expanded}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-(--border) bg-(--surface-secondary) px-3 text-sm font-semibold text-(--primary) transition hover:border-(--border-hover) hover:bg-(--surface) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--primary)"
              >
                {expanded ? t('actions.showLess') : t('actions.showMore')}
                {expanded ? (
                  <ChevronUpIcon className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <ChevronDownIcon className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            )}
          </div>
        )}
      </div>

      <Modal
        isOpen={Boolean(documentPreview) || documentLoading || Boolean(documentError)}
        onClose={closeDocumentPreview}
        title={documentPreviewName}
        size="xl"
      >
        {documentLoading ? (
          <p className="text-sm text-(--text-secondary)">{t('loading')}</p>
        ) : documentError ? (
          <p className="text-sm text-red-700">{documentError}</p>
        ) : documentPreview ? (
          <DocumentAttachmentViewer document={documentPreview as never} title={documentPreviewName} />
        ) : null}
      </Modal>
    </article>
  );
}
