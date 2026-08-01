import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type StockMovementDocument = StockMovement & Document;

export enum StockMovementType {
  RESERVATION = 'reservation',
  CONSUMPTION = 'consumption',
  RETURN = 'return',
  ADJUSTMENT = 'adjustment',
  CANCELLATION = 'cancellation',
}

/**
 * One append-only ledger entry per stock-affecting event. This is the
 * "full audit history" the inventory lifecycle is built around: every
 * reservation, consumption, return, adjustment, and cancellation writes
 * exactly one of these, inside the same transaction as the Stock counter
 * update it describes, so the ledger and the counters can never drift
 * apart. Never updated or deleted once written.
 */
@Schema({ timestamps: true })
export class StockMovement {
  @Prop({ required: true, unique: true })
  movement_id: string;

  @Prop({
    type: String,
    enum: Object.values(StockMovementType),
    required: true,
  })
  type: StockMovementType;

  @Prop({ type: Types.ObjectId, ref: 'Stock', required: true })
  stock_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Catalogue', required: true })
  part_id: Types.ObjectId;

  /** Signed change applied to `quantite_en_stock` by this event (0 for a pure reservation/cancellation, which only move `quantite_reservee`). */
  @Prop({ required: true })
  quantity_delta: number;

  /** Signed change applied to `quantite_reservee` by this event. */
  @Prop({ required: true })
  reserved_delta: number;

  @Prop({ required: true })
  quantite_en_stock_after: number;

  @Prop({ required: true })
  quantite_reservee_after: number;

  @Prop({ type: Types.ObjectId, ref: 'WorkOrder' })
  work_order_id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'PartRequest' })
  part_request_id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  actor_user_id?: Types.ObjectId;

  @Prop()
  reason?: string;
}

export const StockMovementSchema = SchemaFactory.createForClass(StockMovement);
StockMovementSchema.index({ stock_id: 1, createdAt: -1 });
StockMovementSchema.index({ work_order_id: 1 });
StockMovementSchema.index({ part_request_id: 1 });
