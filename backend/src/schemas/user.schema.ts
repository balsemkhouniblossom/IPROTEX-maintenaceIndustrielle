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

  /**
   * Set true to force this account through the password-reset flow before
   * it can do anything else. Checked in `validateAccountAccess` — the same
   * gate both login (`AuthService.validateUser`) and every authenticated
   * request (`JwtAuthGuard`) already run through — so a flagged account is
   * rejected immediately, not just on its next login. Cleared automatically
   * once `AuthService.resetPassword`/`updatePasswordAndClearReset` succeeds.
   */
  @Prop({ type: Boolean, default: false })
  must_reset_password?: boolean;

  /**
   * Any access or refresh token whose `iat` (issued-at) claim predates this
   * timestamp is rejected, even if it hasn't expired yet — see
   * `JwtStrategy.validate()` and `AuthService.refreshToken()`. This is what
   * makes "revoke every existing session" possible without rotating
   * JWT_SECRET: bump this to `now()` (per-user, via an admin-forced reset,
   * or for every user at once via a bulk operation) and every token issued
   * before that instant stops working on its very next request, regardless
   * of the token's own expiry.
   */
  @Prop({ type: Date, required: false })
  credentials_invalidated_at?: Date;

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
UserSchema.index(
  { reset_password_token: 1, reset_password_expires: 1 },
  {
    name: 'users_reset_token_expires',
    partialFilterExpression: { reset_password_token: { $exists: true } },
  },
);

/**
 * Fields that must never leave the server, under any code path that
 * serializes a User document — direct responses, `.populate('technician_id'
 * | 'actor_user_id' | ...)` on another collection, admin CRUD, etc. This is
 * a backstop, not a substitute for `.select()`/explicit populate
 * projections: those still control what's fetched from the DB at all, this
 * controls what's allowed to survive serialization once a full document
 * exists in memory (e.g. because a query elsewhere in the codebase forgot
 * to restrict it, or because a future call site introduces the same
 * mistake). Deliberately narrow — only credential/secret-shaped fields and
 * the Google account identifier, per this being a security backstop rather
 * than a general-purpose response-shaping mechanism. Other
 * response-shaping (approval audit fields, login history, etc.) stays the
 * responsibility of each call site's own sanitizer.
 */
const SENSITIVE_USER_FIELDS = [
  'password',
  'refresh_token_hash',
  'reset_password_token',
  'reset_password_expires',
  'google_id',
  'google_auth_history',
] as const;

// `ret` is typed `any` deliberately: Mongoose's own `transform` type is the
// exact `User`-shaped object (no index signature), which a
// `Record<string, unknown>` parameter can't structurally satisfy. `any`
// keeps this assignable to `SchemaOptions['toJSON'/'toObject'].transform`
// for every schema it might ever be reused on, without weakening the
// deletion logic itself (still driven by the literal `SENSITIVE_USER_FIELDS`
// tuple).

function stripSensitiveUserFields(_doc: unknown, ret: any): any {
  for (const field of SENSITIVE_USER_FIELDS) {
    delete ret[field];
  }
  return ret;
}

UserSchema.set('toJSON', { transform: stripSensitiveUserFields });
UserSchema.set('toObject', { transform: stripSensitiveUserFields });
