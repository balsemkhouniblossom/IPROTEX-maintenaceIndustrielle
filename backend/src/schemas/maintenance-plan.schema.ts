import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MaintenancePlanDocument = MaintenancePlan & Document;

export enum MaintenancePlanStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  PAUSED = 'paused',
  ARCHIVED = 'archived',
  COMPLETED = 'completed',
}

export type MaintenancePlanLifecycleAction =
  | 'created'
  | 'activated'
  | 'paused'
  | 'resumed'
  | 'archived'
  | 'completed'
  | 'updated';

@Schema({ _id: false })
export class MaintenancePlanLifecycleEntry {
  @Prop({ required: true })
  action: MaintenancePlanLifecycleAction;

  @Prop({ type: String, enum: Object.values(MaintenancePlanStatus) })
  from_status?: MaintenancePlanStatus;

  @Prop({
    type: String,
    enum: Object.values(MaintenancePlanStatus),
    required: true,
  })
  to_status: MaintenancePlanStatus;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  actor_user_id?: Types.ObjectId;

  @Prop()
  reason?: string;

  @Prop({ type: Date, default: Date.now, required: true })
  at: Date;
}

const MaintenancePlanLifecycleEntrySchema = SchemaFactory.createForClass(
  MaintenancePlanLifecycleEntry,
);

/**
 * A Draft plan has never been activated: nothing schedules against it. Once
 * Active, the nightly/manual scheduling flows may generate occurrences.
 * Pausing stops *future* scheduling only — existing WorkOrders/reports are
 * left completely alone, which is what preserves history. Archived is
 * terminal and read-only (no further edits, deletes, or scheduling).
 * Completed marks a plan whose maintenance program has run its course but
 * is kept around (unlike Archived) as still a "live" record until it too is
 * archived.
 */
@Schema({ timestamps: true })
export class MaintenancePlan {
  @Prop({ required: true, unique: true })
  plan_id!: string;

  @Prop({ type: Types.ObjectId, ref: 'Module', required: true })
  module_id!: Types.ObjectId;

  @Prop({ required: true })
  type_maintenance!: string;

  @Prop({ required: true })
  frequence!: number;

  @Prop({ required: true })
  unite_frequence!: string;

  @Prop()
  instruction?: string;

  @Prop()
  responsable?: string;

  @Prop()
  huile_graisse?: string;

  @Prop()
  documentation?: string;

  @Prop()
  maintenance_code?: string;

  @Prop()
  frequence_label?: string;

  @Prop({
    type: String,
    enum: Object.values(MaintenancePlanStatus),
  })
  status?: MaintenancePlanStatus;

  /**
   * Optimistic-concurrency counter. Incremented on every edit and every
   * lifecycle transition. Once the plan has a validated occurrence,
   * `MaintenancePlansService` requires the caller's `expected_version` to
   * match before allowing an edit or delete — this is the "version-safe"
   * escape hatch the task describes, mirroring the compare-and-swap pattern
   * already used for PartRequest decisions.
   *
   * Deliberately no schema-level `default` on `status`/`version`: Mongoose
   * applies path defaults even when *hydrating* an existing document (not
   * just on insert), so a `default` here would make every legacy/imported
   * plan silently read back as "draft" the moment the app touches it —
   * exactly the regression the "imported plans" requirement guards
   * against. `MaintenancePlansService.create()` sets both explicitly for
   * every plan created through the API; only plans that bypassed Mongoose
   * entirely (the raw-driver import scripts) are ever missing them.
   */
  @Prop({ type: Number })
  version?: number;

  @Prop({ type: [MaintenancePlanLifecycleEntrySchema], default: [] })
  lifecycle_history: MaintenancePlanLifecycleEntry[];
}

export const MaintenancePlanSchema =
  SchemaFactory.createForClass(MaintenancePlan);
MaintenancePlanSchema.index({ module_id: 1, type_maintenance: 1 });
MaintenancePlanSchema.index({ status: 1 });
// Supports the Admin maintenance plans list's default newest-first sort.
MaintenancePlanSchema.index({ createdAt: -1 });
