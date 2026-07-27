import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type KnowledgeArticleDocument = KnowledgeArticle & Document;

export enum KnowledgeArticleCategory {
  TROUBLESHOOTING = 'troubleshooting',
  PROCEDURE = 'procedure',
  FAULT_CODE = 'fault_code',
  LUBRICATION = 'lubrication',
  SAFETY = 'safety',
}

export enum KnowledgeArticleStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
}

export type KnowledgeArticleLifecycleAction =
  | 'created'
  | 'published'
  | 'archived'
  | 'superseded'
  | 'revised'
  | 'updated';

@Schema({ _id: false })
export class KnowledgeArticleLifecycleEntry {
  @Prop({ required: true })
  action: KnowledgeArticleLifecycleAction;

  @Prop({ type: String, enum: Object.values(KnowledgeArticleStatus) })
  from_status?: KnowledgeArticleStatus;

  @Prop({
    type: String,
    enum: Object.values(KnowledgeArticleStatus),
    required: true,
  })
  to_status: KnowledgeArticleStatus;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  actor_user_id?: Types.ObjectId;

  @Prop()
  reason?: string;

  @Prop({ type: Date, default: Date.now, required: true })
  at: Date;
}

const KnowledgeArticleLifecycleEntrySchema = SchemaFactory.createForClass(
  KnowledgeArticleLifecycleEntry,
);

/**
 * Draft articles are only visible to Admins authoring/reviewing them.
 * Publishing makes an article the current, citable knowledge surfaced to
 * Operators/Technicians and to the corrective/preventive suggestion engine.
 * Archiving is terminal (manually retired content). Unlike the Document
 * lifecycle this feature is deliberately only Draft/Published/Archived (no
 * separate "superseded" status) — instead, revising a published article
 * creates a new Draft row linked back via `supersedes_article_id`, and only
 * once *that* revision is itself published does the old row move to
 * Archived (with `superseded_by_article_id` set), which is how a caller can
 * tell an editorial archive apart from an auto-archived-by-supersession one.
 * The old row is never deleted, so every existing link/citation to it keeps
 * resolving, and `root_article_id`/`revision` let the full version history
 * be fetched with a single query — exactly like Document's version chain.
 */
@Schema({ timestamps: true })
export class KnowledgeArticle {
  @Prop({ required: true, unique: true })
  article_id!: string;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({
    type: String,
    enum: Object.values(KnowledgeArticleCategory),
    required: true,
  })
  category!: KnowledgeArticleCategory;

  @Prop({ trim: true })
  summary?: string;

  @Prop({ required: true })
  content!: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ type: Types.ObjectId, ref: 'MachineType' })
  machine_type_id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Machine' })
  machine_id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'MaintenancePlan' })
  maintenance_plan_id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'PreventiveTask' })
  preventive_task_id?: Types.ObjectId;

  /**
   * Matched by string value against `Panne.code_panne` / `WorkOrder.code_panne`
   * — the codebase's established fault-code convention is string equality,
   * not an ObjectId ref (see `OperatorService.buildFaultScope`). Mirrored
   * here so an article can be linked to a fault code before or independently
   * of any `Panne` catalog row existing for it.
   */
  @Prop({ type: [String], default: [] })
  fault_codes: string[];

  /**
   * Device/sensor error codes — a distinct free-form vocabulary from fault
   * codes, with no existing catalog entity in the app to reference against.
   */
  @Prop({ type: [String], default: [] })
  error_codes: string[];

  @Prop({ type: Types.ObjectId, ref: 'User' })
  author_id?: Types.ObjectId;

  /**
   * Deliberately no schema-level `default` on `status`/`version`, mirroring
   * Document/MaintenancePlan: Mongoose applies path defaults on hydration
   * too (not just insert), so a default would make any article created
   * outside this feature's own `create()` silently read back as
   * "draft, version 1" the instant it's touched.
   */
  @Prop({ type: String, enum: Object.values(KnowledgeArticleStatus) })
  status?: KnowledgeArticleStatus;

  @Prop({ type: Number })
  version?: number;

  /** Position within this article's own version chain (1 = original). */
  @Prop({ type: Number })
  revision?: number;

  @Prop({ type: Types.ObjectId, ref: 'KnowledgeArticle' })
  root_article_id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'KnowledgeArticle' })
  supersedes_article_id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'KnowledgeArticle' })
  superseded_by_article_id?: Types.ObjectId;

  @Prop({ type: [KnowledgeArticleLifecycleEntrySchema], default: [] })
  lifecycle_history: KnowledgeArticleLifecycleEntry[];
}

export const KnowledgeArticleSchema =
  SchemaFactory.createForClass(KnowledgeArticle);
KnowledgeArticleSchema.index({ status: 1, category: 1 });
KnowledgeArticleSchema.index({ machine_id: 1 });
KnowledgeArticleSchema.index({ machine_type_id: 1 });
KnowledgeArticleSchema.index({ maintenance_plan_id: 1 });
KnowledgeArticleSchema.index({ preventive_task_id: 1 });
KnowledgeArticleSchema.index({ fault_codes: 1 });
KnowledgeArticleSchema.index({ error_codes: 1 });
KnowledgeArticleSchema.index({ root_article_id: 1 });
// Search indexing: a single weighted text index across the searchable
// fields (title/tags weighted highest) is what `$text` queries in
// KnowledgeBaseService rely on for free-text search.
KnowledgeArticleSchema.index(
  { title: 'text', summary: 'text', tags: 'text', content: 'text' },
  {
    name: 'knowledge_article_text_search',
    weights: { title: 10, summary: 5, tags: 5, content: 1 },
  },
);

export const KNOWLEDGE_ARTICLE_TEXT_SEARCH_INDEX =
  'knowledge_article_text_search';
