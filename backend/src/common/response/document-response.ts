import {
  DocumentEntity,
  DocumentDocument,
  DocumentLifecycleAction,
  DocumentStatus,
} from '../../schemas/document.schema';
import { MachineDocument } from '../../schemas/machine.schema';
import {
  MachineSummaryResponse,
  toMachineSummary,
} from './reference-summaries';
import {
  mapPopulatedRef,
  serializeDate,
  serializeObjectId,
} from './serialization.util';

export interface DocumentLifecycleEntryResponse {
  action: DocumentLifecycleAction;
  from_status?: DocumentStatus;
  to_status: DocumentStatus;
  actor_user_id?: string;
  reason?: string;
  at: string;
}

/**
 * The actual serialized shape of a Document as returned by every
 * `/operator/manuals`-style endpoint that reads `DocumentEntity` directly
 * (not through `DocumentsService`, which has its own `file_url` resolution
 * — out of scope here). `machine_id` is a plain ObjectId string on
 * endpoints that don't populate it and a `MachineSummaryResponse` on
 * endpoints that do.
 */
export interface DocumentSummaryResponse {
  _id: string;
  document_id: string;
  machine_id: string | MachineSummaryResponse;
  maintenance_plan_id?: string;
  work_order_id?: string;
  intervention_report_id?: string;
  type_document: string;
  file_path: string;
  storage_path?: string;
  file_url?: string;
  file_name: string;
  preview_path?: string;
  description?: string;
  tags: string[];
  uploaded_by?: string;
  date_ajout: string;
  status?: DocumentStatus;
  version?: number;
  revision?: number;
  root_document_id?: string;
  supersedes_document_id?: string;
  superseded_by_document_id?: string;
  lifecycle_history: DocumentLifecycleEntryResponse[];
}

type DocumentLike = (DocumentEntity | DocumentDocument) & { _id: unknown };

function toLifecycleEntryResponse(entry: {
  action: DocumentLifecycleAction;
  from_status?: DocumentStatus;
  to_status: DocumentStatus;
  actor_user_id?: unknown;
  reason?: string;
  at: Date;
}): DocumentLifecycleEntryResponse {
  return {
    action: entry.action,
    from_status: entry.from_status,
    to_status: entry.to_status,
    actor_user_id: serializeObjectId(entry.actor_user_id as string | undefined),
    reason: entry.reason,
    at: serializeDate(entry.at)!,
  };
}

export function toDocumentSummary(doc: DocumentLike): DocumentSummaryResponse {
  return {
    _id: serializeObjectId(doc._id as string)!,
    document_id: doc.document_id,
    machine_id: mapPopulatedRef(
      doc.machine_id as unknown as MachineDocument | string,
      toMachineSummary,
    )!,
    maintenance_plan_id: serializeObjectId(doc.maintenance_plan_id),
    work_order_id: serializeObjectId(doc.work_order_id),
    intervention_report_id: serializeObjectId(doc.intervention_report_id),
    type_document: doc.type_document,
    file_path: doc.file_path,
    storage_path: doc.storage_path,
    file_url: doc.file_url,
    file_name: doc.file_name,
    preview_path: doc.preview_path,
    description: doc.description,
    tags: doc.tags ?? [],
    uploaded_by: doc.uploaded_by,
    date_ajout: serializeDate(doc.date_ajout)!,
    status: doc.status,
    version: doc.version,
    revision: doc.revision,
    root_document_id: serializeObjectId(doc.root_document_id),
    supersedes_document_id: serializeObjectId(doc.supersedes_document_id),
    superseded_by_document_id: serializeObjectId(doc.superseded_by_document_id),
    lifecycle_history: (doc.lifecycle_history ?? []).map(
      toLifecycleEntryResponse,
    ),
  };
}
