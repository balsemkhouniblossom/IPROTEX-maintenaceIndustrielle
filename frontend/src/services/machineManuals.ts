import {
  getAttachmentViewerKind,
  resolveAttachmentViewerUrl,
  type ViewableDocument,
} from "./documentViewer.ts";

type EntityRef = string | { _id?: string | null; id?: string | null } | null;

export type ManualCandidateDocument = {
  _id?: string | null;
  id?: string | null;
  machine_id?: EntityRef;
  type_document?: string | null;
  file_name?: string | null;
  file_path?: string | null;
  file_url?: string | null;
  preview_path?: string | null;
  description?: string | null;
  tags?: string[] | null;
  status?: string | null;
  date_ajout?: string | Date | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

const MANUAL_TERMS = ["manual", "procedure", "diagram", "excel", "spreadsheet"];
const MANUAL_EXTENSIONS = [".pdf", ".xlsx", ".xls"];
const CURRENT_STATUSES = new Set(["", "published"]);

function entityId(value: EntityRef | undefined): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value._id || value.id || "";
}

function textFor(doc: ManualCandidateDocument): string {
  return [
    doc.type_document,
    doc.file_name,
    doc.file_path,
    doc.description,
    ...(doc.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function fileNameFor(doc: ManualCandidateDocument): string {
  return (doc.file_name || doc.file_path || doc.file_url || doc.preview_path || "").toLowerCase();
}

export function isMachineManualDocument(doc: ManualCandidateDocument): boolean {
  const type = (doc.type_document || "").toLowerCase();
  const name = fileNameFor(doc);
  const searchableText = textFor(doc);
  const status = (doc.status || "").toLowerCase();

  if (type.includes("photo") || type.includes("image")) return false;
  if (!CURRENT_STATUSES.has(status)) return false;

  return (
    MANUAL_TERMS.some((term) => searchableText.includes(term)) ||
    searchableText.includes("pdf") ||
    MANUAL_EXTENSIONS.some((extension) => name.endsWith(extension))
  );
}

export function isAvailableMachineDocument(doc: ManualCandidateDocument): boolean {
  const status = (doc.status || "").toLowerCase();
  if (!CURRENT_STATUSES.has(status)) return false;
  if (getAttachmentViewerKind(doc as ViewableDocument) === "unsupported") return false;
  return Boolean(resolveAttachmentViewerUrl(doc as ViewableDocument));
}

export function documentBelongsToMachine(
  doc: ManualCandidateDocument,
  machineId: string,
): boolean {
  return Boolean(machineId) && entityId(doc.machine_id) === machineId;
}

function timestamp(doc: ManualCandidateDocument): number {
  const value = doc.updatedAt ?? doc.date_ajout ?? doc.createdAt;
  if (!value) return 0;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function manualScore(doc: ManualCandidateDocument): number {
  const type = (doc.type_document || "").toLowerCase();
  const name = fileNameFor(doc);
  const searchableText = textFor(doc);
  const status = (doc.status || "").toLowerCase();

  let score = 0;
  if (!status || status === "published") score += 100;
  if (type.includes("manual")) score += 50;
  if (searchableText.includes("manual")) score += 30;
  if (name.endsWith(".pdf")) score += 20;
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) score += 10;
  if (doc.file_url || doc.preview_path || doc.file_path) score += 5;
  return score;
}

function availableDocumentScore(doc: ManualCandidateDocument): number {
  let score = manualScore(doc);
  const viewerKind = getAttachmentViewerKind(doc as ViewableDocument);

  if (isMachineManualDocument(doc)) score += 1000;
  if (viewerKind === "pdf") score += 40;
  if (viewerKind === "image") score += 30;
  if (viewerKind === "spreadsheet") score += 25;
  if (viewerKind === "text") score += 15;

  return score;
}

export function sortMachineManuals<T extends ManualCandidateDocument>(documents: T[]): T[] {
  return [...documents]
    .filter(isMachineManualDocument)
    .sort((a, b) => manualScore(b) - manualScore(a) || timestamp(b) - timestamp(a));
}

export function sortMachineDocumentsForMachine<T extends ManualCandidateDocument>(
  machineId: string,
  documents: T[],
): T[] {
  return [...documents]
    .filter((doc) => documentBelongsToMachine(doc, machineId))
    .filter(isAvailableMachineDocument)
    .sort(
      (a, b) =>
        availableDocumentScore(b) - availableDocumentScore(a) ||
        timestamp(b) - timestamp(a),
    );
}
