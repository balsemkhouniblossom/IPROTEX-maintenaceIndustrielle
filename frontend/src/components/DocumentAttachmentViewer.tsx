"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Download, ExternalLink, FileWarning, Loader2, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { isAxiosError } from "axios";
import { getAttachmentViewerKind, resolveAttachmentViewerUrl, type AttachmentViewerKind, type ViewableDocument } from "@/services/documentViewer";
import api, { quiet } from "@/services/api";
import { getApiBaseUrl } from "@/config/api-base-url";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { WidgetErrorFallback } from "@/components/WidgetErrorFallback";

type Props = {
  readonly document: ViewableDocument;
  readonly title?: string;
  readonly onError?: () => void;
};

type ViewerFailure = "unauthorized" | "notFound" | "storage" | "network";
type ContentFailure = "corrupt" | "renderer";
type LoadState =
  | { status: "loading" }
  | { status: "ready"; blob: Blob | null; objectUrl: string }
  | { status: "failure"; reason: ViewerFailure };

const PdfViewer = dynamic(() => import("@/app/[locale]/documents/PdfViewer"), { ssr: false });
const SpreadsheetViewer = dynamic(() => import("@/components/SpreadsheetViewer"), { ssr: false });
const DocxViewer = dynamic(() => import("@/components/DocxViewer"), { ssr: false });

function rendererFallback(_error: unknown, reset: () => void) {
  return <WidgetErrorFallback onRetry={reset} bare />;
}

export default function DocumentAttachmentViewer({ document, title, onError }: Readonly<Props>) {
  const t = useTranslations("documents.viewer");
  const onErrorRef = useRef(onError);
  const [retryToken, setRetryToken] = useState(0);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [contentFailure, setContentFailure] = useState<ContentFailure | null>(null);
  const viewerKind = getAttachmentViewerKind(document);
  const sourceUrl = useMemo(() => resolveAttachmentViewerUrl(document), [document]);
  const protectedSource = isBackendDocumentFileUrl(sourceUrl);
  const label = title || document.file_name || t("title");

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!sourceUrl) {
      setState({ status: "failure", reason: "notFound" });
      return;
    }
    if (!protectedSource) {
      setState({ status: "ready", blob: null, objectUrl: sourceUrl });
      return;
    }

    const controller = new AbortController();
    let objectUrl = "";
    setContentFailure(null);
    setState({ status: "loading" });
    api.get(sourceUrl, quiet({ responseType: "blob", timeout: 20_000, signal: controller.signal }))
      .then((response) => {
        if (controller.signal.aborted) return;
        const blob = response.data as Blob;
        objectUrl = URL.createObjectURL(blob);
        setState({ status: "ready", blob, objectUrl });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "failure", reason: classifyFileLoadFailure(error) });
        onErrorRef.current?.();
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [protectedSource, retryToken, sourceUrl]);

  const handleContentFailure = useCallback((reason: ContentFailure) => {
    setContentFailure(reason);
    onErrorRef.current?.();
  }, []);

  const retry = () => setRetryToken((current) => current + 1);

  if (state.status === "loading") {
    return <ViewerMessage icon={<Loader2 className="h-6 w-6 animate-spin" />} message={t("loading")} />;
  }

  if (state.status === "failure") {
    return (
      <ViewerMessage
        icon={<FileWarning className="h-7 w-7" />}
        message={t(`states.${state.reason}`)}
        action={state.reason === "unauthorized" ? undefined : (
          <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={retry}>
            <RotateCcw className="h-4 w-4" />{t("retry")}
          </button>
        )}
      />
    );
  }

  const downloadAction = (
    <a href={state.objectUrl} download={document.file_name || true} className="inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
      <Download className="me-2 h-4 w-4" aria-hidden="true" />{t("downloadOriginal")}
    </a>
  );

  if (contentFailure) {
    return (
      <div className="space-y-3">
        <div className="flex justify-end">{downloadAction}</div>
        <ViewerMessage
          icon={<FileWarning className="h-7 w-7" />}
          message={t(`states.${contentFailure}`)}
          action={<button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={retry}><RotateCcw className="h-4 w-4" />{t("retry")}</button>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">{downloadAction}</div>
      <ErrorBoundary boundaryName={`document-${viewerKind}-viewer`} fallback={rendererFallback}>
        <FormatViewer
          viewerKind={viewerKind}
          blob={state.blob}
          objectUrl={state.objectUrl}
          label={label}
          onCorrupt={() => handleContentFailure("corrupt")}
          onRendererError={() => handleContentFailure("renderer")}
          unsupportedMessage={t("states.unsupported")}
          openLabel={t("open")}
        />
      </ErrorBoundary>
    </div>
  );
}

function FormatViewer({ viewerKind, blob, objectUrl, label, onCorrupt, onRendererError, unsupportedMessage, openLabel }: Readonly<{
  viewerKind: AttachmentViewerKind;
  blob: Blob | null;
  objectUrl: string;
  label: string;
  onCorrupt: () => void;
  onRendererError: () => void;
  unsupportedMessage: string;
  openLabel: string;
}>) {
  if (viewerKind === "pdf" && blob) {
    return <PdfViewer file={blob} onCorrupt={onCorrupt} onRendererError={onRendererError} />;
  }
  if (viewerKind === "spreadsheet" && blob) {
    return <SpreadsheetViewer file={blob} onCorrupt={onCorrupt} onRendererError={onRendererError} />;
  }
  if (viewerKind === "docx" && blob) {
    return <DocxViewer file={blob} onCorrupt={onCorrupt} onRendererError={onRendererError} />;
  }
  if (viewerKind === "image") {
    // eslint-disable-next-line @next/next/no-img-element -- protected Blob URLs cannot use Next image optimization.
    return <img src={objectUrl} alt={label} className="mx-auto max-h-[72vh] max-w-full rounded-lg object-contain" onError={onRendererError} />;
  }
  if ((viewerKind === "pdf" || viewerKind === "spreadsheet" || viewerKind === "docx") && !blob) {
    return <ViewerMessage icon={<FileWarning className="h-7 w-7" />} message={unsupportedMessage} />;
  }
  if (viewerKind === "download" || viewerKind === "text") {
    return <ViewerMessage icon={<ExternalLink className="h-7 w-7" />} message={unsupportedMessage} action={<a href={objectUrl} target="_blank" rel="noreferrer" className="btn-secondary">{openLabel}</a>} />;
  }
  return <ViewerMessage icon={<FileWarning className="h-7 w-7" />} message={unsupportedMessage} />;
}

function ViewerMessage({ icon, message, action }: Readonly<{ icon: ReactNode; message: string; action?: ReactNode }>) {
  return <div className="flex min-h-[32vh] flex-col items-center justify-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-slate-600" role="status">{icon}<p className="text-sm font-medium">{message}</p>{action}</div>;
}

function classifyFileLoadFailure(error: unknown): ViewerFailure {
  if (!isAxiosError(error)) return "network";
  if (error.response?.status === 401 || error.response?.status === 403) return "unauthorized";
  if (error.response?.status === 404) return "notFound";
  if (error.response && error.response.status >= 500) return "storage";
  return "network";
}

function isBackendDocumentFileUrl(url: string): boolean {
  if (!url) return false;
  const normalizedBase = getApiBaseUrl().replace(/\/$/, "");
  const normalizedUrl = url.replace(/\\/g, "/");
  if (normalizedUrl.startsWith("/documents/")) return /\/documents\/[^/]+\/file$/.test(normalizedUrl);
  return normalizedUrl.startsWith(`${normalizedBase}/documents/`) && /\/documents\/[^/]+\/file$/.test(normalizedUrl.slice(normalizedBase.length));
}
