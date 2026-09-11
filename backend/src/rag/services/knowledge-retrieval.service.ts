import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DocumentAccessService } from '../../documents/document-access.service';
import { Machine, MachineDocument } from '../../schemas/machine.schema';
import { Role } from '../../schemas/user.schema';
import {
  DocumentIngestionService,
  VectorSearchResult,
} from './document-ingestion.service';

export type KnowledgeSource = {
  chunkId?: string;
  documentId: string;
  documentName: string;
  documentType: string;
  pageNumber?: number;
  section?: string;
  machineId?: string;
  machineTypeId?: string;
  score: number;
};

export type KnowledgeRetrievalResult = {
  chunks: VectorSearchResult[];
  sources: KnowledgeSource[];
  context: string;
  matched: number;
};

@Injectable()
export class KnowledgeRetrievalService {
  private readonly logger = new Logger(KnowledgeRetrievalService.name);

  constructor(
    private readonly ingestion: DocumentIngestionService,
    private readonly access: DocumentAccessService,
    @InjectModel(Machine.name)
    private readonly machineModel: Model<MachineDocument>,
    private readonly config: ConfigService,
  ) {}

  async retrieve(input: {
    question: string;
    userId: string;
    role: string;
    machineId?: string;
    documentTypes?: string[];
  }): Promise<KnowledgeRetrievalResult> {
    const startedAt = Date.now();
    const question = input.question.trim();
    if (!question) throw new BadRequestException('RAG question is required');
    const role = this.parseRole(input.role);
    const authorizedMachineIds = await this.access.listAccessibleMachineIds({
      userId: input.userId,
      role,
    });
    const topK = this.integerConfig('RAG_TOP_K', 5, 1, 20);
    const numCandidates = this.integerConfig(
      'RAG_NUM_CANDIDATES',
      100,
      topK,
      1000,
    );
    const minScore = this.numberConfig('RAG_MIN_SCORE', 0.55, 0, 1);

    let results: VectorSearchResult[];
    if (input.machineId) {
      await this.access.assertCanAccessMachine(
        { userId: input.userId, role },
        input.machineId,
      );
      const machine = await this.machineModel
        .findById(input.machineId)
        .select({ type_id: 1 })
        .lean()
        .exec();
      if (!machine) throw new BadRequestException('Invalid machine context');
      results = await this.ingestion.search(question, {
        role,
        machineIds: [input.machineId],
        documentTypes: input.documentTypes,
        limit: topK,
        numCandidates,
      });
      if (!results.some((item) => item.score >= minScore) && machine.type_id) {
        results = await this.ingestion.search(question, {
          role,
          machineIds: authorizedMachineIds ?? undefined,
          machineTypeIds: [machine.type_id],
          documentTypes: input.documentTypes,
          limit: topK,
          numCandidates,
        });
      }
    } else {
      results = await this.ingestion.search(question, {
        role,
        machineIds: authorizedMachineIds ?? undefined,
        documentTypes: input.documentTypes,
        limit: topK,
        numCandidates,
      });
    }

    const chunks = this.selectEvidence(results, minScore, topK);
    const sources = chunks.map((chunk) => this.toSource(chunk));
    this.logger.log(
      `RAG retrieval role=${role} matched=${chunks.length} documents=${[...new Set(sources.map((source) => source.documentId))].join(',')} latencyMs=${Date.now() - startedAt}`,
    );
    return {
      chunks,
      sources,
      matched: chunks.length,
      context: chunks
        .map((chunk, index) => this.formatChunk(chunk, index))
        .join('\n\n'),
    };
  }

  private selectEvidence(
    results: VectorSearchResult[],
    minScore: number,
    limit: number,
  ) {
    const seen = new Set<string>();
    return results
      .filter((result) => result.score >= minScore)
      .filter((result) => {
        const key = `${result.documentId.toString()}:${result.pageNumber ?? ''}:${result.section ?? ''}:${result.content}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);
  }

  private formatChunk(chunk: VectorSearchResult, index: number): string {
    return [
      `SOURCE ${index + 1}`,
      `Document: ${chunk.documentName}`,
      ...(chunk.pageNumber ? [`Page: ${chunk.pageNumber}`] : []),
      ...(chunk.section ? [`Section: ${chunk.section}`] : []),
      'Content:',
      chunk.content,
    ].join('\n');
  }

  private toSource(chunk: VectorSearchResult): KnowledgeSource {
    const record = chunk as VectorSearchResult & { _id?: unknown };
    return {
      chunkId: this.optionalId(record._id),
      documentId: chunk.documentId.toString(),
      documentName: chunk.documentName,
      documentType: chunk.documentType,
      pageNumber: chunk.pageNumber,
      section: chunk.section,
      machineId: chunk.machineId?.toString(),
      machineTypeId: chunk.machineTypeId?.toString(),
      score: chunk.score,
    };
  }

  private optionalId(value: unknown): string | undefined {
    if (typeof value === 'string') return value;
    if (value instanceof Types.ObjectId) return value.toHexString();
    return undefined;
  }

  private parseRole(role: string): Role {
    if (Object.values(Role).includes(role as Role)) return role as Role;
    throw new BadRequestException('Unsupported RAG role');
  }

  private integerConfig(
    name: string,
    fallback: number,
    min: number,
    max: number,
  ) {
    const value = Number(this.config.get<string>(name));
    return Number.isInteger(value) && value >= min && value <= max
      ? value
      : fallback;
  }

  private numberConfig(
    name: string,
    fallback: number,
    min: number,
    max: number,
  ) {
    const value = Number(this.config.get<string>(name));
    return Number.isFinite(value) && value >= min && value <= max
      ? value
      : fallback;
  }
}
