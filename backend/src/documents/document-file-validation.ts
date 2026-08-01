const MAX_FILE_NAME_LENGTH = 255;

// Rejects path separators, path-traversal segments, null/control characters,
// and leading/trailing whitespace — the file name is only ever used to
// derive an extension and for display (the stored file name on disk/in
// object storage is always a freshly generated UUID), but a malicious
// original name must never be trusted even for that.
const UNSAFE_FILE_NAME_PATTERN = /[\\/\x00-\x1f]/;

interface DocumentKindRule {
  mimeTypes: string[];
  matchesMagicBytes: (buffer: Buffer) => boolean;
}

function hasPrefix(buffer: Buffer, bytes: number[]): boolean {
  if (buffer.length < bytes.length) return false;
  return bytes.every((byte, index) => buffer[index] === byte);
}

const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
];

function isZip(buffer: Buffer): boolean {
  return ZIP_SIGNATURES.some((signature) => hasPrefix(buffer, signature));
}

function isOle2(buffer: Buffer): boolean {
  return hasPrefix(buffer, OLE2_SIGNATURE);
}

/**
 * One entry per accepted managed-document extension. Old binary Office
 * formats (.doc/.xls/.ppt) all share the same OLE2 compound-file signature,
 * and modern OOXML formats (.docx/.xlsx/.pptx) all share the plain ZIP
 * signature — that ambiguity is inherent to the formats themselves, not a
 * gap in this check; distinguishing them further would require unzipping
 * and inspecting `[Content_Types].xml`, which is unnecessary for the
 * threat this guards against (a renamed executable/script masquerading as
 * a document).
 */
const DOCUMENT_EXTENSION_RULES: Record<string, DocumentKindRule> = {
  '.pdf': {
    mimeTypes: ['application/pdf'],
    matchesMagicBytes: (buffer) => hasPrefix(buffer, [0x25, 0x50, 0x44, 0x46]), // %PDF
  },
  '.doc': {
    mimeTypes: ['application/msword'],
    matchesMagicBytes: isOle2,
  },
  '.xls': {
    mimeTypes: ['application/vnd.ms-excel'],
    matchesMagicBytes: isOle2,
  },
  '.ppt': {
    mimeTypes: ['application/vnd.ms-powerpoint'],
    matchesMagicBytes: isOle2,
  },
  '.docx': {
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    matchesMagicBytes: isZip,
  },
  '.xlsx': {
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    matchesMagicBytes: isZip,
  },
  '.pptx': {
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
    matchesMagicBytes: isZip,
  },
};

export const ALLOWED_DOCUMENT_EXTENSIONS = Object.keys(
  DOCUMENT_EXTENSION_RULES,
);

// Some browsers/clients send a generic fallback content type instead of the
// precise one for the file — that's accepted as long as the extension and
// magic bytes agree, since the whole point of the three-way check is that
// no single signal can be spoofed alone.
const GENERIC_MIME_TYPES = new Set([
  'application/octet-stream',
  'binary/octet-stream',
]);

export interface DocumentUploadValidationInput {
  originalName: string;
  mimeType?: string;
  buffer: Buffer;
  size: number;
  maxBytes: number;
}

export type DocumentUploadValidationResult =
  | { ok: true; extension: string }
  | { ok: false; reason: string };

function getExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === fileName.length - 1) return '';
  return fileName.slice(lastDot).toLowerCase();
}

export function isSafeFileName(fileName: string): boolean {
  const trimmed = fileName.trim();
  if (!trimmed || trimmed !== fileName) return false;
  if (trimmed.length > MAX_FILE_NAME_LENGTH) return false;
  if (trimmed === '.' || trimmed === '..') return false;
  if (UNSAFE_FILE_NAME_PATTERN.test(trimmed)) return false;
  return true;
}

/**
 * Validates an uploaded PDF/Office file against size, safe-filename,
 * extension, declared MIME type, and magic-byte rules, in that order —
 * each check is cheap-to-expensive so a malformed request fails fast.
 * Returns a plain result object (rather than throwing) so callers decide
 * how to translate a failure into an HTTP response *and* into a quarantine
 * + rejection-audit side effect; this function has no knowledge of either.
 */
export function validateManagedDocumentUpload(
  input: DocumentUploadValidationInput,
): DocumentUploadValidationResult {
  if (!input.buffer?.length || input.size <= 0) {
    return { ok: false, reason: 'Uploaded file is empty' };
  }

  if (input.size > input.maxBytes || input.buffer.length > input.maxBytes) {
    const maxMb = Math.floor(input.maxBytes / (1024 * 1024));
    return { ok: false, reason: `Uploaded file exceeds the ${maxMb} MB limit` };
  }

  if (!isSafeFileName(input.originalName)) {
    return { ok: false, reason: 'Unsafe or invalid file name' };
  }

  const extension = getExtension(input.originalName);
  const rule = DOCUMENT_EXTENSION_RULES[extension];
  if (!rule) {
    return {
      ok: false,
      reason:
        'Unsupported file type: only PDF and Office documents (Word, Excel, PowerPoint) are allowed',
    };
  }

  const declaredMime = input.mimeType?.toLowerCase().trim();
  if (
    declaredMime &&
    !GENERIC_MIME_TYPES.has(declaredMime) &&
    !rule.mimeTypes.includes(declaredMime)
  ) {
    return {
      ok: false,
      reason: 'Declared file type does not match its extension',
    };
  }

  if (!rule.matchesMagicBytes(input.buffer)) {
    return {
      ok: false,
      reason:
        'File content does not match its declared type (failed content verification)',
    };
  }

  return { ok: true, extension };
}
