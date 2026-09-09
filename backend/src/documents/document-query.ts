import type { FilterQuery } from 'mongoose';
import {
  DocumentStatus,
  type DocumentDocument,
} from '../schemas/document.schema';

/** Public operational reads expose only the current published revision. */
export const CURRENT_PUBLISHED_DOCUMENT_FILTER: FilterQuery<DocumentDocument> = {
  status: DocumentStatus.PUBLISHED,
  superseded_by_document_id: { $exists: false },
};

const MANUAL_METADATA_PATTERN =
  /(manual|procedure|diagram|pdf|word|docx?|excel|xlsx?|spreadsheet|powerpoint|pptx?)/i;
const SUPPORTED_DOCUMENT_FILE_PATTERN = /\.(pdf|docx?|xlsx?|pptx?)$/i;

/**
 * Manual discovery uses the validated document type/tags first and the
 * persisted supported extension as a compatibility fallback for legacy rows.
 */
export const MANUAL_DOCUMENT_FILTER: FilterQuery<DocumentDocument> = {
  $or: [
    { type_document: { $regex: MANUAL_METADATA_PATTERN } },
    { tags: { $regex: MANUAL_METADATA_PATTERN } },
    { file_name: { $regex: SUPPORTED_DOCUMENT_FILE_PATTERN } },
  ],
};

export function documentReadFilter(
  isAdmin: boolean,
): FilterQuery<DocumentDocument> {
  return isAdmin ? {} : CURRENT_PUBLISHED_DOCUMENT_FILTER;
}
