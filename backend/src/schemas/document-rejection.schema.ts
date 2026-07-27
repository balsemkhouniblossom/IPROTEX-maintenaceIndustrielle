import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type DocumentRejectionDocument = DocumentRejection & Document;

/**
 * An immutable audit trail of every upload rejected by
 * `validateManagedDocumentUpload` (bad extension/MIME/magic-bytes, unsafe
 * filename, oversized). Nothing in this module ever updates or deletes a
 * row here — it exists purely so a rejected upload leaves forensic
 * evidence instead of vanishing silently. The rejected bytes themselves are
 * quarantined in storage (see `ManagedStorageFolder = 'quarantine'`) and
 * never touch the managed `uploads` folder a Document can reference, so a
 * rejected file can never become reachable through the protected document
 * proxy or any resolved URL.
 */
@Schema({ timestamps: true })
export class DocumentRejection {
  @Prop({ type: Types.ObjectId, ref: 'Machine' })
  machine_id?: Types.ObjectId;

  @Prop({ required: true })
  original_file_name: string;

  @Prop()
  mime_type?: string;

  @Prop({ required: true })
  size: number;

  @Prop({ required: true })
  reason: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  rejected_by?: Types.ObjectId;

  @Prop()
  quarantine_storage_key?: string;
}

export const DocumentRejectionSchema =
  SchemaFactory.createForClass(DocumentRejection);
DocumentRejectionSchema.index({ createdAt: -1 });
