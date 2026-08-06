"use client";

import { useState, useRef, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { WidgetErrorFallback } from "@/components/WidgetErrorFallback";

// Ensure styles for react-pdf text and annotation layers don't break layout
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  // Keep worker version aligned with react-pdf's internal pdfjs-dist version.
  "react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export default function PdfViewer(props: { file: string }) {
  return (
    <ErrorBoundary
      boundaryName="pdf-viewer"
      fallback={(_error, reset) => <WidgetErrorFallback onRetry={reset} bare />}
    >
      <PdfViewerInner {...props} />
    </ErrorBoundary>
  );
}

function PdfViewerInner({ file }: { file: string }) {
  const [numPages, setNumPages] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);

  // Measure the wrapper width automatically so the PDF scales nicely
  useEffect(() => {
    if (containerRef.current) {
      setContainerWidth(containerRef.current.getBoundingClientRect().width);
    }
  }, []);

  return (
    <div ref={containerRef} className="w-full flex flex-col items-center justify-center">
      <Document
        file={file}
        onLoadSuccess={({ numPages }) => setNumPages(numPages)}
        className="flex flex-col items-center justify-center w-full"
      >
        {Array.from({ length: numPages }, (_, i) => (
          <div key={i} className="mb-4 shadow-md bg-white border border-gray-200 rounded-sm">
            <Page 
              pageNumber={i + 1} 
              width={containerWidth ? containerWidth : undefined} 
            />
          </div>
        ))}
      </Document>
    </div>
  );
}