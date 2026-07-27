import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AiInteractionDocument = AiInteraction & Document;

export enum AiInteractionStatus {
  OK = 'ok',
  DISABLED = 'disabled',
  RATE_LIMITED = 'rate_limited',
  TIMEOUT = 'timeout',
  ERROR = 'error',
}

/**
 * The assistant's response is always split into these five sections so a
 * reader can never mistake a probable cause for a verified fact, or a
 * recommended check for something already done. Advisory-only by
 * construction: nothing on this shape (or anywhere in this module) mutates a
 * work order, stock level, machine status, or validation decision.
 */
export class AiAssistantAnswer {
  @Prop({ type: [String], default: [] })
  knownFacts!: string[];

  @Prop({ type: [String], default: [] })
  probableCauses!: string[];

  @Prop({ type: [String], default: [] })
  recommendedChecks!: string[];

  @Prop({ type: [String], default: [] })
  safetyWarnings!: string[];

  @Prop({ default: '' })
  uncertainty!: string;
}

/**
 * One row per AI-assistant request, win or lose — this is the auditable
 * interaction history the feature is required to keep. `question` stores the
 * text actually sent to the provider (after prompt-injection neutralization
 * and sensitive-data redaction), never the raw operator input, so the audit
 * trail can't itself become a place secrets leak to.
 */
@Schema({ timestamps: true })
export class AiInteraction {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  actor_user_id!: Types.ObjectId;

  @Prop({ required: true })
  actor_role!: string;

  @Prop({ type: Types.ObjectId, ref: 'Machine' })
  machine_id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WorkOrder' })
  work_order_id?: Types.ObjectId;

  @Prop({ trim: true })
  fault_code?: string;

  @Prop({ required: true })
  locale!: string;

  @Prop({ required: true })
  question!: string;

  @Prop({
    type: String,
    enum: Object.values(AiInteractionStatus),
    required: true,
  })
  status!: AiInteractionStatus;

  @Prop({ type: AiAssistantAnswer })
  answer?: AiAssistantAnswer;

  @Prop({ required: true })
  provider!: string;

  @Prop()
  model?: string;

  @Prop()
  latency_ms?: number;

  @Prop({ default: 0 })
  redactions_applied!: number;

  @Prop({ type: [String], default: [] })
  injection_flags!: string[];

  @Prop()
  error_message?: string;
}

export const AiInteractionSchema = SchemaFactory.createForClass(AiInteraction);
AiInteractionSchema.index({ actor_user_id: 1, createdAt: -1 });
AiInteractionSchema.index({ machine_id: 1, createdAt: -1 });
