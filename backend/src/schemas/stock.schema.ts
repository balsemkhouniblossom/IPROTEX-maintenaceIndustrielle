import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type StockDocument = Stock & Document;

@Schema()
export class Stock {
  @Prop({ required: true, unique: true })
  stock_id: string;

  @Prop({ type: Types.ObjectId, ref: 'Catalogue', required: true })
  part_id: Types.ObjectId;

  @Prop({ required: true })
  quantite_en_stock: number;

  /**
   * Quantity held against approved-but-not-yet-consumed part requests.
   * Available-to-promise is always `quantite_en_stock - quantite_reservee`
   * — every stock-mutating flow goes through `StockMovementsService`,
   * which is the only code allowed to change either field, always inside
   * a transaction alongside the `StockMovement` ledger entry that explains
   * the change.
   */
  @Prop({ type: Number, default: 0 })
  quantite_reservee: number;

  @Prop()
  seuil_alerte_stock?: number;

  @Prop()
  quantite_minimale?: number;

  @Prop()
  emplacement?: string;

  /**
   * Optimistic-concurrency counter, incremented by every movement. No
   * schema-level `default` is set deliberately — see the equivalent note
   * on `MaintenancePlan.version`: Mongoose applies path defaults even when
   * hydrating a pre-existing document, which would make any stock record
   * that predates this field silently read back as version 1 and make a
   * genuinely-concurrent edit look falsely consistent. `StocksService`
   * treats a missing version the same way `MaintenancePlansService` does:
   * as an `$exists: false` match, not a literal value.
   */
  @Prop({ type: Number })
  version?: number;
}

export const StockSchema = SchemaFactory.createForClass(Stock);
StockSchema.index({ part_id: 1 });
