import {
  isManagedRelativeUploadPath,
  normalizeManagedPath,
  resolveManagedFileUrl,
} from "./managedFileUrls.ts";

export type AttachmentViewerKind =
  | "image"
  | "pdf"
  | "spreadsheet"
  | "text"
  | "download"
  | "unsupported";

export type ViewableDocument = {
  _id?: string | null;
  id?: string | null;
  file_path?: string | null;
  file_url?: string | null;
  preview_path?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
  mimeType?: string | null;
  content_type?: string | null;
  contentType?: string | null;
  mimetype?: string | null;
};

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DOWNLOAD_MIME_TYPES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const SPREADSHEET_MIME_TYPES = new Set([
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
]);
const SPREADSHEET_EXTENSIONS = new Set(["xls", "xlsx", "csv"]);
const TEXT_MIME_TYPES = new Set(["text/plain"]);
const TEXT_EXTENSIONS = new Set(["txt"]);
const DOWNLOAD_EXTENSIONS = new Set(["doc", "docx"]);

function firstString(values: Array<string | null | undefined>): string {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() ?? "";
}

export function getTrustedDocumentMimeType(doc: ViewableDocument): string {
  return firstString([
    doc.mime_type,
    doc.mimeType,
    doc.content_type,
    doc.contentType,
    doc.mimetype,
  ]).toLowerCase();
}

export function getNormalizedDocumentExtension(doc: ViewableDocument): string {
  const raw = firstString([doc.file_name, doc.file_path, doc.file_url, doc.preview_path]);
  const normalized = normalizeManagedPath(raw).split(/[?#]/, 1)[0];
  const lastSegment = normalized.split("/").pop() ?? "";
  const extension = lastSegment.includes(".") ? lastSegment.split(".").pop() : "";
  return (extension ?? "").toLowerCase();
}

export function getAttachmentViewerKind(doc: ViewableDocument): AttachmentViewerKind {
  const mimeType = getTrustedDocumentMimeType(doc);
  if (IMAGE_MIME_TYPES.has(mimeType)) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (SPREADSHEET_MIME_TYPES.has(mimeType)) return "spreadsheet";
  if (TEXT_MIME_TYPES.has(mimeType)) return "text";
  if (DOWNLOAD_MIME_TYPES.has(mimeType)) return "download";

  const extension = getNormalizedDocumentExtension(doc);
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (extension === "pdf") return "pdf";
  if (SPREADSHEET_EXTENSIONS.has(extension)) return "spreadsheet";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  if (DOWNLOAD_EXTENSIONS.has(extension)) return "download";

  return "unsupported";
}

export function getAttachmentViewerPath(doc: ViewableDocument): string {
  const documentId = firstString([doc._id, doc.id]);
  if (documentId && isManagedRelativeUploadPath(doc.file_path)) {
    return `/documents/${encodeURIComponent(documentId)}/file`;
  }

  const extension = getNormalizedDocumentExtension(doc);
  const explicitPath = DOWNLOAD_EXTENSIONS.has(extension) ||
    SPREADSHEET_EXTENSIONS.has(extension) ||
    TEXT_EXTENSIONS.has(extension)
    ? firstString([doc.file_url, doc.file_path])
    : firstString([doc.preview_path, doc.file_url]);
  if (explicitPath) return explicitPath;

  return firstString([doc.file_path]);
}

export function resolveAttachmentViewerUrl(doc: ViewableDocument): string {
  const path = getAttachmentViewerPath(doc);
  if (!path) return "";

  return resolveManagedFileUrl(path);
}

export function resolveAttachmentPreviewUrl(doc: ViewableDocument): string {
  const documentId = firstString([doc._id, doc.id]);
  if (
    getAttachmentViewerKind(doc) === "spreadsheet" &&
    getNormalizedDocumentExtension(doc) === "xlsx" &&
    documentId
  ) {
    return resolveManagedFileUrl(`/documents/${encodeURIComponent(documentId)}/preview`);
  }
  return resolveAttachmentViewerUrl(doc);
}
