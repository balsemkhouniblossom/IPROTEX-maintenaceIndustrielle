import * as XLSX from "xlsx";

export type SheetPreview = {
  name: string;
  rows: string[][];
  columnCount: number;
  truncated: boolean;
  horizontalMerges: Map<string, number>;
  coveredCells: Set<string>;
};

export const SPREADSHEET_LIMITS = {
  maxSourceRows: 50_000,
  maxSourceColumns: 500,
  maxSourceCells: 2_000_000,
  maxPreviewRows: 10_000,
  maxPreviewColumns: 200,
} as const;

export function parseWorkbook(buffer: ArrayBuffer): XLSX.WorkBook {
  const workbook = XLSX.read(buffer, {
    type: "array",
    dense: true,
    cellDates: true,
  });
  if (!workbook.SheetNames.length) throw new Error("Workbook has no worksheets");
  return workbook;
}

export function buildSheetPreview(workbook: XLSX.WorkBook, sheetName: string): SheetPreview {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error("Worksheet is missing");
  const range = sheet["!ref"]
    ? XLSX.utils.decode_range(sheet["!ref"])
    : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  const sourceRows = range.e.r - range.s.r + 1;
  const sourceColumns = range.e.c - range.s.c + 1;
  if (
    sourceRows > SPREADSHEET_LIMITS.maxSourceRows ||
    sourceColumns > SPREADSHEET_LIMITS.maxSourceColumns ||
    sourceRows * sourceColumns > SPREADSHEET_LIMITS.maxSourceCells
  ) {
    throw new RangeError("WORKBOOK_TOO_LARGE");
  }
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: true,
    range: {
      s: range.s,
      e: {
        r: Math.min(range.e.r, range.s.r + SPREADSHEET_LIMITS.maxPreviewRows - 1),
        c: Math.min(range.e.c, range.s.c + SPREADSHEET_LIMITS.maxPreviewColumns - 1),
      },
    },
  });
  const columnCount = Math.min(sourceColumns, SPREADSHEET_LIMITS.maxPreviewColumns);
  const horizontalMerges = new Map<string, number>();
  const coveredCells = new Set<string>();
  for (const merge of sheet["!merges"] ?? []) {
    if (merge.s.r !== merge.e.r || merge.s.r >= rows.length) continue;
    const rowIndex = merge.s.r - range.s.r;
    const startColumn = merge.s.c - range.s.c;
    const endColumn = Math.min(merge.e.c - range.s.c, columnCount - 1);
    if (rowIndex < 0 || startColumn < 0 || startColumn >= columnCount) continue;
    horizontalMerges.set(`${rowIndex}:${startColumn}`, endColumn - startColumn + 1);
    for (let column = startColumn + 1; column <= endColumn; column += 1) {
      coveredCells.add(`${rowIndex}:${column}`);
    }
  }
  return {
    name: sheetName,
    rows,
    columnCount,
    truncated:
      sourceRows > SPREADSHEET_LIMITS.maxPreviewRows ||
      sourceColumns > SPREADSHEET_LIMITS.maxPreviewColumns,
    horizontalMerges,
    coveredCells,
  };
}
