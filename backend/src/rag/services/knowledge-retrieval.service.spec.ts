import { Types } from 'mongoose';
import { Role } from '../../schemas/user.schema';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';

const result = (overrides: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(),
  content: 'Inspect bearing vibration according to SOP.',
  documentId: new Types.ObjectId(),
  documentName: 'Bearing SOP.pdf',
  documentType: 'SOP',
  machineId: new Types.ObjectId(),
  machineTypeId: new Types.ObjectId(),
  pageNumber: 4,
  section: 'Inspection',
  score: 0.9,
  ...overrides,
});

describe('KnowledgeRetrievalService', () => {
  const machineId = new Types.ObjectId();
  const typeId = new Types.ObjectId();
  let ingestion: { search: jest.Mock };
  let access: {
    listAccessibleMachineIds: jest.Mock;
    assertCanAccessMachine: jest.Mock;
  };
  let machineModel: Record<string, jest.Mock>;
  let config: { get: jest.Mock };

  function service() {
    return new KnowledgeRetrievalService(
      ingestion as never,
      access as never,
      machineModel as never,
      config as never,
    );
  }

  beforeEach(() => {
    ingestion = { search: jest.fn().mockResolvedValue([result()]) };
    access = {
      listAccessibleMachineIds: jest.fn().mockResolvedValue([machineId]),
      assertCanAccessMachine: jest.fn().mockResolvedValue(undefined),
    };
    machineModel = {
      findById: jest.fn(() => ({
        select: jest.fn(() => ({
          lean: jest.fn(() => ({
            exec: jest.fn().mockResolvedValue({ type_id: typeId }),
          })),
        })),
      })),
    };
    config = { get: jest.fn().mockReturnValue(undefined) };
  });

  it('retrieves exact-machine evidence with authorized role scope and source metadata', async () => {
    const output = await service().retrieve({
      question: 'What maintenance is required for bearing vibration?',
      userId: new Types.ObjectId().toString(),
      role: Role.OPERATOR,
      machineId: machineId.toString(),
    });

    expect(access.assertCanAccessMachine).toHaveBeenCalled();
    expect(ingestion.search).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        role: Role.OPERATOR,
        machineIds: [machineId.toString()],
      }),
    );
    expect(output.matched).toBe(1);
    expect(output.sources[0]).toMatchObject({
      documentName: 'Bearing SOP.pdf',
      pageNumber: 4,
      section: 'Inspection',
    });
    expect(output.context).toContain('SOURCE 1');
    expect(output).not.toHaveProperty('embedding');
  });

  it('falls back to the same machine type only when exact-machine evidence is weak', async () => {
    ingestion.search
      .mockResolvedValueOnce([result({ score: 0.2 })])
      .mockResolvedValueOnce([result({ score: 0.8 })]);

    await service().retrieve({
      question: 'FF37 bearing check',
      userId: new Types.ObjectId().toString(),
      role: Role.TECHNICIAN,
      machineId: machineId.toString(),
    });

    expect(ingestion.search).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        machineIds: [machineId],
        machineTypeIds: [typeId],
      }),
    );
  });

  it('applies the score threshold and removes duplicate evidence', async () => {
    const duplicate = result();
    ingestion.search.mockResolvedValue([
      duplicate,
      { ...duplicate, _id: new Types.ObjectId() },
      result({ score: 0.3 }),
    ]);

    await expect(
      service().retrieve({
        question: 'bearing vibration',
        userId: new Types.ObjectId().toString(),
        role: Role.ADMIN,
      }),
    ).resolves.toMatchObject({ matched: 1 });
  });

  it('propagates Atlas failures as controlled retrieval failures', async () => {
    ingestion.search.mockRejectedValue(new Error('Atlas unavailable'));
    await expect(
      service().retrieve({
        question: 'bearing vibration',
        userId: new Types.ObjectId().toString(),
        role: Role.ADMIN,
      }),
    ).rejects.toThrow('Atlas unavailable');
  });
});
