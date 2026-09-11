import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomUUID } from 'node:crypto';
import { FilterQuery, Model, PipelineStage, Types } from 'mongoose';
import {
  DocumentEntity,
  DocumentDocument,
  DocumentStatus,
  RagIndexStatus,
} from '../../schemas/document.schema';
import {
  KnowledgeChunk,
  KnowledgeChunkDocument,
} from '../../schemas/knowledge-chunk.schema';
import { Machine, MachineDocument } from '../../schemas/machine.schema';
import { Role } from '../../schemas/user.schema';
import { DocumentsService } from '../../documents/documents.service';
import { DocumentChunkingService } from './document-chunking.service';
import { DocumentExtractionService } from './document-extraction.service';
import { EmbeddingService } from './embedding.service';
import {
  RAG_EMBEDDING_DIMENSIONS,
  RAG_VECTOR_INDEX_NAME,
} from '../rag.constants';

export type RagIndexResult = {
  status: RagIndexStatus;
  chunkCount: number;
  reused: boolean;
  error?: string;
};

export type VectorSearchOptions = {
  role: Role;
  machineIds?: Array<string | Types.ObjectId>;
  documentIds?: Array<string | Types.ObjectId>;
  documentTypes?: string[];
  limit?: number;
};

export type VectorSearchResult = {
  content: string;
  documentId: Types.ObjectId;
  documentName: string;
  documentType: string;
  machineId?: Types.ObjectId;
  machineTypeId?: Types.ObjectId;
  pageNumber?: number;
  section?: string;
  score: number;
};

@Injectable()
export class DocumentIngestionService {
  private readonly logger = new Logger(DocumentIngestionService.name);

  constructor(
    @InjectModel(DocumentEntity.name)
    private readonly documentModel: Model<DocumentDocument>,
    @InjectModel(KnowledgeChunk.name)
    private readonly chunkModel: Model<KnowledgeChunkDocument>,
    @InjectModel(Machine.name)
    private readonly machineModel: Model<MachineDocument>,
    private readonly documentsService: DocumentsService,
    private readonly extraction: DocumentExtractionService,
    private readonly chunking: DocumentChunkingService,
    private readonly embeddings: EmbeddingService,
  ) {}

  async indexDocument(
    documentId: string,
    options: { force?: boolean } = {},
  ): Promise<RagIndexResult> {
    if (!Types.ObjectId.isValid(documentId)) {
      throw new BadRequestException('Invalid document id');
    }

    const document = await this.documentModel.findById(documentId).exec();
    if (!document) throw new NotFoundException('Document not found');

    const sourceVersion = document.version ?? 1;
    if (
      !options.force &&
      (await this.hasCurrentIndex(document, sourceVersion))
    ) {
      return {
        status: RagIndexStatus.READY,
        chunkCount: document.rag_chunk_count ?? 0,
        reused: true,
      };
    }

    await this.documentModel
      .updateOne(
        { _id: document._id },
        {
          $set: { rag_status: RagIndexStatus.PROCESSING },
          $unset: { rag_error: 1 },
        },
      )
      .exec();

    try {
      const file = await this.documentsService.readProtectedFile(
        documentId,
        document,
      );
      const extracted = await this.extraction.extract(
        file.buffer,
        document.file_name,
      );
      const chunks = this.chunking.chunk(extracted.pages);
      if (!chunks.length) {
        throw new BadRequestException(
          'The document did not produce any useful text chunks',
        );
      }

      const vectors = await this.embeddings.embedBatch(
        chunks.map((chunk) => chunk.content),
      );
      this.assertVectors(vectors, chunks.length);

      const machine = await this.machineModel
        .findById(document.machine_id)
        .select({ type_id: 1 })
        .lean()
        .exec();
      const ingestionKey = randomUUID();
      const allowedRoles = this.allowedRolesFor(document);
      const language = this.languageFromTags(document.tags);
      const embeddingModel = this.embeddings.getModel();
      const records = chunks.map((chunk, index) => ({
        documentId: document._id,
        content: chunk.content,
        chunkIndex: index,
        embedding: vectors[index],
        documentName: document.file_name,
        documentType: document.type_document,
        pageNumber: chunk.pageNumber,
        section: chunk.section,
        language,
        machineId: document.machine_id,
        machineTypeId: machine?.type_id,
        originalFilename: document.file_name,
        allowedRoles,
        metadata: {
          documentStatus: document.status ?? DocumentStatus.DRAFT,
          maintenancePlanId: document.maintenance_plan_id?.toString(),
          workOrderId: document.work_order_id?.toString(),
          interventionReportId: document.intervention_report_id?.toString(),
          contentSha256: createHash('sha256')
            .update(chunk.content)
            .digest('hex'),
        },
        embeddingModel,
        embeddingDimensions: RAG_EMBEDDING_DIMENSIONS,
        sourceVersion,
        ingestionKey,
      }));

      await this.installIndexGeneration(
        document,
        records,
        ingestionKey,
        sourceVersion,
        embeddingModel,
      );

      this.logger.log(
        `Indexed document ${documentId} into ${records.length} RAG chunks`,
      );
      return {
        status: RagIndexStatus.READY,
        chunkCount: records.length,
        reused: false,
      };
    } catch (error) {
      const message = this.safeErrorMessage(error);
      await this.documentModel
        .updateOne(
          { _id: document._id },
          {
            $set: {
              rag_status: RagIndexStatus.FAILED,
              rag_error: message.slice(0, 500),
            },
          },
        )
        .exec();
      this.logger.error(
        `RAG indexing failed for document ${documentId}: ${message}`,
      );
      return {
        status: RagIndexStatus.FAILED,
        chunkCount: document.rag_chunk_count ?? 0,
        reused: false,
        error: message,
      };
    }
  }

  async removeDocument(documentId: Types.ObjectId): Promise<void> {
    await this.chunkModel.deleteMany({ documentId }).exec();
  }

  async search(
    query: string,
    options: VectorSearchOptions,
  ): Promise<VectorSearchResult[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      throw new BadRequestException('Search query is required');
    }

    const authorizedMachineIds = options.machineIds;
    if (options.role !== Role.ADMIN && authorizedMachineIds === undefined) {
      throw new ForbiddenException(
        'Authorized machine scope is required for knowledge search',
      );
    }
    if (options.role !== Role.ADMIN && authorizedMachineIds?.length === 0) {
      return [];
    }

    const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
    const vector = await this.embeddings.embedQuery(normalizedQuery);
    const filter = this.buildVectorFilter(options);
    const vectorStage: PipelineStage.VectorSearch['$vectorSearch'] = {
      index: RAG_VECTOR_INDEX_NAME,
      path: 'embedding',
      queryVector: vector,
      numCandidates: Math.max(limit * 20, 100),
      limit,
      filter,
    };

    try {
      return await this.chunkModel
        .aggregate<VectorSearchResult>([
          { $vectorSearch: vectorStage },
          {
            $project: {
              content: 1,
              documentId: 1,
              documentName: 1,
              documentType: 1,
              machineId: 1,
              machineTypeId: 1,
              pageNumber: 1,
              section: 1,
              score: { $meta: 'vectorSearchScore' },
            },
          },
        ])
        .exec();
    } catch (error) {
      this.logger.error(
        `RAG vector search unavailable: ${this.safeErrorMessage(error)}`,
      );
      throw new ServiceUnavailableException(
        `MongoDB Atlas Vector Search index "${RAG_VECTOR_INDEX_NAME}" is unavailable`,
      );
    }
  }

  private async hasCurrentIndex(
    document: DocumentDocument,
    sourceVersion: number,
  ): Promise<boolean> {
    if (
      document.rag_status !== RagIndexStatus.READY ||
      !document.rag_ingestion_key ||
      document.rag_source_version !== sourceVersion ||
      document.rag_embedding_model !== this.embeddings.getModel() ||
      !document.rag_chunk_count
    ) {
      return false;
    }

    const count = await this.chunkModel
      .countDocuments({
        documentId: document._id,
        ingestionKey: document.rag_ingestion_key,
      })
      .exec();
    return count === document.rag_chunk_count;
  }

  private async installIndexGeneration(
    document: DocumentDocument,
    records: Array<Record<string, unknown>>,
    ingestionKey: string,
    sourceVersion: number,
    embeddingModel: string,
  ): Promise<void> {
    const session = await this.documentModel.db.startSession();
    try {
      await session.withTransaction(async () => {
        await this.chunkModel.insertMany(records, { ordered: true, session });
        await this.chunkModel
          .deleteMany({
            documentId: document._id,
            ingestionKey: { $ne: ingestionKey },
          })
          .session(session)
          .exec();
        await this.documentModel
          .updateOne(
            { _id: document._id },
            {
              $set: {
                rag_status: RagIndexStatus.READY,
                rag_indexed_at: new Date(),
                rag_chunk_count: records.length,
                rag_ingestion_key: ingestionKey,
                rag_embedding_model: embeddingModel,
                rag_source_version: sourceVersion,
              },
              $unset: { rag_error: 1 },
            },
            { session },
          )
          .exec();
      });
    } finally {
      await session.endSession();
    }
  }

  private assertVectors(vectors: number[][], expectedCount: number): void {
    if (vectors.length !== expectedCount) {
      throw new Error('Gemini returned an unexpected embedding count');
    }
    if (
      vectors.some(
        (vector) =>
          vector.length !== RAG_EMBEDDING_DIMENSIONS ||
          vector.some((value) => !Number.isFinite(value)),
      )
    ) {
      throw new Error('Gemini returned an invalid embedding vector');
    }
  }

  private allowedRolesFor(document: DocumentDocument): Role[] {
    if (
      document.status === DocumentStatus.PUBLISHED &&
      !document.superseded_by_document_id
    ) {
      return [Role.ADMIN, Role.TECHNICIAN, Role.OPERATOR];
    }
    return [Role.ADMIN];
  }

  private languageFromTags(tags: string[] | undefined): string | undefined {
    const languageTag = tags?.find((tag) => /^lang:[a-z]{2}$/i.test(tag));
    return languageTag?.split(':')[1]?.toLowerCase();
  }

  private buildVectorFilter(
    options: VectorSearchOptions,
  ): FilterQuery<KnowledgeChunkDocument> {
    const filters: Array<Record<string, unknown>> = [
      { allowedRoles: options.role },
    ];
    const machineIds = this.objectIds(options.machineIds);
    const documentIds = this.objectIds(options.documentIds);
    if (machineIds.length) filters.push({ machineId: { $in: machineIds } });
    if (documentIds.length) {
      filters.push({ documentId: { $in: documentIds } });
    }
    if (options.documentTypes?.length) {
      filters.push({ documentType: { $in: options.documentTypes } });
    }
    return filters.length === 1 ? filters[0] : { $and: filters };
  }

  private objectIds(
    values: Array<string | Types.ObjectId> | undefined,
  ): Types.ObjectId[] {
    return (values ?? []).map((value) => {
      const id = value.toString();
      if (!Types.ObjectId.isValid(id)) {
        throw new BadRequestException('Invalid RAG search filter id');
      }
      return new Types.ObjectId(id);
    });
  }

  private safeErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return 'RAG indexing failed';
  }
}
