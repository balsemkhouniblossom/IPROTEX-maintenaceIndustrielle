import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import {
  getAttachmentViewerKind,
  getNormalizedDocumentExtension,
  resolveAttachmentPreviewUrl,
  resolveAttachmentViewerUrl,
} from "../src/services/documentViewer.ts";
import { buildSheetPreview, parseWorkbook } from "../src/services/spreadsheetPreview.ts";

test("document viewer prefers trusted MIME type over extension", () => {
  assert.equal(getAttachmentViewerKind({ file_name: "manual.pdf", mime_type: "image/png" }), "image");
  assert.equal(getAttachmentViewerKind({ file_name: "photo.png", contentType: "application/pdf" }), "pdf");
});

test("document viewer detects normalized extensions when MIME is absent", () => {
  assert.equal(getAttachmentViewerKind({ file_path: "/files/photo.WebP?x=1" }), "image");
  assert.equal(getAttachmentViewerKind({ file_name: "manual.PDF" }), "pdf");
  assert.equal(getAttachmentViewerKind({ file_name: "parts.xlsx" }), "spreadsheet");
  assert.equal(getAttachmentViewerKind({ file_name: "instructions.docx" }), "docx");
  assert.equal(getAttachmentViewerKind({ file_name: "legacy.doc" }), "download");
  assert.equal(getAttachmentViewerKind({ file_name: "slides.pptx" }), "download");
  assert.equal(getAttachmentViewerKind({ file_name: "legacy.ppt" }), "download");
  assert.equal(getAttachmentViewerKind({ file_name: "notes.txt" }), "text");
  assert.equal(getNormalizedDocumentExtension({ file_path: "\\uploads\\report.TXT#page=1" }), "txt");
});

test("managed documents use the protected original-file endpoint", () => {
  const document = { _id: "doc-1", file_path: "/uploads/manual.xlsx" };
  assert.equal(resolveAttachmentViewerUrl(document), "http://localhost:3001/documents/doc-1/file");
  assert.equal(resolveAttachmentPreviewUrl(document), "http://localhost:3001/documents/doc-1/file");
});

test("new Supabase uploads use the protected endpoint even without a leading slash", () => {
  const uploaded = {
    _id: "new-document-id",
    file_path: "uploads/2026-new-manual.pdf",
    file_name: "new-manual.pdf",
  };
  assert.equal(
    resolveAttachmentViewerUrl(uploaded),
    "http://localhost:3001/documents/new-document-id/file",
  );
});

test("an external document with an id keeps its explicit external URL", () => {
  const external = {
    _id: "external-document-id",
    file_path: "https://docs.example.com/manual.pdf",
    file_url: "https://docs.example.com/manual.pdf",
    file_name: "manual.pdf",
  };
  assert.equal(resolveAttachmentViewerUrl(external), "https://docs.example.com/manual.pdf");
});

test("document viewer prefers API-provided protected file urls", () => {
  assert.equal(resolveAttachmentViewerUrl({
    _id: "doc-1",
    file_path: "/uploads/manual.pdf",
    file_url: "/documents/doc-1/file",
  }), "http://localhost:3001/documents/doc-1/file");
});

test("document viewer preserves absolute and unsupported files", () => {
  assert.equal(getAttachmentViewerKind({ file_path: "/uploads/archive.zip" }), "unsupported");
  assert.equal(resolveAttachmentViewerUrl({ file_path: "https://cdn.example.com/photo.webp" }), "https://cdn.example.com/photo.webp");
});

test("shared attachment viewer loads authenticated bytes and isolates renderers", () => {
  const source = readFileSync(new URL("../src/components/DocumentAttachmentViewer.tsx", import.meta.url), "utf8");
  assert.match(source, /viewerKind === "spreadsheet" && blob/);
  assert.match(source, /<PdfViewer\s+file=\{blob\}/);
  assert.match(source, /<SpreadsheetViewer\s+file=\{blob\}/);
  assert.match(source, /<DocxViewer\s+file=\{blob\}/);
  assert.match(source, /responseType:\s*"blob"/);
  assert.match(source, /timeout:\s*20_000/);
  assert.match(source, /signal:\s*controller\.signal/);
  assert.match(source, /controller\.abort\(\)/);
  assert.match(source, /URL\.revokeObjectURL\(objectUrl\)/);
  assert.match(source, /downloadOriginal/);
  assert.match(source, /<ErrorBoundary/);
  assert.doesNotMatch(source, /<iframe/);
  assert.doesNotMatch(source, /\/preview/);
});

test("DOCX preview disables embedded HTML and cleans generated DOM", () => {
  const source = readFileSync(new URL("../src/components/DocxViewer.tsx", import.meta.url), "utf8");
  assert.match(source, /import\("docx-preview"\)/);
  assert.match(source, /renderAltChunks:\s*false/);
  assert.match(source, /renderHeaders:\s*true/);
  assert.match(source, /renderFooters:\s*true/);
  assert.match(source, /useBase64URL:\s*true/);
  assert.match(source, /replaceChildren\(\)/);
  assert.match(source, /script, iframe, object, embed/);
  assert.match(source, /startsWith\("on"\)/);
  assert.match(source, /\["http:", "https:", "mailto:", "tel:"\]/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
});

test("technician document cards do not prominently display internal document ids", () => {
  const source = readFileSync(new URL("../src/components/technician/TechnicianDocumentCard.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /manuals\.documentIdLabel/);
  assert.match(source, /data-testid=\{`technician-document-/);
});

test("spreadsheet preview preserves sheets, formatted values, and horizontal merges", () => {
  const workbook = XLSX.utils.book_new();
  const first = XLSX.utils.aoa_to_sheet([["Maintenance plan", undefined], ["Cost", 1234.5]]);
  first.B2.z = "0.00";
  first["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  XLSX.utils.book_append_sheet(workbook, first, "Summary");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Part", "Qty"]]), "Parts");

  const parsed = parseWorkbook(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
  const preview = buildSheetPreview(parsed, "Summary");
  assert.deepEqual(parsed.SheetNames, ["Summary", "Parts"]);
  assert.equal(preview.rows[1]?.[1], "1234.50");
  assert.equal(preview.horizontalMerges.get("0:0"), 2);
  assert.equal(preview.coveredCells.has("0:1"), true);
});

test("spreadsheet preview accepts legacy XLS and rejects extreme dimensions", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["OK"]]), "Checklist");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xls" });
  assert.equal(parseWorkbook(bytes).SheetNames[0], "Checklist");

  const oversized = XLSX.utils.aoa_to_sheet([["Too large"]]);
  oversized["!ref"] = "A1:A50001";
  assert.throws(
    () => buildSheetPreview({ SheetNames: ["Huge"], Sheets: { Huge: oversized } }, "Huge"),
    RangeError,
  );
});

test("spreadsheet preview rejects a malformed workbook archive", () => {
  const malformedZip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]);
  assert.throws(() => parseWorkbook(malformedZip.buffer), /ZIP/);
});

test("PDF viewer renders PDF.js pages without a browser iframe", () => {
  const source = readFileSync(new URL("../src/app/[locale]/documents/PdfViewer.tsx", import.meta.url), "utf8");
  assert.match(source, /pdfjs\.getDocument/);
  assert.match(source, /page\.render/);
  assert.match(source, /pageCount/);
  assert.match(source, /zoomIn/);
  assert.match(source, /renderTask\?\.cancel\(\)/);
  assert.doesNotMatch(source, /<iframe/);
});
