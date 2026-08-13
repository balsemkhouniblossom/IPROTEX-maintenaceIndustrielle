"use client";

import { useEffect, useState } from "react";
import * as XLSX from "xlsx";

type SpreadsheetData = {
  sheetNames: string[];
  sheets: Record<string, string[][]>;
};

export default function SpreadsheetViewer({
  file,
  onError,
}: {
  file: Blob | string;
  onError?: () => void;
}) {
  const [spreadsheet, setSpreadsheet] = useState<SpreadsheetData | null>(null);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadSpreadsheet() {
      try {
        setSpreadsheet(null);
        setError(false);
        const buffer =
          typeof file === "string"
            ? await fetchSpreadsheet(file)
            : await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheetNames = workbook.SheetNames;
        const sheets = Object.fromEntries(
          sheetNames.map((sheetName) => [
            sheetName,
            XLSX.utils
              .sheet_to_json<string[]>(workbook.Sheets[sheetName], {
                header: 1,
                defval: "",
                raw: false,
              })
              .slice(0, 200)
              .map((row) => row.slice(0, 40).map((cell) => String(cell))),
          ]),
        );

        if (!active) return;
        setSpreadsheet({ sheetNames, sheets });
        setSelectedSheet(sheetNames[0] ?? "");
      } catch {
        if (active) {
          setError(true);
          onError?.();
        }
      }
    }

    if (file) void loadSpreadsheet();
    return () => {
      active = false;
    };
  }, [file]);

  if (error) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
        Unable to preview this spreadsheet.
      </div>
    );
  }

  const rows = spreadsheet?.sheets[selectedSheet] ?? [];

  return (
    <div className="max-h-[78vh] w-full overflow-auto rounded-lg border border-slate-200 bg-white">
      {spreadsheet?.sheetNames.length && spreadsheet.sheetNames.length > 1 ? (
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 p-2">
          <select
            value={selectedSheet}
            onChange={(event) => setSelectedSheet(event.target.value)}
            className="max-w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700"
          >
            {spreadsheet.sheetNames.map((sheetName) => (
              <option key={sheetName} value={sheetName}>{sheetName}</option>
            ))}
          </select>
        </div>
      ) : null}
      {!spreadsheet ? (
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">Loading...</div>
      ) : (
        <table className="min-w-full border-collapse text-left text-sm text-slate-700">
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-slate-100">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="whitespace-pre-wrap border-r border-slate-100 px-3 py-2 align-top">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

async function fetchSpreadsheet(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Unable to load spreadsheet");
  return response.arrayBuffer();
}