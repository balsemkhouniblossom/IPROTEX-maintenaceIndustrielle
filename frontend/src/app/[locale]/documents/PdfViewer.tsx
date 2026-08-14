import { ErrorBoundary } from "@/components/ErrorBoundary";
import { WidgetErrorFallback } from "@/components/WidgetErrorFallback";

type PdfViewerProps = {
  file: string;
};

export default function PdfViewer(props: PdfViewerProps) {
  return (
    <ErrorBoundary
      boundaryName="pdf-viewer"
      fallback={(_error, reset) => <WidgetErrorFallback onRetry={reset} bare />}
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