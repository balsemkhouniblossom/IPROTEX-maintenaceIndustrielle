"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Download, ExternalLink, FileWarning, ImageOff, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  getAttachmentViewerKind,
  getNormalizedDocumentExtension,
  resolveAttachmentPreviewUrl,
  type ViewableDocument,
} from "@/services/documentViewer";
import { resolveManagedFileUrl } from "@/services/managedFileUrls";
import api, { quiet } from "@/services/api";
import { getApiBaseUrl } from "@/config/api-base-url";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { WidgetErrorFallback } from "@/components/WidgetErrorFallback";

type Props = {
  readonly document: ViewableDocument;
  readonly title?: string;
  readonly onError?: () => void;
};

type ViewerContentProps = {
  readonly viewerKind: string;
  readonly isSpreadsheetPdfPreview: boolean;
  readonly viewerUrl: string;
  readonly fileUrl: string;
  readonly displayUrl: string;
  readonly objectUrl: string;
  readonly fileLoading: boolean;
  readonly fileBroken: boolean;
  readonly label: string;
  readonly loadingLabel: string;
  readonly imageUnavailableLabel: string;
  readonly downloadOnlyLabel: string;
  readonly openLabel: string;
  readonly downloadLabel: string;
  readonly unsupportedLabel: string;
  readonly onImageLoad: () => void;
  readonly onImageError: () => void;
};

const PdfViewer = dynamic(() => import("@/app/[locale]/documents/PdfViewer"), {
  ssr: false,
  loading: PdfViewerLoading,
});

function PdfViewerLoading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
    </div>
  );
}

function documentViewerFallback(_error: unknown, reset: () => void) {
  return <WidgetErrorFallback onRetry={reset} bare />;
}

export default function DocumentAttachmentViewer(props: Readonly<Props>) {
  return (
    <ErrorBoundary
      boundaryName="document-attachment-viewer"
      fallback={documentViewerFallback}
    >
      <DocumentAttachmentViewerInner {...props} />
    </ErrorBoundary>
  );
}

function DocumentAttachmentViewerInner({ document, title, onError }: Readonly<Props>) {
  const t = useTranslations("documents.viewer");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileBroken, setFileBroken] = useState(false);
  const [objectUrl, setObjectUrl] = useState("");
  const viewerKind = getAttachmentViewerKind(document);
  const isSpreadsheetPdfPreview =
    viewerKind === "spreadsheet" &&
    getNormalizedDocumentExtension(document) === "xlsx";
  const viewerUrl = useMemo(() => resolveAttachmentPreviewUrl(document), [document]);
  const fileUrl = resolveManagedFileUrl(document.file_path);
  const label = title || document.file_name || t("title");
  const shouldFetchWithAuth = isBackendDocumentFileUrl(viewerUrl);
  const displayUrl = shouldFetchWithAuth ? objectUrl : objectUrl || viewerUrl;

  useEffect(() => {
    setFileBroken(false);
    setObjectUrl("");

    if (!viewerUrl || !shouldFetchWithAuth || viewerKind === "unsupported") {
      setFileLoading(false);
      return;
    }

    let active = true;
    let nextObjectUrl = "";
    setFileLoading(true);

    api
      .get(viewerUrl, quiet({
        responseType: "blob",
        timeout: 60000,
      }))
      .then((response) => {
        if (!active) return;
        nextObjectUrl = URL.createObjectURL(response.data);
        setObjectUrl(nextObjectUrl);
      })
      .catch(() => {
        if (active) {
          setFileBroken(true);
          onError?.();
        }
      })
      .finally(() => {
        if (active) setFileLoading(false);
      });

    return () => {
      active = false;
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
    };
  }, [onError, shouldFetchWithAuth, viewerKind, viewerUrl]);

  return (
    <AttachmentViewerContent
      viewerKind={viewerKind}
      isSpreadsheetPdfPreview={isSpreadsheetPdfPreview}
      viewerUrl={viewerUrl}
      fileUrl={fileUrl}
      displayUrl={displayUrl}
      objectUrl={objectUrl}
      fileLoading={fileLoading}
      fileBroken={fileBroken}
      label={label}
      loadingLabel={t("loading")}
      imageUnavailableLabel={t("imageUnavailable")}
      downloadOnlyLabel={t("downloadOnly")}
      openLabel={t("open")}
      downloadLabel={t("download")}
      unsupportedLabel={t("unsupported")}
      onImageLoad={() => setFileLoading(false)}
      onImageError={() => {
        setFileLoading(false);
        setFileBroken(true);
      }}
    />
  );
}

function AttachmentViewerContent({
  viewerKind,
  isSpreadsheetPdfPreview,
  viewerUrl,
  fileUrl,
  displayUrl,
  objectUrl,
  fileLoading,
  fileBroken,
  label,
  loadingLabel,
  imageUnavailableLabel,
  downloadOnlyLabel,
  openLabel,
  downloadLabel,
  unsupportedLabel,
  onImageLoad,
  onImageError,
}: ViewerContentProps) {
  if (viewerKind === "image" && viewerUrl && !fileBroken) {
    return (
      <div className="relative flex min-h-[40vh] max-h-[78vh] w-full items-center justify-center overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 sm:p-4">
        {fileLoading ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            {loadingLabel}
          </div>
        ) : null}
        {displayUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- blob/object URLs and protected file URLs are not compatible with next/image optimization.
          <img
            src={displayUrl}
            alt={label}
            className="max-h-[72vh] max-w-full object-contain"
            onLoad={onImageLoad}
            onError={onImageError}
          />
        ) : null}
      </div>
    );
  }

  if ((viewerKind === "image" || viewerKind === "pdf") && fileBroken) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-slate-600">
        <ImageOff className="mb-3 h-8 w-8" aria-hidden="true" />
        <p className="text-sm font-medium">{imageUnavailableLabel}</p>
      </div>
    );
  }

  if ((viewerKind === "pdf" || isSpreadsheetPdfPreview) && viewerUrl) {
    return (
      <div className="max-h-[78vh] w-full overflow-auto rounded-lg border border-slate-200 bg-slate-100 p-2 sm:p-4">
        {!displayUrl ? (
          <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            {loadingLabel}
          </div>
        ) : (
          <PdfViewer key={displayUrl} file={displayUrl} />
        )}
      </div>
    );
  }

  if (isDownloadOnlyViewerKind(viewerKind) && viewerUrl) {
    const actionUrl = objectUrl || viewerUrl || fileUrl;
    return (
      <div className="flex min-h-[32vh] flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-6 text-center">
        <p className="mb-4 max-w-md text-sm text-slate-600">{downloadOnlyLabel}</p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a
            href={actionUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
          >
            <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
            {openLabel}
          </a>
          <a
            href={actionUrl}
            download
            className="inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            {downloadLabel}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[32vh] flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-slate-600">
      <FileWarning className="mb-3 h-8 w-8" aria-hidden="true" />
      <p className="text-sm font-medium">{unsupportedLabel}</p>
    </div>
  );
}

function isBackendDocumentFileUrl(url: string): boolean {
  if (!url) return false;
  const normalizedBase = getApiBaseUrl().replace(/\/$/, "");
  const normalizedUrl = url.replace(/\\/g, "/");
  if (normalizedUrl.startsWith("/documents/")) return isProtectedDocumentUrl(normalizedUrl);
  if (!normalizedUrl.startsWith(`${normalizedBase}/documents/`)) return false;
  return isProtectedDocumentUrl(normalizedUrl.slice(normalizedBase.length));
}

function isProtectedDocumentUrl(url: string): boolean {
  return /\/documents\/[^/]+\/(?:file|preview)$/.test(url);
}

function isDownloadOnlyViewerKind(viewerKind: string): boolean {
  return ["download", "spreadsheet", "text"].includes(viewerKind);
}
