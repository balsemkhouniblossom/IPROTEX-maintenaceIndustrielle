import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type GoogleLoginExchangeDocument = HydratedDocument<GoogleLoginExchange>;

@Schema()
export class GoogleLoginExchange {
  @Prop({ required: true, unique: true, index: true })
  code_hash: string;

  @Prop({ required: true })
  encrypted_payload: string;

  @Prop({ required: true })
  encryption_iv: string;

  @Prop({ required: true })
  encryption_tag: string;

  @Prop({ type: Date, default: Date.now })
  created_at: Date;

  @Prop({ type: Date, required: true })
  expires_at: Date;
}

export const GoogleLoginExchangeSchema =
  SchemaFactory.createForClass(GoogleLoginExchange);

GoogleLoginExchangeSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
