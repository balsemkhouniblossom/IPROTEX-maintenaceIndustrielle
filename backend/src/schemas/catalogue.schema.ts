import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CatalogueDocument = Catalogue & Document;

@Schema()
export class Catalogue {
  @Prop({ required: true, unique: true })
  part_id: string;

  @Prop({ required: true })
  nom_piece: string;

  @Prop({ required: true })
  ref_constructeur: string;

  @Prop()
  fabricant?: string;

  @Prop()
  categorie_piece?: string;

  /**
   * Unit cost of one piece — optional and unset on every part until an
   * Admin sets it explicitly (no prior data to backfill: no cost/price
   * field existed anywhere in this codebase before). The "maintenance
   * costs" report multiplies this by consumption-type `StockMovement`
   * quantities; parts with no `unit_cost` simply contribute nothing to
   * that report's totals rather than a fabricated number.
   */
  @Prop()
  unit_cost?: number;
}

export const CatalogueSchema = SchemaFactory.createForClass(Catalogue);
