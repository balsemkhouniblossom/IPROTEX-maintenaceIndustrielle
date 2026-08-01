import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PartRequestDocument = PartRequest & Document;

export enum PartRequestStatus {
  PENDING = 'pending',
  RESERVED = 'reserved',
  FULFILLED = 'fulfilled',
  CANCELLED = 'cancelled',
}

/**
 * A parts request starts as a pending signal raised against an existing
 * work order ("we will likely need this part"). Deciding it 'approve'
 * moves it to Reserved and puts a hold on Stock (via
 * StockMovementsService.reserve, inside a transaction) — the part is not
 * yet physically used, only earmarked. It becomes Fulfilled once the
 * Technician's actual consumption (TechnicianService.setPartQuantity)
 * draws the reservation down to zero, or Cancelled if the reservation is
 * released before that (or if the request was rejected while still
 * Pending, which never touched Stock at all).
 */
@Schema({ timestamps: true })
export class PartRequest {
  @Prop({ required: true, unique: true })
  request_id: string;

  @Prop({ type: Types.ObjectId, ref: 'WorkOrder', required: true })
  ot_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Catalogue', required: true })
  part_id: Types.ObjectId;

  @Prop({ required: true })
  quantity: number;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  requested_by: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(PartRequestStatus),
    default: PartRequestStatus.PENDING,
    required: true,
  })
  status: PartRequestStatus;

  @Prop({ type: Date, required: true })
  requested_at: Date;
}

export const PartRequestSchema = SchemaFactory.createForClass(PartRequest);
// DB-level race guard: at most one request per (work order, part, active
// status). Keeping `status` in the key preserves the pending/reserved
// constraints without defining two indexes that share the same key pattern,
// which makes Mongoose emit a duplicate-index warning at startup/test time.
PartRequestSchema.index(
  { ot_id: 1, part_id: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: [PartRequestStatus.PENDING, PartRequestStatus.RESERVED] },
    },
  },
);
