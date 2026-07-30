import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document, Types } from 'mongoose';

export type UserDocument = User & Document;

export type GoogleAuthHistoryEntry = {
  action: 'linked' | 'unlinked' | 'relinked';
  google_id?: string;
  previous_google_id?: string;
  actor_user_id?: Types.ObjectId;
  at: Date;
};

export enum Role {
  ADMIN = 'admin',
  TECHNICIAN = 'technician',
  OPERATOR = 'operator',
}

export enum ApprovalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export type ApprovalHistoryEntry = {
  status: ApprovalStatus;
  actor_user_id?: Types.ObjectId;
  reason?: string;
  at: Date;
};

@Schema()
export class User {
  @Prop({ unique: true })
  user_id: string;

  @Prop({ required: true })
  nom_complet: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: false })
  password?: string;

  @Prop({
    required: false,
    unique: true,
    sparse: true,
  })
  google_id?: string;

  @Prop({ type: Date, required: false })
  google_linked_at?: Date;

  @Prop({ type: Date, required: false })
  google_unlinked_at?: Date;

  @Prop({
    type: [
      {
        action: {
          type: String,
          enum: ['linked', 'unlinked', 'relinked'],
          required: true,
        },
        google_id: { type: String, required: false },
        previous_google_id: { type: String, required: false },
        actor_user_id: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: false,
        },
        at: { type: Date, default: Date.now },
      },
    ],
    default: [],
  })
  google_auth_history?: GoogleAuthHistoryEntry[];

  @Prop()
  refresh_token_hash?: string;

  @Prop({ required: false })
  reset_password_token?: string;

  @Prop({ type: Date, required: false })
  reset_password_expires?: Date;

  @Prop({
    enum: Role,
    default: Role.OPERATOR,
  })
  role: Role;

  @Prop({ default: true })
  is_active: boolean;

  @Prop({ type: Date })
  last_login?: Date;

  @Prop({ type: [Date], default: [] })
  login_history?: Date[];

  @Prop({ type: Date, default: Date.now })
  created_at: Date;

  @Prop()
  phone?: string;

  @Prop()
  department?: string;

  @Prop()
  position?: string;

  @Prop()
  language?: string;

  @Prop({ default: true })
  profile_completed: boolean;

  @Prop()
  photo?: string;

  @Prop()
  photo_storage_path?: string;

  @Prop()
  photo_url?: string;

  @Prop({ type: [Types.ObjectId], ref: 'Machine', default: [] })
  assigned_machine_ids?: Types.ObjectId[];

  @Prop({ default: false })
  is_verified: boolean;

  @Prop({
    type: String,
    enum: Object.values(ApprovalStatus),
    required: false,
  })
  approval_status?: ApprovalStatus;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: User.name,
    required: false,
  })
  approved_by?: Types.ObjectId;

  @Prop({ required: false })
  approved_at?: Date;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: User.name,
    required: false,
  })
  rejected_by?: Types.ObjectId;

  @Prop({ required: false })
  rejected_at?: Date;

  @Prop({
    type: String,
    required: false,
    trim: true,
    maxlength: 500,
  })
  rejection_reason?: string;

  // Append-only audit trail of every admin approval/rejection decision.
  // Unlike approved_by/approved_at/rejected_*, these entries are never
  // unset on a subsequent transition, so the full decision history
  // survives repeated approve/reject cycles.
  @Prop({
    type: [
      {
        status: {
          type: String,
          enum: Object.values(ApprovalStatus),
          required: true,
        },
        actor_user_id: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: false,
        },
        reason: { type: String, required: false, trim: true, maxlength: 500 },
        at: { type: Date, default: Date.now },
      },
    ],
    default: [],
  })
  approval_history?: ApprovalHistoryEntry[];
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ role: 1, is_active: 1 });
// Supports the Admin users list's approval-status filter and the
// pending-approvals queue's chronological sort/pagination.
UserSchema.index({ approval_status: 1, created_at: -1 });
