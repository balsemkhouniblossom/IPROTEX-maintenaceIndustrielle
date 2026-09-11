import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Role } from './user.schema';

export type KnowledgeChunkDocument = KnowledgeChunk & Document;

@Schema({ timestamps: true, collection: 'knowledge_chunks' })
export class KnowledgeChunk {
  @Prop({
    type: Types.ObjectId,
    ref: 'DocumentEntity',
    required: true,
    index: true,
  })
  documentId: Types.ObjectId;

  @Prop({ required: true })
  content: string;

  @Prop({ required: true, min: 0 })
  chunkIndex: number;

  @Prop({ type: [Number], required: true })
  embedding: number[];

  @Prop({ required: true })
  documentName: string;

  @Prop({ required: true })
  documentType: string;

  @Prop()
  pageNumber?: number;

  @Prop()
  section?: string;

  @Prop()
  language?: string;

  @Prop({ type: Types.ObjectId, ref: 'Machine' })
  machineId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'MachineType' })
  machineTypeId?: Types.ObjectId;

  @Prop({ type: [String], enum: Object.values(Role), default: [] })
  allowedRoles: Role[];

  @Prop()
  originalFilename?: string;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>;

  @Prop({ required: true, index: true })
  embeddingModel: string;

  @Prop({ required: true })
  embeddingDimensions: number;

  @Prop({ required: true, index: true })
  sourceVersion: number;

  /** Identifies one atomically installed ingestion generation. */
  @Prop({ required: true, index: true })
  ingestionKey: string;
}

export const KnowledgeChunkSchema =
  SchemaFactory.createForClass(KnowledgeChunk);
KnowledgeChunkSchema.index(
  { documentId: 1, ingestionKey: 1, chunkIndex: 1 },
  { unique: true },
);
KnowledgeChunkSchema.index({ machineId: 1, documentType: 1 });
KnowledgeChunkSchema.index({ machineTypeId: 1 });
KnowledgeChunkSchema.index({ allowedRoles: 1 });
KnowledgeChunkSchema.index({ documentId: 1, sourceVersion: 1 });
