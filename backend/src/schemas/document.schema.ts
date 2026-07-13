import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type DocumentDocument = DocumentEntity & Document;

@Schema({ timestamps: true })
export class DocumentEntity {
  @Prop({ required: true, unique: true })
  document_id: string;

  @Prop({ type: Types.ObjectId, ref: 'Machine', required: true })
  machine_id: Types.ObjectId;

  @Prop({ required: true })
  type_document: string; // manual, pdf, maintenance, etc.

  @Prop({ required: true })
  file_path: string;

  @Prop({ required: true })
  file_name: string;

  @Prop()
  preview_path?: string;

  @Prop()
  description: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop()
  uploaded_by: string;

  @Prop({ type: Date, default: Date.now })
  date_ajout: Date;
}

export const DocumentSchema = SchemaFactory.createForClass(DocumentEntity);
DocumentSchema.index({ machine_id: 1, type_document: 1 });
DocumentSchema.index({ date_ajout: -1 });
