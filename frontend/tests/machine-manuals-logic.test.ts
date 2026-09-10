import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  documentBelongsToMachine,
  isAvailableMachineDocument,
  isMachineManualDocument,
  sortMachineDocumentsForMachine,
  sortMachineManuals,
} from "../src/services/machineManuals.ts";

test("machine manual classifier uses document metadata, not fixed filenames", () => {
  assert.equal(
    isMachineManualDocument({
      type_document: "safety_procedure",
      file_name: "line-startup.docx",
      description: "Operator procedure",
    }),
    true,
  );
  assert.equal(
    isMachineManualDocument({
      type_document: "operator_photo",
      file_name: "machine-manual-photo.webp",
    }),
    false,
  );
});

test("machine manual sorter prefers valid current manual candidates deterministically", () => {
  const sorted = sortMachineManuals([
    {
      _id: "old-draft",
      status: "draft",
      type_document: "manual",
      file_name: "manual.pdf",
      date_ajout: "2026-01-01T00:00:00.000Z",
    },
    {
      _id: "legacy-pdf",
      type_document: "manual",
      file_name: "legacy.pdf",
      date_ajout: "2026-01-15T00:00:00.000Z",
    },
    {
      _id: "published-excel",
      status: "published",
      type_document: "maintenance",
      file_name: "sheet.xlsx",
      tags: ["manual"],
      date_ajout: "2026-02-01T00:00:00.000Z",
    },
    {
      _id: "new-photo",
      status: "published",
      type_document: "photo",
      file_name: "manual.png",
      date_ajout: "2026-03-01T00:00:00.000Z",
    },
  ]);

  assert.deepEqual(
    sorted.map((doc) => doc._id),
    ["legacy-pdf", "published-excel"],
  );
});

test("machine document selector keeps only valid documents attached to the clicked machine", () => {
  const sorted = sortMachineDocumentsForMachine("machine-a", [
    {
      _id: "other-machine-manual",
      machine_id: "machine-b",
      status: "published",
      type_document: "manual",
      file_name: "wrong.pdf",
      file_path: "/uploads/wrong.pdf",
    },
    {
      _id: "image-fallback",
      machine_id: { _id: "machine-a" },
      status: "published",
      type_document: "photo",
      file_name: "plate.png",
      file_path: "/uploads/plate.png",
    },
    {
      _id: "primary-manual",
      machine_id: "machine-a",
      status: "published",
      type_document: "manual",
      file_name: "manual.xlsx",
      file_path: "/uploads/manual.xlsx",
    },
    {
      _id: "unsupported",
      machine_id: "machine-a",
      status: "published",
      type_document: "manual",
      file_name: "archive.zip",
      file_path: "/uploads/archive.zip",
    },
  ]);

  assert.deepEqual(
    sorted.map((doc) => doc._id),
    ["primary-manual"],
  );
  assert.equal(documentBelongsToMachine(sorted[0], "machine-a"), true);
  assert.equal(isAvailableMachineDocument(sorted[0]), true);
});

test("maintenance evidence images are excluded from the machine document chooser", () => {
  assert.equal(
    isAvailableMachineDocument({
      machine_id: "machine-a",
      status: "published",
      type_document: "photo",
      file_name: "nameplate.webp",
      file_path: "/uploads/nameplate.webp",
    }),
    false,
  );
});

test("admin Machines page opens manuals by fetching documents for the clicked machine id", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/[locale]/machines/page.tsx"),
    "utf8",
  );

  assert.match(source, /apiService\.getDocumentsByMachine\(machine\._id\)/);
  assert.match(source, /sortMachineDocumentsForMachine\(machine\._id, Array\.isArray\(response\.data\) \? response\.data : \[\]\)/);
  assert.match(source, /No available document for this machine\./);
  assert.doesNotMatch(source, /operator\/manuals\?machine=/);
});

test("admin Machines page lets the user choose between multiple machine documents", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/[locale]/machines/page.tsx"),
    "utf8",
  );

  assert.match(source, /previewManualQueue\.length > 1/);
  assert.match(source, /previewManualQueue\.map/);
  assert.match(source, /onClick=\{\(\) => setPreviewManual\(document\)\}/);
  assert.match(source, /aria-pressed=\{isSelected\}/);
});

test("admin Machines table can sort by the displayed machine type", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/[locale]/machines/page.tsx"),
    "utf8",
  );

  assert.match(source, /type MachineSortKey = "name" \| "type" \| "floor"/);
  assert.match(source, /if \(sortKey === "type"\) return machine\.machine_type_name/);
  assert.match(source, /<option value="type">/);
  assert.match(source, /\["name", "type", "floor"\]/);
});

test("machine document load failure keeps the viewer open for retry", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/[locale]/machines/page.tsx"),
    "utf8",
  );
  const handler = source.match(/const handleManualLoadError = \(\) => \{[\s\S]*?\n  \};/);
  assert.ok(handler);
  assert.doesNotMatch(handler[0], /setPreviewManual\(null\)/);
  assert.match(source, /onError=\{handleManualLoadError\}/);
});

test("operator Machines page keeps operational actions simple without manual viewer", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/[locale]/operator/machines/page.tsx"),
    "utf8",
  );

  assert.doesNotMatch(source, /apiService\.getDocumentsByMachine\(/);
  assert.doesNotMatch(source, /sortMachineDocumentsForMachine/);
  assert.doesNotMatch(source, /DocumentAttachmentViewer/);
  assert.doesNotMatch(source, /operator\/manuals\?machine=/);
  assert.match(source, /handleViewMachine\(machine\._id\)/);
  assert.match(source, /handleReportProblem\(machine\._id\)/);
});

test("operator manual downloads use authenticated blobs with safe cleanup", () => {
  const pageSource = fs.readFileSync(
    path.join(process.cwd(), "src/app/[locale]/operator/manuals/page.tsx"),
    "utf8",
  );
  const helperSource = fs.readFileSync(
    path.join(process.cwd(), "src/services/authenticatedDownload.ts"),
    "utf8",
  );

  assert.doesNotMatch(pageSource, /<a[\s\S]*?download/);
  assert.match(pageSource, /downloadAuthenticatedDocument\(doc\._id, doc\.file_name\)/);
  assert.match(pageSource, /downloadingId === doc\._id/);
  assert.match(pageSource, /role="alert"/);
  assert.match(helperSource, /api\.get\(`\/documents\/\$\{encodeURIComponent\(documentId\)\}\/file`/);
  assert.match(helperSource, /responseType:\s*"blob"/);
  assert.match(helperSource, /response\.headers\["content-type"\]/);
  assert.match(helperSource, /anchor\.download = safeDownloadName\(originalFileName\)/);
  assert.match(helperSource, /URL\.revokeObjectURL\(objectUrl\)/);
});
