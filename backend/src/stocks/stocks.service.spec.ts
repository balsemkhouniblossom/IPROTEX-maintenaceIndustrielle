import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { StocksService } from './stocks.service';

function execResult<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
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

describe('StocksService', () => {
  const partId = new Types.ObjectId();
  const stockId = new Types.ObjectId();
  const actorId = new Types.ObjectId().toHexString();
  const stockRecord = {
    _id: stockId,
    stock_id: 'STK-001',
    part_id: partId,
    quantite_en_stock: 0,
    quantite_reservee: 0,
    version: 1,
  };

  let session: ReturnType<typeof createSession>;
  let stockModel: {
    db: { startSession: jest.Mock };
    create: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
    findById: jest.Mock;
    findByIdAndUpdate: jest.Mock;
    findByIdAndDelete: jest.Mock;
  };
  let catalogueModel: { findById: jest.Mock };
  let stockMovementModel: { exists: jest.Mock };
  let stockMovementsService: {
    recordCreation: jest.Mock;
    listForStock: jest.Mock;
    adjust: jest.Mock;
  };
  let service: StocksService;

  beforeEach(() => {
    session = createSession();
    stockModel = {
      db: { startSession: jest.fn().mockResolvedValue(session) },
      create: jest.fn().mockResolvedValue([stockRecord]),
      find: jest.fn().mockReturnValue(queryResult([stockRecord])),
      countDocuments: jest.fn().mockReturnValue(execResult(1)),
      findById: jest.fn().mockReturnValue(queryResult(stockRecord)),
      findByIdAndUpdate: jest.fn().mockReturnValue(execResult({ ...stockRecord, emplacement: 'A1' })),
      findByIdAndDelete: jest.fn().mockReturnValue(execResult(stockRecord)),
    };
    catalogueModel = {
      findById: jest.fn().mockReturnValue(execResult({ _id: partId })),
    };
    stockMovementModel = {
      exists: jest.fn().mockReturnValue(execResult(null)),
    };
    stockMovementsService = {
      recordCreation: jest.fn().mockResolvedValue(null),
      listForStock: jest.fn().mockResolvedValue({ items: [], totalItems: 0 }),
      adjust: jest.fn().mockResolvedValue({ ...stockRecord, quantite_en_stock: 5 }),
    };

    service = new StocksService(
      stockModel as never,
      catalogueModel as never,
      stockMovementModel as never,
      stockMovementsService as never,
    );
  });

  it('creates a stock record in a transaction and records the initial movement', async () => {
    const dto = {
      stock_id: 'STK-001',
      part_id: partId.toHexString(),
      quantite_en_stock: 10,
      seuil_alerte_stock: 3,
      quantite_minimale: 1,
      emplacement: 'A1',
    };

    await expect(service.create(dto as never, actorId)).resolves.toBe(stockRecord);

    expect(catalogueModel.findById).toHaveBeenCalledWith(partId.toHexString());
    expect(stockModel.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          stock_id: 'STK-001',
          part_id: partId,
          quantite_en_stock: 10,
          quantite_reservee: 0,
          version: 1,
        }),
      ],
      { session },
    );
    expect(stockMovementsService.recordCreation).toHaveBeenCalledWith(session, {
      stock: stockRecord,
      partId: partId.toString(),
      actorId,
    });
    expect(session.endSession).toHaveBeenCalled();
  });

  it('rejects stock creation when the catalogue part is missing', async () => {
    catalogueModel.findById.mockReturnValueOnce(execResult(null));

    await expect(
      service.create({ part_id: partId.toHexString() } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(stockModel.db.startSession).not.toHaveBeenCalled();
  });

  it('lists and reads stocks with populated catalogue parts', async () => {
    await expect(service.findAll(2, 10, 10)).resolves.toMatchObject({
      items: [stockRecord],
      page: 2,
      limit: 10,
      totalItems: 1,
      totalPages: 1,
    });
    const findQuery = stockModel.find.mock.results[0].value;
    expect(findQuery.populate).toHaveBeenCalledWith('part_id');

    await expect(service.findOne(stockId.toHexString())).resolves.toBe(stockRecord);
    const findByIdQuery = stockModel.findById.mock.results[0].value;
    expect(findByIdQuery.populate).toHaveBeenCalledWith('part_id');
  });

  it('delegates movement listing, updates, and adjustment transactions', async () => {
    await service.getMovements(stockId.toHexString(), 1, 20, 0);
    expect(stockMovementsService.listForStock).toHaveBeenCalledWith(stockId.toHexString(), 1, 20, 0);

    await expect(service.update(stockId.toHexString(), { emplacement: 'A1' } as never)).resolves.toMatchObject({
      emplacement: 'A1',
    });
    expect(stockModel.findByIdAndUpdate).toHaveBeenCalledWith(
      stockId.toHexString(),
      { emplacement: 'A1' },
      { new: true },
    );

    await expect(
      service.adjust(stockId.toHexString(), { delta: 5, reason: 'Stocktake', expected_version: 1 } as never, actorId),
    ).resolves.toMatchObject({ quantite_en_stock: 5 });
    expect(stockMovementsService.adjust).toHaveBeenCalledWith(session, {
      stockId: stockId.toHexString(),
      delta: 5,
      reason: 'Stocktake',
      actorId,
      expectedVersion: 1,
    });
    expect(session.endSession).toHaveBeenCalled();
  });

  it('deletes only empty stock records with no movement history', async () => {
    await expect(service.remove(stockId.toHexString())).resolves.toBe(stockRecord);
    expect(stockMovementModel.exists).toHaveBeenCalledWith({ stock_id: stockId });
    expect(stockModel.findByIdAndDelete).toHaveBeenCalledWith(stockId.toHexString());
  });

  it('rejects deleting missing, non-empty, reserved, or historized stock records', async () => {
    stockModel.findById.mockReturnValueOnce(execResult(null));
    await expect(service.remove('missing')).rejects.toBeInstanceOf(NotFoundException);

    stockModel.findById.mockReturnValueOnce(execResult({ ...stockRecord, quantite_en_stock: 1 }));
    await expect(service.remove(stockId.toHexString())).rejects.toBeInstanceOf(ConflictException);

    stockModel.findById.mockReturnValueOnce(execResult({ ...stockRecord, quantite_reservee: 1 }));
    await expect(service.remove(stockId.toHexString())).rejects.toBeInstanceOf(ConflictException);

    stockModel.findById.mockReturnValueOnce(execResult(stockRecord));
    stockMovementModel.exists.mockReturnValueOnce(execResult({ _id: new Types.ObjectId() }));
    await expect(service.remove(stockId.toHexString())).rejects.toBeInstanceOf(ConflictException);
    expect(stockModel.findByIdAndDelete).not.toHaveBeenCalled();
  });
});

