"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslations } from "next-intl";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type PdfViewerProps = Readonly<{
  file: Blob;
  onCorrupt: () => void;
  onRendererError: () => void;
}>;

const MIN_SCALE = 0.6;
const MAX_SCALE = 2.5;
const SCALE_STEP = 0.2;

export default function PdfViewer({ file, onCorrupt, onRendererError }: PdfViewerProps) {
  const t = useTranslations("documents.viewer");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.1);
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    let active = true;
    let loadingTask: ReturnType<typeof pdfjs.getDocument> | null = null;
    file.arrayBuffer()
      .then((buffer) => {
        if (!active) return null;
        loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
        return loadingTask.promise;
      })
      .then((loadedPdf) => {
        if (!loadedPdf) return;
        if (!active) {
          loadedPdf.cleanup();
          return;
        }
        setPdf(loadedPdf);
        setPageNumber(1);
      })
      .catch(() => {
        if (active) onCorrupt();
      });

    return () => {
      active = false;
      if (loadingTask) void loadingTask.destroy();
    };
  }, [file, onCorrupt]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let active = true;
    let renderTask: RenderTask | null = null;
    setRendering(true);

    pdf
      .getPage(pageNumber)
      .then((page) => {
        if (!active || !canvasRef.current) return;
        const viewport = page.getViewport({ scale });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("PDF canvas is unavailable");
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        return renderTask.promise;
      })
      .then(() => {
        if (active) setRendering(false);
      })
      .catch((error: unknown) => {
        if (!active || (error as { name?: string }).name === "RenderingCancelledException") return;
        setRendering(false);
        onRendererError();
      });

    return () => {
      active = false;
      renderTask?.cancel();
    };
  }, [onRendererError, pageNumber, pdf, scale]);

  const pageCount = pdf?.numPages ?? 0;
  return (
    <div className="flex min-h-[40vh] flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
      <div className="flex flex-wrap items-center justify-center gap-2 border-b border-slate-200 bg-white p-2">
        <button type="button" className="btn-secondary p-2" disabled={!pdf || pageNumber <= 1} onClick={() => setPageNumber((current) => Math.max(1, current - 1))} aria-label={t("previousPage")}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-28 text-center text-sm font-medium text-slate-700">
          {t("pageCount", { page: pageNumber, count: pageCount || "…" })}
        </span>
        <button type="button" className="btn-secondary p-2" disabled={!pdf || pageNumber >= pageCount} onClick={() => setPageNumber((current) => Math.min(pageCount, current + 1))} aria-label={t("nextPage")}>
          <ChevronRight className="h-4 w-4" />
        </button>
        <span className="mx-1 h-6 w-px bg-slate-200" aria-hidden="true" />
        <button type="button" className="btn-secondary p-2" disabled={scale <= MIN_SCALE} onClick={() => setScale((current) => Math.max(MIN_SCALE, current - SCALE_STEP))} aria-label={t("zoomOut")}>
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="min-w-14 text-center text-sm text-slate-600">{Math.round(scale * 100)}%</span>
        <button type="button" className="btn-secondary p-2" disabled={scale >= MAX_SCALE} onClick={() => setScale((current) => Math.min(MAX_SCALE, current + SCALE_STEP))} aria-label={t("zoomIn")}>
          <ZoomIn className="h-4 w-4" />
        </button>
      </div>
      <div className="relative max-h-[72vh] flex-1 overflow-auto p-2 sm:p-4">
        {rendering ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-100/80 text-sm text-slate-600">
            <Loader2 className="me-2 h-4 w-4 animate-spin" />
            {t("rendering")}
          </div>
        ) : null}
        <canvas ref={canvasRef} className="mx-auto max-w-none bg-white shadow-sm" aria-label={t("pdfPage", { page: pageNumber })} />
      </div>
    </div>
  );
}
