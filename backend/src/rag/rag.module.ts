import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { DocumentsModule } from '../documents/documents.module';
import { DocumentEntity, DocumentSchema } from '../schemas/document.schema';
import {
  KnowledgeChunk,
  KnowledgeChunkSchema,
} from '../schemas/knowledge-chunk.schema';
import { Machine, MachineSchema } from '../schemas/machine.schema';
import { DocumentIngestionService } from './services/document-ingestion.service';
import { DocumentExtractionService } from './services/document-extraction.service';
import { DocumentChunkingService } from './services/document-chunking.service';
import { EmbeddingService } from './services/embedding.service';
import { KnowledgeRetrievalService } from './services/knowledge-retrieval.service';
import { RagController } from './rag.controller';

@Module({
  imports: [
    ConfigModule,
    forwardRef(() => DocumentsModule),
    MongooseModule.forFeature([
      { name: DocumentEntity.name, schema: DocumentSchema },
      { name: KnowledgeChunk.name, schema: KnowledgeChunkSchema },
      { name: Machine.name, schema: MachineSchema },
    ]),
  ],
  controllers: [RagController],
  providers: [
    DocumentIngestionService,
    KnowledgeRetrievalService,
    DocumentExtractionService,
    DocumentChunkingService,
    EmbeddingService,
  ],
  exports: [
    DocumentIngestionService,
    EmbeddingService,
    KnowledgeRetrievalService,
  ],
})
export class RagModule {}
