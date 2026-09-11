import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DocumentEntity, DocumentDocument, RagIndexStatus } from '../../schemas/document.schema';
import { KnowledgeChunk, KnowledgeChunkDocument } from '../../schemas/knowledge-chunk.schema';
import { DocumentsService } from '../../documents/documents.service';
import { DocumentChunkingService } from './document-chunking.service';
import { DocumentExtractionService } from './document-extraction.service';
import { EmbeddingService } from './embedding.service';
import { RAG_EMBEDDING_DIMENSIONS } from '../rag.constants';

@Injectable()
export class DocumentIngestionService {
  private readonly logger = new Logger(DocumentIngestionService.name);

  constructor(
    @InjectModel(DocumentEntity.name) private readonly documentModel: Model<DocumentDocument>,
    @InjectModel(KnowledgeChunk.name) private readonly chunkModel: Model<KnowledgeChunkDocument>,
    private readonly documentsService: DocumentsService,
    private readonly extraction: DocumentExtractionService,
    private readonly chunking: DocumentChunkingService,
    private readonly embeddings: EmbeddingService,
  ) {}

  async indexDocument(documentId: string): Promise<{ status: RagIndexStatus; chunkCount: number }> {
    if (!Types.ObjectId.isValid(documentId)) throw new Error('Invalid document id');
    const document = await this.documentModel.findById(documentId).exec();
    if (!document) throw new Error('Document not found');
    await this.documentModel.updateOne({ _id: document._id }, { $set: { rag_status: RagIndexStatus.PROCESSING, rag_error: undefined } }).exec();
    try {
      const file = await this.documentsService.readProtectedFile(documentId, document);
      const extracted = await this.extraction.extract(file.buffer, document.file_name);
      const chunks = this.chunking.chunk(extracted.pages);
      const vectors = await this.embeddings.embedBatch(chunks.map((chunk) => chunk.content));
      const sourceVersion = document.version ?? 1;
      const records = chunks.map((chunk, index) => ({
        documentId: document._id,
        content: chunk.content,
        chunkIndex: index,
        embedding: vectors[index],
        documentName: document.file_name,
        documentType: document.type_document,
        pageNumber: chunk.pageNumber,
        section: chunk.section,
        machineId: document.machine_id,
        originalFilename: document.file_name,
        allowedRoles: ['ADMIN', 'TECHNICIAN', 'OPERATOR'],
        metadata: { maintenancePlanId: document.maintenance_plan_id?.toString(), workOrderId: document.work_order_id?.toString(), interventionReportId: document.intervention_report_id?.toString() },
        embeddingModel: this.embeddings.getModel(),
        embeddingDimensions: RAG_EMBEDDING_DIMENSIONS,
        sourceVersion,
      }));
      await this.chunkModel.deleteMany({ documentId: document._id }).exec();
      if (records.length) await this.chunkModel.insertMany(records, { ordered: true });
      await this.documentModel.updateOne({ _id: document._id }, { $set: { rag_status: RagIndexStatus.READY, rag_indexed_at: new Date(), rag_chunk_count: records.length }, $unset: { rag_error: 1 } }).exec();
      return { status: RagIndexStatus.READY, chunkCount: records.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'RAG indexing failed';
      await this.documentModel.updateOne({ _id: document._id }, { $set: { rag_status: RagIndexStatus.FAILED, rag_error: message.slice(0, 500) } }).exec();
      this.logger.error(`RAG indexing failed for document ${documentId}: ${message}`);
      return { status: RagIndexStatus.FAILED, chunkCount: 0 };
    }
  }

  async removeDocument(documentId: Types.ObjectId): Promise<void> {
    await this.chunkModel.deleteMany({ documentId }).exec();
  }

  async search(query: string, limit = 5): Promise<KnowledgeChunkDocument[]> {
    const vector = await this.embeddings.embedQuery(query);
    return this.chunkModel.aggregate([
      { $vectorSearch: { index: 'knowledge_vector_index', path: 'embedding', queryVector: vector, numCandidates: Math.max(limit * 20, 50), limit } },
      { $project: { content: 1, documentId: 1, documentName: 1, pageNumber: 1, section: 1, score: { $meta: 'vectorSearchScore' } } },
    ]).exec();
  }
}

