import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { OtPiecesService } from './ot-pieces.service';

function execResult<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

function sessionResult<T>(value: T) {
  return {
    session: jest.fn().mockReturnValue(execResult(value)),
  };
}

function queryResult<T>(value: T) {
  return {
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function createSession() {
  return {
    withTransaction: jest.fn(async (callback: () => Promise<unknown>) => callback()),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
}

describe('OtPiecesService', () => {
  const otId = new Types.ObjectId();
  const partId = new Types.ObjectId();
  const nextPartId = new Types.ObjectId();
  const stockId = new Types.ObjectId();
  const actorId = new Types.ObjectId().toHexString();

  let session: ReturnType<typeof createSession>;
  let existing: {
    _id: string;
    ot_id: Types.ObjectId;
    part_id: Types.ObjectId;
    quantite: number;
    save: jest.Mock;
  };
  let otPiecesModel: {
    db: { startSession: jest.Mock };
    create: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
    findById: jest.Mock;
    findByIdAndDelete: jest.Mock;
  };
  let stockModel: { findOne: jest.Mock };
  let stockMovementsService: { recordUsageChange: jest.Mock };
  let service: OtPiecesService;

  beforeEach(() => {
    session = createSession();
    existing = {
      _id: 'ot-piece-id',
      ot_id: otId,
      part_id: partId,
      quantite: 3,
      save: jest.fn().mockResolvedValue({ _id: 'ot-piece-id', quantite: 5 }),
    };
    otPiecesModel = {
      db: { startSession: jest.fn().mockResolvedValue(session) },
      create: jest.fn().mockResolvedValue([{ _id: 'created-ot-piece' }]),
      find: jest.fn().mockReturnValue(queryResult([{ _id: 'ot-piece-id' }])),
      countDocuments: jest.fn().mockReturnValue(execResult(2)),
      findById: jest.fn().mockReturnValue(sessionResult(existing)),
      findByIdAndDelete: jest.fn().mockReturnValue(sessionResult({ _id: 'deleted-ot-piece' })),
    };
    stockModel = {
      findOne: jest.fn().mockReturnValue(sessionResult({ _id: stockId })),
    };
    stockMovementsService = {
      recordUsageChange: jest.fn().mockResolvedValue({ _id: 'movement-id' }),
    };

    service = new OtPiecesService(
      otPiecesModel as never,
      stockModel as never,
      stockMovementsService as never,
    );
  });

  it('creates a consumption line in a transaction and records stock usage when quantity is positive', async () => {
    await expect(
      service.create(
        {
          ot_id: otId.toHexString(),
          part_id: partId.toHexString(),
          quantite: 4,
        } as never,
        actorId,
      ),
    ).resolves.toMatchObject({ _id: 'created-ot-piece' });

    expect(stockModel.findOne).toHaveBeenCalledWith({ part_id: partId });
    expect(stockMovementsService.recordUsageChange).toHaveBeenCalledWith(session, {
      stockId: stockId.toString(),
      partId: partId.toHexString(),
      delta: 4,
      workOrderId: otId.toHexString(),
      actorId,
    });
    expect(otPiecesModel.create).toHaveBeenCalledWith(
      [
        {
          ot_id: otId,
          part_id: partId,
          quantite: 4,
        },
      ],
      { session },
    );
    expect(session.endSession).toHaveBeenCalled();
  });

  it('creates zero-quantity lines without touching stock', async () => {
    await service.create({ ot_id: otId.toHexString(), part_id: partId.toHexString(), quantite: 0 } as never);

    expect(stockModel.findOne).not.toHaveBeenCalled();
    expect(stockMovementsService.recordUsageChange).not.toHaveBeenCalled();
    expect(otPiecesModel.create).toHaveBeenCalled();
  });

  it('paginates and populates work-order part lines', async () => {
    await expect(service.findAll(2, 10, 10)).resolves.toMatchObject({
      items: [{ _id: 'ot-piece-id' }],
      totalItems: 2,
      totalPages: 1,
    });
    const findQuery = otPiecesModel.find.mock.results[0].value;
    expect(findQuery.populate).toHaveBeenCalledWith('ot_id');
    expect(findQuery.populate).toHaveBeenCalledWith('part_id');

    otPiecesModel.findById.mockReturnValueOnce(queryResult(existing));
    await expect(service.findOne('ot-piece-id')).resolves.toBe(existing);
    const findByIdQuery = otPiecesModel.findById.mock.results[0].value;
    expect(findByIdQuery.populate).toHaveBeenCalledWith('ot_id');
    expect(findByIdQuery.populate).toHaveBeenCalledWith('part_id');
  });

  it('updates quantity by applying only the delta for the same part', async () => {
    await expect(service.update('ot-piece-id', { quantite: 5 } as never, actorId)).resolves.toMatchObject({
      quantite: 5,
    });

    expect(stockMovementsService.recordUsageChange).toHaveBeenCalledWith(session, {
      stockId: stockId.toString(),
      partId: partId.toString(),
      delta: 2,
      workOrderId: otId.toString(),
      actorId,
    });
    expect(existing.part_id).toBe(partId);
    expect(existing.quantite).toBe(5);
    expect(existing.save).toHaveBeenCalledWith({ session });
  });

  it('reverses the old part and applies the new part when reassigned', async () => {
    await service.update('ot-piece-id', { part_id: nextPartId.toHexString(), quantite: 2 } as never, actorId);

    expect(stockMovementsService.recordUsageChange).toHaveBeenNthCalledWith(1, session, {
      stockId: stockId.toString(),
      partId: partId.toString(),
      delta: -3,
      workOrderId: otId.toString(),
      actorId,
    });
    expect(stockMovementsService.recordUsageChange).toHaveBeenNthCalledWith(2, session, {
      stockId: stockId.toString(),
      partId: nextPartId.toString(),
      delta: 2,
      workOrderId: otId.toString(),
      actorId,
    });
    expect(existing.part_id.equals(nextPartId)).toBe(true);
    expect(existing.quantite).toBe(2);
  });

  it('returns null for missing update or remove targets', async () => {
    otPiecesModel.findById.mockReturnValueOnce(sessionResult(null));
    await expect(service.update('missing', { quantite: 1 } as never)).resolves.toBeNull();

    otPiecesModel.findById.mockReturnValueOnce(sessionResult(null));
    await expect(service.remove('missing')).resolves.toBeNull();
  });

  it('removes a line by reversing its stock usage before deletion', async () => {
    await expect(service.remove('ot-piece-id', actorId)).resolves.toMatchObject({ _id: 'deleted-ot-piece' });

    expect(stockMovementsService.recordUsageChange).toHaveBeenCalledWith(session, {
      stockId: stockId.toString(),
      partId: partId.toString(),
      delta: -3,
      workOrderId: otId.toString(),
      actorId,
    });
    expect(otPiecesModel.findByIdAndDelete).toHaveBeenCalledWith('ot-piece-id');
  });

  it('throws when a consumed part has no stock record', async () => {
    stockModel.findOne.mockReturnValueOnce(sessionResult(null));

    await expect(
      service.create({ ot_id: otId.toHexString(), part_id: partId.toHexString(), quantite: 1 } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(session.endSession).toHaveBeenCalled();
  });
});
