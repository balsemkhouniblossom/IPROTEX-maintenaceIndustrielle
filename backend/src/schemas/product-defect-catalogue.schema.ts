import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ProductDefectCatalogueDocument = ProductDefectCatalogue & Document;

@Schema({ timestamps: true })
export class ProductDefectCatalogue {
  @Prop({ required: true, trim: true }) defect_code!: string;
  @Prop({ required: true, trim: true }) defect_name!: string;
  @Prop() source_process?: string;
  @Prop() normalized_process?: string;
  @Prop() subject?: string;
  @Prop() material?: string;
  @Prop() requirements_identification?: string;
  @Prop() description?: string;
  @Prop() cause?: string;
  @Prop() prevention?: string;
  @Prop() evaluation?: string;
  @Prop() test_program?: string;
  @Prop() test_samples?: string;
  @Prop() test_procedure?: string;
  @Prop() test_regulation?: string;
  @Prop({ required: true }) source!: string;
  @Prop({ required: true }) source_file!: string;
  @Prop() source_section?: number;
  @Prop() source_paragraph?: number;
  @Prop({ required: true }) import_identity!: string;
  @Prop({ default: true }) is_active!: boolean;
}

export const ProductDefectCatalogueSchema = SchemaFactory.createForClass(
  ProductDefectCatalogue,
);
ProductDefectCatalogueSchema.index({ defect_code: 1 }, { unique: true });
ProductDefectCatalogueSchema.index({ import_identity: 1 }, { unique: true });
ProductDefectCatalogueSchema.index({ normalized_process: 1, defect_code: 1 });
