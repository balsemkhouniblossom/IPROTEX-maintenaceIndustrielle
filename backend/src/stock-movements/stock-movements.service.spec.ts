import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { StockMovementsService } from './stock-movements.service';
import { StockMovementType } from '../schemas/stock-movement.schema';
import { PartRequestStatus } from '../schemas/part-request.schema';

function execResult<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

function sessionChain<T>(value: T) {
  return { session: jest.fn().mockReturnValue(execResult(value)) };
}

const fakeSession = {} as never;

describe('StockMovementsService', () => {
  const stockId = new Types.ObjectId();
  const partId = new Types.ObjectId();
  const workOrderId = new Types.ObjectId();
  const partRequestId = new Types.ObjectId();
  const actorId = new Types.ObjectId().toHexString();

  function stockAfter(overrides: Record<string, unknown> = {}) {
    return {
      _id: stockId,
      part_id: partId,
      quantite_en_stock: 10,
      quantite_reservee: 2,
      version: 4,
      ...overrides,
    };
  }

  let stockModel: { findOneAndUpdate: jest.Mock; findById: jest.Mock };
  let stockMovementModel: {
    create: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
  };
  let partRequestModel: { findOne: jest.Mock; findOneAndUpdate: jest.Mock };
  let counterService: { getNextSequence: jest.Mock };
  let service: StockMovementsService;

  beforeEach(() => {
    stockModel = {
      findOneAndUpdate: jest.fn().mockReturnValue(execResult(stockAfter())),
      findById: jest.fn().mockReturnValue(sessionChain(stockAfter())),
    };
    stockMovementModel = {
      create: jest
        .fn()
        .mockResolvedValue([
          { _id: new Types.ObjectId(), movement_id: 'MOV-000001' },
        ]),
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
      countDocuments: jest.fn().mockReturnValue(execResult(0)),
    };
    partRequestModel = {
      findOne: jest.fn().mockReturnValue(sessionChain(null)),
      findOneAndUpdate: jest.fn().mockReturnValue(execResult(null)),
    };
    counterService = { getNextSequence: jest.fn().mockResolvedValue(1) };

    service = new StockMovementsService(
      stockModel as never,
      stockMovementModel as never,
      partRequestModel as never,
      counterService as never,
    );
  });

  describe('reserve', () => {
    it('atomically holds the requested quantity and records a RESERVATION movement', async () => {
      const movement = await service.reserve(fakeSession, {
        stockId: stockId.toHexString(),
        partId: partId.toHexString(),
        quantity: 3,
        workOrderId: workOrderId.toHexString(),
        partRequestId: partRequestId.toHexString(),
        actorId,
      });

      expect(stockModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: stockId,
          $expr: {
            $gte: [
              { $subtract: ['$quantite_en_stock', '$quantite_reservee'] },
              3,
            ],
          },
        }),
        { $inc: { version: 1, quantite_reservee: 3 } },
        { new: true, session: fakeSession },
      );
      expect(stockMovementModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            type: StockMovementType.RESERVATION,
            stock_id: stockId,
            part_id: partId,
            quantity_delta: 0,
            reserved_delta: 3,
            work_order_id: workOrderId,
            part_request_id: partRequestId,
          }),
        ],
        { session: fakeSession },
      );
      expect(movement.movement_id).toBe('MOV-000001');
    });

    it('throws a conflict when the reservation would exceed available stock', async () => {
      stockModel.findOneAndUpdate.mockReturnValue(execResult(null));

      await expect(
        service.reserve(fakeSession, {
          stockId: stockId.toHexString(),
          partId: partId.toHexString(),
          quantity: 999,
          workOrderId: workOrderId.toHexString(),
          partRequestId: partRequestId.toHexString(),
        }),
      ).rejects.toThrow(ConflictException);
      expect(stockMovementModel.create).not.toHaveBeenCalled();
    });
  });

  describe('cancelReservation', () => {
    it('releases the hold and records a CANCELLATION movement', async () => {
      await service.cancelReservation(fakeSession, {
        stockId: stockId.toHexString(),
        partId: partId.toHexString(),
        quantity: 2,
        workOrderId: workOrderId.toHexString(),
        partRequestId: partRequestId.toHexString(),
        actorId,
        reason: 'Operator cancelled',
      });

      expect(stockModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: stockId,
          quantite_reservee: { $gte: 2 },
        }),
        { $inc: { version: 1, quantite_reservee: -2 } },
        { new: true, session: fakeSession },
      );
      expect(stockMovementModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            type: StockMovementType.CANCELLATION,
            reserved_delta: -2,
            reason: 'Operator cancelled',
          }),
        ],
        { session: fakeSession },
      );
    });

    it('throws a conflict when there is not enough reserved quantity to release', async () => {
      stockModel.findOneAndUpdate.mockReturnValue(execResult(null));

      await expect(
        service.cancelReservation(fakeSession, {
          stockId: stockId.toHexString(),
          partId: partId.toHexString(),
          quantity: 50,
          workOrderId: workOrderId.toHexString(),
          partRequestId: partRequestId.toHexString(),
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('recordUsageChange', () => {
    it('rejects a zero delta', async () => {
      await expect(
        service.recordUsageChange(fakeSession, {
          stockId: stockId.toHexString(),
          partId: partId.toHexString(),
          delta: 0,
          workOrderId: workOrderId.toHexString(),
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('treats a negative delta as an unconditional Return, increasing stock with no guard', async () => {
      await service.recordUsageChange(fakeSession, {
        stockId: stockId.toHexString(),
        partId: partId.toHexString(),
        delta: -4,
        workOrderId: workOrderId.toHexString(),
        actorId,
      });

      expect(stockModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: stockId },
        { $inc: { version: 1, quantite_en_stock: 4 } },
        { new: true, session: fakeSession },
      );
      expect(stockMovementModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            type: StockMovementType.RETURN,
            quantity_delta: 4,
            reserved_delta: 0,
          }),
        ],
        { session: fakeSession },
      );
      // A pure return never has to consult PartRequest at all.
      expect(partRequestModel.findOne).not.toHaveBeenCalled();
    });

    it('consumes straight from the available pool when no Reserved request exists for this work order/part', async () => {
      partRequestModel.findOne.mockReturnValue(sessionChain(null));

      await service.recordUsageChange(fakeSession, {
        stockId: stockId.toHexString(),
        partId: partId.toHexString(),
        delta: 5,
        workOrderId: workOrderId.toHexString(),
        actorId,
      });

      expect(stockModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: stockId,
          $expr: {
            $gte: [
              { $subtract: ['$quantite_en_stock', '$quantite_reservee'] },
              5,
            ],
          },
        }),
        { $inc: { version: 1, quantite_en_stock: -5 } },
        { new: true, session: fakeSession },
      );
      expect(partRequestModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(stockMovementModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            type: StockMovementType.CONSUMPTION,
            quantity_delta: -5,
            reserved_delta: 0,
            part_request_id: undefined,
          }),
        ],
        { session: fakeSession },
      );
    });

    it('draws down a matching Reserved request first, only pulling the overflow from the general pool', async () => {
      partRequestModel.findOne.mockReturnValue(
        sessionChain({
          _id: partRequestId,
          quantity: 3,
          status: PartRequestStatus.RESERVED,
        }),
      );

      await service.recordUsageChange(fakeSession, {
        stockId: stockId.toHexString(),
        partId: partId.toHexString(),
        delta: 5,
        workOrderId: workOrderId.toHexString(),
        actorId,
      });

      // covered = min(3, 5) = 3 -> drains reservation and stock together
      expect(stockModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: stockId,
          quantite_en_stock: { $gte: 3 },
          quantite_reservee: { $gte: 3 },
        }),
        { $inc: { version: 1, quantite_en_stock: -3, quantite_reservee: -3 } },
        { new: true, session: fakeSession },
      );
      // extra = 5 - 3 = 2 -> only this portion needs the availability guard
      expect(stockModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: stockId,
          $expr: {
            $gte: [
              { $subtract: ['$quantite_en_stock', '$quantite_reservee'] },
              2,
            ],
          },
        }),
        { $inc: { version: 1, quantite_en_stock: -2 } },
        { new: true, session: fakeSession },
      );
      // covered (3) >= reservation.quantity (3) -> the request is now fully consumed
      expect(partRequestModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: partRequestId, status: PartRequestStatus.RESERVED },
        { $set: { status: PartRequestStatus.FULFILLED } },
        { session: fakeSession },
      );
      expect(stockMovementModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            type: StockMovementType.CONSUMPTION,
            quantity_delta: -5,
            reserved_delta: -3,
            part_request_id: partRequestId,
          }),
        ],
        { session: fakeSession },
      );
    });

    it('leaves a Reserved request open when only part of its held quantity has been consumed', async () => {
      partRequestModel.findOne.mockReturnValue(
        sessionChain({
          _id: partRequestId,
          quantity: 5,
          status: PartRequestStatus.RESERVED,
        }),
      );

      await service.recordUsageChange(fakeSession, {
        stockId: stockId.toHexString(),
        partId: partId.toHexString(),
        delta: 2,
        workOrderId: workOrderId.toHexString(),
      });

      // covered = min(5, 2) = 2, extra = 0 -> only the reservation-backed call happens
      expect(stockModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(stockModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          quantite_en_stock: { $gte: 2 },
          quantite_reservee: { $gte: 2 },
        }),
        { $inc: { version: 1, quantite_en_stock: -2, quantite_reservee: -2 } },
        { new: true, session: fakeSession },
      );
      // covered (2) < reservation.quantity (5) -> not fully consumed yet
      expect(partRequestModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('throws a conflict when consumption would exceed what is actually available', async () => {
      stockModel.findOneAndUpdate.mockReturnValue(execResult(null));

      await expect(
        service.recordUsageChange(fakeSession, {
          stockId: stockId.toHexString(),
          partId: partId.toHexString(),
          delta: 500,
          workOrderId: workOrderId.toHexString(),
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('adjust', () => {
    it('rejects a zero delta', async () => {
      await expect(
        service.adjust(fakeSession, {
          stockId: stockId.toHexString(),
          delta: 0,
          reason: 'Stocktake',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when the stock record does not exist', async () => {
      stockModel.findById.mockReturnValue(sessionChain(null));

      await expect(
        service.adjust(fakeSession, {
          stockId: stockId.toHexString(),
          delta: 5,
          reason: 'Stocktake',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('requires expected_version once the record has a version, rejecting when omitted', async () => {
      await expect(
        service.adjust(fakeSession, {
          stockId: stockId.toHexString(),
          delta: 5,
          reason: 'Stocktake',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a stale expected_version', async () => {
      await expect(
        service.adjust(fakeSession, {
          stockId: stockId.toHexString(),
          delta: 5,
          reason: 'Stocktake',
          expectedVersion: 1,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('applies a positive adjustment and records an ADJUSTMENT movement, with no availability guard needed', async () => {
      await service.adjust(fakeSession, {
        stockId: stockId.toHexString(),
        delta: 5,
        reason: 'Found extra stock',
        actorId,
        expectedVersion: 4,
      });

      expect(stockModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: stockId },
        { $inc: { version: 1, quantite_en_stock: 5 } },
        { new: true, session: fakeSession },
      );
      expect(stockMovementModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            type: StockMovementType.ADJUSTMENT,
            quantity_delta: 5,
            reason: 'Found extra stock',
          }),
        ],
        { session: fakeSession },
      );
    });

    it('guards a negative adjustment against the currently available quantity', async () => {
      await service.adjust(fakeSession, {
        stockId: stockId.toHexString(),
        delta: -3,
        reason: 'Damaged goods',
        expectedVersion: 4,
      });

      expect(stockModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: stockId,
          $expr: {
            $gte: [
              { $subtract: ['$quantite_en_stock', '$quantite_reservee'] },
              3,
            ],
          },
        }),
        { $inc: { version: 1, quantite_en_stock: -3 } },
        { new: true, session: fakeSession },
      );
    });

    it('allows adjusting a legacy record with no version at all, without requiring expected_version', async () => {
      stockModel.findById.mockReturnValue(
        sessionChain(stockAfter({ version: undefined })),
      );

      await service.adjust(fakeSession, {
        stockId: stockId.toHexString(),
        delta: 2,
        reason: 'Legacy stocktake',
      });

      expect(stockModel.findOneAndUpdate).toHaveBeenCalled();
    });
  });

  describe('recordCreation', () => {
    it('writes nothing and returns null when the new stock record starts at zero', async () => {
      const result = await service.recordCreation(fakeSession, {
        stock: stockAfter({ quantite_en_stock: 0 }) as never,
        partId: partId.toHexString(),
      });

      expect(result).toBeNull();
      expect(stockMovementModel.create).not.toHaveBeenCalled();
    });

    it('records the starting quantity as an ADJUSTMENT movement', async () => {
      const stock = stockAfter({ quantite_en_stock: 20 });

      await service.recordCreation(fakeSession, {
        stock: stock as never,
        partId: partId.toHexString(),
        actorId,
      });

      expect(stockMovementModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            type: StockMovementType.ADJUSTMENT,
            quantity_delta: 20,
            reason: 'Initial stock on record creation',
          }),
        ],
        { session: fakeSession },
      );
    });
  });

  describe('listForStock', () => {
    it('paginates the movement ledger for a stock record, newest first', async () => {
      await service.listForStock(stockId.toHexString(), 2, 10, 10);

      expect(stockMovementModel.find).toHaveBeenCalledWith({
        stock_id: stockId,
      });
      const findChain = stockMovementModel.find.mock.results[0].value;
      expect(findChain.sort).toHaveBeenCalledWith({ createdAt: -1 });
      expect(findChain.skip).toHaveBeenCalledWith(10);
      expect(findChain.limit).toHaveBeenCalledWith(10);
    });
  });
});
