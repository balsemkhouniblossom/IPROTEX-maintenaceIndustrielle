"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  CalendarIcon,
  DocumentTextIcon,
  EyeIcon,
  TagIcon,
} from "@heroicons/react/24/outline";
import {
  documentDateLabel,
  documentMachineLabel,
  documentStatusLabel,
  documentStatusTone,
  documentTypeLabel,
  type TechnicianDocument,
} from "@/components/technician/documentPresentation";

export default function TechnicianDocumentCard({
  document,
  onPreview,
  previewLabel,
}: Readonly<{
  document: TechnicianDocument;
  onPreview?: (document: TechnicianDocument) => void;
  previewLabel: string;
}>) {
  const t = useTranslations("technician");
  const locale = useLocale();
  const machineLabel = documentMachineLabel(
    document.machine_id,
    t("notAvailable"),
  );
  const status = document.status;
  const tone = documentStatusTone(status);
  return (
    <article
      className="panel flex h-full flex-col gap-3"
      data-testid={`technician-document-${document.document_id || document._id || document.file_name}`}
    >
      <div className="flex items-start gap-3">
        <DocumentTextIcon className="mt-0.5 h-6 w-6 shrink-0 text-blue-700" />
        <div className="min-w-0 flex-1">
          <h3 className="break-words font-semibold text-slate-900">
            {document.file_name || t("notAvailable")}
          </h3>
          {document.description ? (
            <p className="mt-1 line-clamp-2 text-sm text-slate-600">
              {document.description}
            </p>
          ) : null}
        </div>
        {status ? (
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase ${tone.bg} ${tone.text} ${tone.border}`}
          >
            {documentStatusLabel(status, t("notAvailable"))}
          </span>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs text-slate-600">
        <div>
          <dt className="text-[10px] uppercase text-slate-400">
            {t("manuals.typeLabel")}
          </dt>
          <dd className="font-medium text-slate-800">
            {documentTypeLabel(document.type_document, t("notAvailable"))}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase text-slate-400">
            {t("manuals.machineLabel")}
          </dt>
          <dd className="font-medium text-slate-800">{machineLabel}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase text-slate-400">
            {t("manuals.addedLabel")}
          </dt>
          <dd className="inline-flex items-center gap-1 font-medium text-slate-800">
            <CalendarIcon className="h-3 w-3 text-slate-400" />
            {documentDateLabel(document.date_ajout, locale, t("notAvailable"))}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase text-slate-400">
            {t("manuals.documentIdLabel")}
          </dt>
          <dd className="font-mono text-[11px] font-medium text-slate-700">
            {document.document_id || t("notAvailable")}
          </dd>
        </div>
      </dl>
      {document.tags?.length ? (
        <div className="flex flex-wrap gap-1">
          {document.tags.slice(0, 5).map((tag) => (
            <span
              key={`${document.document_id || String(document._id || "") || document.file_name}-${tag}`}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600"
            >
              <TagIcon className="h-3 w-3" />
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      {onPreview ? (
        <button
          type="button"
          className="mt-auto inline-flex w-fit items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white"
          onClick={() => onPreview(document)}
        >
          <EyeIcon className="h-4 w-4" />
          {previewLabel}
        </button>
      ) : null}
    </article>
  );
}
