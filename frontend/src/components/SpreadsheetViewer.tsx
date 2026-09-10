"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type * as XLSX from "xlsx";
import { buildSheetPreview, parseWorkbook, type SheetPreview } from "@/services/spreadsheetPreview";

type Props = Readonly<{
  file: Blob;
  onCorrupt: () => void;
  onRendererError: () => void;
}>;

const ROW_HEIGHT = 37;
const COLUMN_WIDTH = 140;

export default function SpreadsheetViewer({ file, onCorrupt, onRendererError }: Props) {
  const t = useTranslations("documents.viewer");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [activeSheet, setActiveSheet] = useState("");

  useEffect(() => {
    let active = true;
    setWorkbook(null);
    file.arrayBuffer()
      .then(parseWorkbook)
      .then((nextWorkbook) => {
        if (!active) return;
        if (!nextWorkbook.SheetNames.length) throw new Error("Workbook has no worksheets");
        setWorkbook(nextWorkbook);
        setActiveSheet(nextWorkbook.SheetNames[0]);
      })
      .catch(() => {
        if (active) onCorrupt();
      });
    return () => {
      active = false;
    };
  }, [file, onCorrupt]);

  const previewResult = useMemo((): { preview: SheetPreview | null; error: "tooLarge" | "renderer" | null } => {
    if (!workbook || !activeSheet) return { preview: null, error: null };
    try {
      return { preview: buildSheetPreview(workbook, activeSheet), error: null };
    } catch (error) {
      return { preview: null, error: error instanceof RangeError ? "tooLarge" : "renderer" };
    }
  }, [activeSheet, workbook]);
  const preview = previewResult.preview;

  useEffect(() => {
    if (previewResult.error === "renderer") onRendererError();
  }, [onRendererError, previewResult.error]);

  // eslint-disable-next-line react-hooks/incompatible-library -- virtualization is required to bound spreadsheet DOM size.
  const rowVirtualizer = useVirtualizer({
    count: preview?.rows.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  if (!workbook) {
    return <div className="flex min-h-[32vh] items-center justify-center text-sm text-slate-600"><Loader2 className="me-2 h-4 w-4 animate-spin" />{t("rendering")}</div>;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 p-2" role="tablist">
        {workbook.SheetNames.map((sheetName) => (
          <button key={sheetName} type="button" role="tab" aria-selected={activeSheet === sheetName} className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium ${activeSheet === sheetName ? "bg-blue-700 text-white" : "bg-white text-slate-700 hover:bg-slate-100"}`} onClick={() => {
            setActiveSheet(sheetName);
            scrollRef.current?.scrollTo({ top: 0, left: 0 });
          }}>
            {sheetName}
          </button>
        ))}
      </div>
      {previewResult.error === "tooLarge" ? (
        <div className="flex min-h-[32vh] items-center justify-center bg-amber-50 p-6 text-center text-sm text-amber-900">{t("workbookTooLarge")}</div>
      ) : preview ? (
        <>
          {preview.truncated ? <p className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{t("workbookTruncated")}</p> : null}
          <div ref={scrollRef} className="relative h-[60vh] max-h-[640px] overflow-auto" role="grid" aria-label={t("spreadsheetSheet", { sheet: preview.name })} aria-rowcount={preview.rows.length} aria-colcount={preview.columnCount}>
            <div className="relative" style={{ height: rowVirtualizer.getTotalSize(), width: preview.columnCount * COLUMN_WIDTH }}>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = preview.rows[virtualRow.index] ?? [];
                return (
                  <div key={virtualRow.key} role="row" aria-rowindex={virtualRow.index + 1} className="absolute left-0 top-0 grid border-b border-slate-200 bg-white" style={{ width: preview.columnCount * COLUMN_WIDTH, height: virtualRow.size, transform: `translateY(${virtualRow.start}px)`, gridTemplateColumns: `repeat(${preview.columnCount}, ${COLUMN_WIDTH}px)` }}>
                    {Array.from({ length: preview.columnCount }, (_, columnIndex) => {
                      const key = `${virtualRow.index}:${columnIndex}`;
                      if (preview.coveredCells.has(key)) return null;
                      return <div key={key} role="gridcell" aria-colindex={columnIndex + 1} className="truncate border-e border-slate-200 px-2 py-2 text-sm text-slate-800" style={{ gridColumn: `span ${preview.horizontalMerges.get(key) ?? 1}` }} title={String(row[columnIndex] ?? "")}>{String(row[columnIndex] ?? "")}</div>;
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
