import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { DocumentStatus, RagIndexStatus } from '../../schemas/document.schema';
import { Role } from '../../schemas/user.schema';
import { DocumentIngestionService } from './document-ingestion.service';
import { RAG_EMBEDDING_DIMENSIONS } from '../rag.constants';

const executable = <T>(value: T) => ({
  exec: jest.fn().mockResolvedValue(value),
});

describe('DocumentIngestionService', () => {
  const documentId = new Types.ObjectId();
  const machineId = new Types.ObjectId();
  const machineTypeId = new Types.ObjectId();

  function createService(overrides: Record<string, unknown> = {}) {
    const session = {
      withTransaction: jest.fn(async (operation: () => Promise<void>) =>
        operation(),
      ),
      endSession: jest.fn(),
    };
    const documentModel = {
      findById: jest.fn(() => executable(overrides.document ?? null)),
      updateOne: jest.fn(() => executable({ acknowledged: true })),
      db: { startSession: jest.fn().mockResolvedValue(session) },
    };
    const chunkModel = {
      countDocuments: jest.fn(() => executable(overrides.chunkCount ?? 0)),
      insertMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(() => ({
        session: jest.fn(() => executable({ deletedCount: 1 })),
        exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      })),
      aggregate: jest.fn(() => executable(overrides.searchResults ?? [])),
    };
    const machineModel = {
      findById: jest.fn(() => ({
        select: jest.fn(() => ({
          lean: jest.fn(() => executable({ type_id: machineTypeId })),
        })),
      })),
    };
    const documents = {
      readProtectedFile: jest.fn().mockResolvedValue({
        buffer: Buffer.from('bearing vibration'),
      }),
    };
    const extraction = {
      extract: jest.fn().mockResolvedValue({
        pages: [
          { text: 'Bearing vibration maintenance instructions', pageNumber: 2 },
        ],
      }),
    };
    const chunking = {
      chunk: jest.fn().mockReturnValue([
        {
          content: 'Bearing vibration maintenance instructions',
          chunkIndex: 0,
          pageNumber: 2,
          section: 'Bearing',
        },
      ]),
    };
    const embeddings = {
      embedBatch: jest
        .fn()
        .mockResolvedValue([Array(RAG_EMBEDDING_DIMENSIONS).fill(0.1)]),
      embedQuery: jest
        .fn()
        .mockResolvedValue(Array(RAG_EMBEDDING_DIMENSIONS).fill(0.2)),
      getModel: jest.fn().mockReturnValue('gemini-embedding-001'),
    };
    const service = new DocumentIngestionService(
      documentModel as never,
      chunkModel as never,
      machineModel as never,
      documents as never,
      extraction as never,
      chunking,
      embeddings as never,
    );
    return { service, documentModel, chunkModel, embeddings };
  }

  it('indexes metadata and atomically replaces the previous generation', async () => {
    const document = {
      _id: documentId,
      machine_id: machineId,
      file_name: 'bearing-manual.pdf',
      type_document: 'manual',
      status: DocumentStatus.PUBLISHED,
      version: 3,
      tags: ['lang:en'],
    };
    const { service, chunkModel, documentModel } = createService({ document });

    await expect(
      service.indexDocument(documentId.toHexString()),
    ).resolves.toMatchObject({
      status: RagIndexStatus.READY,
      chunkCount: 1,
      reused: false,
    });
    expect(chunkModel.insertMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          documentId,
          machineId,
          machineTypeId,
          sourceVersion: 3,
          allowedRoles: [Role.ADMIN, Role.TECHNICIAN, Role.OPERATOR],
          language: 'en',
          embeddingDimensions: RAG_EMBEDDING_DIMENSIONS,
        }),
      ],
      expect.objectContaining({ ordered: true }),
    );
    expect(documentModel.updateOne).toHaveBeenLastCalledWith(
      { _id: documentId },
      expect.objectContaining({
        $set: expect.objectContaining({ rag_status: RagIndexStatus.READY }),
      }),
      expect.objectContaining({ session: expect.anything() }),
    );
  });

  it('reuses a complete matching generation and avoids duplicate chunks', async () => {
    const document = {
      _id: documentId,
      rag_status: RagIndexStatus.READY,
      rag_ingestion_key: 'generation-1',
      rag_embedding_model: 'gemini-embedding-001',
      rag_source_version: 1,
      rag_chunk_count: 2,
      version: 1,
    };
    const { service, chunkModel } = createService({ document, chunkCount: 2 });

    await expect(
      service.indexDocument(documentId.toHexString()),
    ).resolves.toEqual({
      status: RagIndexStatus.READY,
      chunkCount: 2,
      reused: true,
    });
    expect(chunkModel.insertMany).not.toHaveBeenCalled();
  });

  it('requires machine authorization and never returns raw embeddings', async () => {
    const result = {
      content: 'Inspect the bearing',
      documentId,
      documentName: 'manual.pdf',
      documentType: 'manual',
      score: 0.9,
    };
    const { service, chunkModel } = createService({ searchResults: [result] });

    await expect(
      service.search('What maintenance is required for bearing vibration?', {
        role: Role.OPERATOR,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.search('What maintenance is required for bearing vibration?', {
        role: Role.OPERATOR,
        machineIds: [machineId],
      }),
    ).resolves.toEqual([result]);
    const pipeline = (chunkModel.aggregate as jest.Mock).mock.calls[0][0] as [
      { $vectorSearch: { filter: unknown } },
      { $project: Record<string, unknown> },
    ];
    expect(pipeline[0].$vectorSearch.filter).toEqual({
      $and: [
        { allowedRoles: Role.OPERATOR },
        { machineId: { $in: [machineId] } },
      ],
    });
    expect(pipeline[1].$project.embedding).toBeUndefined();
  });

  it('reports an unavailable Atlas vector index clearly', async () => {
    const { service, chunkModel } = createService();
    chunkModel.aggregate.mockReturnValueOnce({
      exec: jest.fn().mockRejectedValue(new Error('index not found')),
    });

    await expect(
      service.search('bearing vibration', { role: Role.ADMIN }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('removes all chunks when the source document is deleted', async () => {
    const { service, chunkModel } = createService();
    await service.removeDocument(documentId);
    expect(chunkModel.deleteMany).toHaveBeenCalledWith({ documentId });
  });
});
