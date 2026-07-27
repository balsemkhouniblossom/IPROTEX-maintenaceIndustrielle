import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type DocumentDocument = DocumentEntity & Document;

export enum DocumentStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
  SUPERSEDED = 'superseded',
}

export type DocumentLifecycleAction =
  | 'created'
  | 'published'
  | 'archived'
  | 'superseded'
  | 'replaced'
  | 'updated';

@Schema({ _id: false })
export class DocumentLifecycleEntry {
  @Prop({ required: true })
  action: DocumentLifecycleAction;

  @Prop({ type: String, enum: Object.values(DocumentStatus) })
  from_status?: DocumentStatus;

  @Prop({ type: String, enum: Object.values(DocumentStatus), required: true })
  to_status: DocumentStatus;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  actor_user_id?: Types.ObjectId;

  @Prop()
  reason?: string;

  @Prop({ type: Date, default: Date.now, required: true })
  at: Date;
}

const DocumentLifecycleEntrySchema = SchemaFactory.createForClass(
  DocumentLifecycleEntry,
);

/**
 * Draft documents are only visible to their uploader's role tier (Admin) —
 * nothing links to them as "the current file" yet. Publishing makes a
 * document the current, citable version for its linked machine/plan/work
 * order/report. Archiving is a terminal, read-only state reached directly
 * from Draft or Published (abandoned drafts or retired publications alike).
 * Superseded is reached only through the `replace` operation: the old
 * document is never deleted, only flagged Superseded and pointed at its
 * replacement via `superseded_by_document_id`, so every historical
 * reference to it (from a work order, an intervention report, an audit
 * trail) keeps resolving correctly forever.
 */
@Schema({ timestamps: true })
export class DocumentEntity {
  @Prop({ required: true, unique: true })
  document_id: string;

  @Prop({ type: Types.ObjectId, ref: 'Machine', required: true })
  machine_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'MaintenancePlan' })
  maintenance_plan_id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WorkOrder' })
  work_order_id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'InterventionReport' })
  intervention_report_id?: Types.ObjectId;

  @Prop({ required: true })
  type_document: string; // manual, pdf, maintenance, etc.

  @Prop({ required: true })
  file_path: string;

  @Prop()
  storage_path?: string;

  @Prop()
  file_url?: string;

  @Prop({ required: true })
  file_name: string;

  @Prop()
  preview_path?: string;

  @Prop()
  description: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop()
  uploaded_by: string;

  @Prop({ type: Date, default: Date.now })
  date_ajout: Date;

  @Prop({
    type: String,
    enum: Object.values(DocumentStatus),
  })
  status?: DocumentStatus;

  /**
   * Optimistic-concurrency counter, incremented on every edit and lifecycle
   * transition. Deliberately no schema-level `default`, for the same reason
   * documented on `MaintenancePlan.version`: Mongoose applies path defaults
   * on hydration too, not just insert, so a `default` here would make any
   * document that predates this feature (or was imported outside the API)
   * silently read back as "draft, version 1" the instant it's touched.
   * `DocumentsService.create()` sets it explicitly for every new upload.
   */
  @Prop({ type: Number })
  version?: number;

  /**
   * Position of this document within its own version-history chain
   * (1 = original upload, 2 = its first replacement, ...). Distinct from
   * `version` (optimistic-concurrency, per-document) — `revision` is a
   * property of the *chain*, unaffected by unrelated edits.
   */
  @Prop({ type: Number })
  revision?: number;

  /**
   * Self-references forming the version-history chain. `root_document_id`
   * is unset on the very first version of a document and points back to it
   * on every later revision, so the whole chain can be fetched with a
   * single `{ $or: [{ _id: rootId }, { root_document_id: rootId }] }`
   * query. `supersedes_document_id`/`superseded_by_document_id` are the
   * immediate neighbors in the chain.
   */
  @Prop({ type: Types.ObjectId, ref: 'DocumentEntity' })
  root_document_id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'DocumentEntity' })
  supersedes_document_id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'DocumentEntity' })
  superseded_by_document_id?: Types.ObjectId;

  @Prop({ type: [DocumentLifecycleEntrySchema], default: [] })
  lifecycle_history: DocumentLifecycleEntry[];
}

export const DocumentSchema = SchemaFactory.createForClass(DocumentEntity);
DocumentSchema.index({ machine_id: 1, type_document: 1 });
DocumentSchema.index({ date_ajout: -1 });
DocumentSchema.index({ status: 1 });
DocumentSchema.index({ maintenance_plan_id: 1 });
DocumentSchema.index({ work_order_id: 1 });
DocumentSchema.index({ intervention_report_id: 1 });
DocumentSchema.index({ root_document_id: 1 });
