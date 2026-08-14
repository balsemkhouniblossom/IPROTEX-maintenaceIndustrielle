import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getAttachmentViewerKind,
  getNormalizedDocumentExtension,
  resolveAttachmentPreviewUrl,
  resolveAttachmentViewerUrl,
} from "../src/services/documentViewer.ts";

test("document viewer prefers trusted MIME type over extension", () => {
  assert.equal(
    getAttachmentViewerKind({
      file_name: "manual.pdf",
      file_path: "/uploads/manual.pdf",
      mime_type: "image/png",
    }),
    "image",
  );
  assert.equal(
    getAttachmentViewerKind({
      file_name: "photo.png",
      file_path: "/uploads/photo.png",
      contentType: "application/pdf",
    }),
    "pdf",
  );
});

test("document viewer detects normalized extensions when MIME is absent", () => {
  assert.equal(getAttachmentViewerKind({ file_path: "/files/uploads/photo.WebP?x=1" }), "image");
  assert.equal(getAttachmentViewerKind({ file_name: "manual.PDF" }), "pdf");
  assert.equal(getAttachmentViewerKind({ file_name: "parts.xlsx" }), "spreadsheet");
  assert.equal(getAttachmentViewerKind({ file_name: "notes.txt" }), "text");
  assert.equal(getNormalizedDocumentExtension({ file_path: "\\uploads\\report.TXT#page=1" }), "txt");
});

test("document viewer resolves managed files through protected document endpoints when an id is present", () => {
  assert.equal(
    resolveAttachmentViewerUrl({ _id: "doc-1", file_path: "/uploads/manual.pdf" }),
    "http://localhost:3001/documents/doc-1/file",
  );
});

test("document viewer prefers API-provided protected file urls", () => {
  assert.equal(
    resolveAttachmentViewerUrl({
      _id: "doc-1",
      file_path: "/uploads/manual.pdf",
      file_url: "/documents/doc-1/file",
    }),
    "http://localhost:3001/documents/doc-1/file",
  );
});

test("document viewer resolves spreadsheets through protected PDF preview endpoints", () => {
  assert.equal(
    resolveAttachmentPreviewUrl({ _id: "doc-1", file_path: "/uploads/manual.xlsx" }),
    "http://localhost:3001/documents/doc-1/preview",
  );
});

test("document viewer preserves absolute and unsupported files", () => {
  assert.equal(getAttachmentViewerKind({ file_path: "/uploads/archive.zip" }), "unsupported");
  assert.equal(
    resolveAttachmentViewerUrl({ file_path: "https://cdn.example.com/photo.webp" }),
    "https://cdn.example.com/photo.webp",
  );
});

test("shared attachment viewer renders spreadsheet PDF previews", () => {
  const source = readFileSync(
    new URL("../src/components/DocumentAttachmentViewer.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /viewerKind === "spreadsheet"/);
  assert.match(source, /viewerKind === "pdf" \|\| isSpreadsheetPdfPreview/);
  assert.match(source, /\{!displayUrl \? \(/);
  assert.match(source, /<PdfViewer key=\{displayUrl\} file=\{displayUrl\} \/>/);
  assert.match(source, /quiet\(\{[\s\S]*responseType:\s*"blob"/);
  assert.match(source, /\/documents\\\/\[\^\/\]\+\\\/\(\?:file\|preview\)\$/);
  assert.doesNotMatch(source, /<iframe/);
  assert.doesNotMatch(source, /@js-preview\/excel/);
  assert.doesNotMatch(source, /from "xlsx"/);
  assert.doesNotMatch(source, /jsPreviewExcel\.init/);
  assert.doesNotMatch(source, /withPatchedBlobXhrForPreview/);
});
