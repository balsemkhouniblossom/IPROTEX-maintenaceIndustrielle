import { ErrorBoundary } from "@/components/ErrorBoundary";
import { WidgetErrorFallback } from "@/components/WidgetErrorFallback";

type PdfViewerProps = Readonly<{
  file: string;
}>;

function renderPdfViewerFallback(_error: Error, reset: () => void) {
  return <WidgetErrorFallback onRetry={reset} bare />;
}

export default function PdfViewer(props: PdfViewerProps) {
  return (
    <ErrorBoundary
      boundaryName="pdf-viewer"
      fallback={renderPdfViewerFallback}
    >
      <PdfViewerInner {...props} />
    </ErrorBoundary>
  );
}

function PdfViewerInner({ file }: PdfViewerProps) {
  return (
    <iframe
      src={file}
      title="PDF preview"
      className="h-[72vh] w-full rounded border border-slate-200 bg-white"
    />
  );
}
