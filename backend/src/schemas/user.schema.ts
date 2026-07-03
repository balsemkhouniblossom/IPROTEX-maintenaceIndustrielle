import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

export enum Role {
  ADMIN = 'admin',
  TECHNICIAN = 'technician',
  OPERATOR = 'operator',
}

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
  photo?: string;

  @Prop({ default: false })
  is_verified: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ role: 1, is_active: 1 });
