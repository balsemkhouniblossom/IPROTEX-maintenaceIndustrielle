const MAX_FILE_NAME_LENGTH = 255;

// Rejects path separators, path-traversal segments, null/control characters,
// and leading/trailing whitespace — the file name is only ever used to
// derive an extension and for display (the stored file name on disk/in
// object storage is always a freshly generated UUID), but a malicious
// original name must never be trusted even for that.
// eslint-disable-next-line no-control-regex
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
const ZIP_LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04];
const MAX_ZIP_ENTRIES = 2_048;
const MAX_ZIP_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_ZIP_COMPRESSION_RATIO = 200;

type OoxmlKind = 'word' | 'xl' | 'ppt';

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function isSafeCentralDirectoryEntry(
  buffer: Buffer,
  offset: number,
  eocdOffset: number,
): boolean {
  if (offset + 46 > eocdOffset || buffer.readUInt32LE(offset) !== 0x02014b50) {
    return false;
  }
  const flags = buffer.readUInt16LE(offset + 8);
  const method = buffer.readUInt16LE(offset + 10);
  return (flags & 0x1) === 0 && [0, 8].includes(method);
}

function isSafeZipEntryName(name: string): boolean {
  return Boolean(
    name &&
    !name.includes('\\') &&
    !name.startsWith('/') &&
    !name.split('/').includes('..'),
  );
}

interface CentralDirectoryMetadata {
  bufferLength: number;
  eocdOffset: number;
  diskNumber: number;
  centralDisk: number;
  diskEntries: number;
  totalEntries: number;
  centralSize: number;
  centralOffset: number;
  commentLength: number;
}

function hasValidCentralDirectoryMetadata(
  metadata: CentralDirectoryMetadata,
): boolean {
  const {
    bufferLength,
    eocdOffset,
    diskNumber,
    centralDisk,
    diskEntries,
    totalEntries,
    centralSize,
    centralOffset,
    commentLength,
  } = metadata;
  return (
    diskNumber === 0 &&
    centralDisk === 0 &&
    diskEntries === totalEntries &&
    totalEntries > 0 &&
    totalEntries <= MAX_ZIP_ENTRIES &&
    eocdOffset + 22 + commentLength <= bufferLength &&
    centralOffset + centralSize <= eocdOffset
  );
}

function hasValidOoxmlEntries(
  buffer: Buffer,
  metadata: CentralDirectoryMetadata,
  expectedKind: OoxmlKind,
): boolean {
  const { centralOffset, centralSize, eocdOffset, totalEntries } = metadata;
  let offset = centralOffset;
  let totalCompressed = 0;
  let totalUncompressed = 0;
  let hasContentTypes = false;
  let hasExpectedDirectory = false;

  for (let index = 0; index < totalEntries; index += 1) {
    if (!isSafeCentralDirectoryEntry(buffer, offset, eocdOffset)) return false;
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const entryCommentLength = buffer.readUInt16LE(offset + 32);
    const nextOffset =
      offset + 46 + nameLength + extraLength + entryCommentLength;
    if (nextOffset > eocdOffset) return false;

    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (!isSafeZipEntryName(name)) return false;
    hasContentTypes ||= name === '[Content_Types].xml';
    hasExpectedDirectory ||= name.startsWith(`${expectedKind}/`);
    totalCompressed += compressedSize;
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) return false;
    offset = nextOffset;
  }

  const hasSafeCompressionRatio =
    totalUncompressed <= 1024 * 1024 ||
    totalUncompressed / Math.max(1, totalCompressed) <=
      MAX_ZIP_COMPRESSION_RATIO;
  return (
    offset === centralOffset + centralSize &&
    hasSafeCompressionRatio &&
    hasContentTypes &&
    hasExpectedDirectory
  );
}

function isOoxmlContainer(buffer: Buffer, expectedKind: OoxmlKind): boolean {
  if (!hasPrefix(buffer, ZIP_LOCAL_HEADER) || buffer.length < 22) return false;

  try {
    const eocdOffset = findEndOfCentralDirectory(buffer);
    if (eocdOffset < 0) return false;
    const metadata: CentralDirectoryMetadata = {
      bufferLength: buffer.length,
      eocdOffset,
      diskNumber: buffer.readUInt16LE(eocdOffset + 4),
      centralDisk: buffer.readUInt16LE(eocdOffset + 6),
      diskEntries: buffer.readUInt16LE(eocdOffset + 8),
      totalEntries: buffer.readUInt16LE(eocdOffset + 10),
      centralSize: buffer.readUInt32LE(eocdOffset + 12),
      centralOffset: buffer.readUInt32LE(eocdOffset + 16),
      commentLength: buffer.readUInt16LE(eocdOffset + 20),
    };
    return (
      hasValidCentralDirectoryMetadata(metadata) &&
      hasValidOoxmlEntries(buffer, metadata, expectedKind)
    );
  } catch {
    return false;
  }
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
    matchesMagicBytes: (buffer) => isOoxmlContainer(buffer, 'word'),
  },
  '.xlsx': {
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    matchesMagicBytes: (buffer) => isOoxmlContainer(buffer, 'xl'),
  },
  '.pptx': {
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
    matchesMagicBytes: (buffer) => isOoxmlContainer(buffer, 'ppt'),
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
