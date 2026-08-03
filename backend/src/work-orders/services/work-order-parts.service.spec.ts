import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { WorkOrderPartsService } from './work-order-parts.service';

function execResult<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

function createSessionMock() {
  return {
    withTransaction: jest.fn(async (fn: () => Promise<unknown>) => fn()),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
}

describe('WorkOrderPartsService.requestPartsForOperator', () => {
  const operatorId = new Types.ObjectId().toHexString();
  const otherOperatorId = new Types.ObjectId().toHexString();
  const workOrderId = new Types.ObjectId();
  const partId = new Types.ObjectId().toHexString();

  function correctiveOrder(overrides: Record<string, unknown> = {}) {
    return {
      _id: workOrderId,
      type_maintenance: 'corrective',
      technician_id: new Types.ObjectId(operatorId),
      status: 'waiting_validation',
      ...overrides,
    };
  }

  let workOrderModel: { findById: jest.Mock };
  let catalogueModel: { findById: jest.Mock };
  let partRequestModel: { findOne: jest.Mock; create: jest.Mock };
  let stockModel: {
    findOneAndUpdate: jest.Mock;
    updateOne: jest.Mock;
    find: jest.Mock;
    findById: jest.Mock;
  };
  let counterService: { getNextSequence: jest.Mock };
  let stockMovementsService: {
    reserve: jest.Mock;
    cancelReservation: jest.Mock;
  };
  let notificationService: {
    notifyPartRequestCreated: jest.Mock;
    notifyPartRequestDecision: jest.Mock;
  };
  let service: WorkOrderPartsService;

  beforeEach(() => {
    workOrderModel = {
      findById: jest.fn().mockReturnValue(execResult(correctiveOrder())),
    };
    catalogueModel = {
      findById: jest.fn().mockReturnValue(execResult({ _id: partId })),
    };
    partRequestModel = {
      findOne: jest.fn().mockReturnValue(execResult(null)),
      create: jest
        .fn()
        .mockResolvedValue([{ _id: new Types.ObjectId(), status: 'pending' }]),
    };
    stockModel = {
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn(),
      find: jest.fn(),
      findById: jest.fn(),
    };
    counterService = {
      getNextSequence: jest.fn().mockResolvedValue(1),
    };
    stockMovementsService = {
      reserve: jest.fn().mockResolvedValue({}),
      cancelReservation: jest.fn().mockResolvedValue({}),
    };
    notificationService = {
      notifyPartRequestCreated: jest.fn().mockResolvedValue(null),
      notifyPartRequestDecision: jest.fn().mockResolvedValue(null),
    };

    service = new WorkOrderPartsService(
      workOrderModel as never,
      catalogueModel as never,
      partRequestModel as never,
      stockModel as never,
      counterService as never,
      stockMovementsService as never,
      notificationService as never,
    );
  });

  it('stores a pending request for the assigned corrective work order, deriving identity from the input only, and never touches Stock', async () => {
    const result = await service.requestPartsForOperator({
      operatorId,
      workOrderId: workOrderId.toHexString(),
      partId,
      quantity: 4,
    });

    expect(partRequestModel.create).toHaveBeenCalledWith([
      expect.objectContaining({
        ot_id: workOrderId,
        part_id: partId,
        quantity: 4,
        requested_by: new Types.ObjectId(operatorId),
        status: 'pending',
      }),
    ]);
    expect(result.status).toBe('pending');
    expect(notificationService.notifyPartRequestCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        workOrderId: workOrderId.toHexString(),
      }),
    );

    // Explicit proof of "without directly reducing stock": no Stock write
    // or read of any kind happens anywhere in this flow.
    expect(stockModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(stockModel.updateOne).not.toHaveBeenCalled();
    expect(stockModel.find).not.toHaveBeenCalled();
    expect(stockModel.findById).not.toHaveBeenCalled();
  });

  it('rejects when the work order does not exist', async () => {
    workOrderModel.findById.mockReturnValue(execResult(null));

    await expect(
      service.requestPartsForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        partId,
        quantity: 1,
      }),
    ).rejects.toThrow(NotFoundException);
    expect(partRequestModel.create).not.toHaveBeenCalled();
  });

  it('rejects a non-corrective work order', async () => {
    workOrderModel.findById.mockReturnValue(
      execResult(correctiveOrder({ type_maintenance: 'preventive' })),
    );

    await expect(
      service.requestPartsForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        partId,
        quantity: 1,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(partRequestModel.create).not.toHaveBeenCalled();
  });

  it('rejects a work order not assigned to this operator', async () => {
    workOrderModel.findById.mockReturnValue(
      execResult(
        correctiveOrder({ technician_id: new Types.ObjectId(otherOperatorId) }),
      ),
    );

    await expect(
      service.requestPartsForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        partId,
        quantity: 1,
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(partRequestModel.create).not.toHaveBeenCalled();
  });

  it('rejects a request for a work order in a non-eligible (closed) status', async () => {
    workOrderModel.findById.mockReturnValue(
      execResult(correctiveOrder({ status: 'completed' })),
    );

    await expect(
      service.requestPartsForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        partId,
        quantity: 1,
      }),
    ).rejects.toThrow(ConflictException);
    expect(partRequestModel.create).not.toHaveBeenCalled();
  });

  it('rejects when the referenced part does not exist', async () => {
    catalogueModel.findById.mockReturnValue(execResult(null));

    await expect(
      service.requestPartsForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        partId,
        quantity: 1,
      }),
    ).rejects.toThrow(NotFoundException);
    expect(partRequestModel.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid, non-positive, or non-integer quantity', async () => {
    await expect(
      service.requestPartsForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        partId,
        quantity: 0,
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.requestPartsForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        partId,
        quantity: 1.5,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(partRequestModel.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate active request for the same work order and part (pre-check)', async () => {
    partRequestModel.findOne.mockReturnValue(
      execResult({ _id: new Types.ObjectId(), status: 'pending' }),
    );

    await expect(
      service.requestPartsForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        partId,
        quantity: 1,
      }),
    ).rejects.toThrow(ConflictException);
    expect(partRequestModel.create).not.toHaveBeenCalled();
  });

  it('rejects a concurrent duplicate caught by the unique-index race guard', async () => {
    const duplicateKeyError = Object.assign(new Error('E11000 duplicate key'), {
      code: 11000,
    });
    partRequestModel.create.mockRejectedValue(duplicateKeyError);

    await expect(
      service.requestPartsForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        partId,
        quantity: 1,
      }),
    ).rejects.toThrow(ConflictException);
  });
});

describe('WorkOrderPartsService.decidePartRequest', () => {
  const requestId = new Types.ObjectId();
  const operatorId = new Types.ObjectId();
  const workOrderId = new Types.ObjectId();
  const partId = new Types.ObjectId();
  const stockId = new Types.ObjectId();

  function pendingRequest(overrides: Record<string, unknown> = {}) {
    return {
      _id: requestId,
      ot_id: workOrderId,
      part_id: partId,
      quantity: 3,
      requested_by: operatorId,
      status: 'pending',
      ...overrides,
    };
  }

  let partRequestModel: {
    findById: jest.Mock;
    findOneAndUpdate: jest.Mock;
    db: { startSession: jest.Mock };
  };
  let stockModel: { findOne: jest.Mock };
  let stockMovementsService: {
    reserve: jest.Mock;
    cancelReservation: jest.Mock;
  };
  let notificationService: {
    notifyPartRequestCreated: jest.Mock;
    notifyPartRequestDecision: jest.Mock;
  };
  let session: ReturnType<typeof createSessionMock>;
  let service: WorkOrderPartsService;

  beforeEach(() => {
    session = createSessionMock();
    partRequestModel = {
      findById: jest.fn().mockReturnValue(execResult(pendingRequest())),
      findOneAndUpdate: jest
        .fn()
        .mockReturnValue(execResult(pendingRequest({ status: 'reserved' }))),
      db: { startSession: jest.fn().mockResolvedValue(session) },
    };
    stockModel = {
      findOne: jest.fn().mockReturnValue(execResult({ _id: stockId })),
    };
    stockMovementsService = {
      reserve: jest.fn().mockResolvedValue({}),
      cancelReservation: jest.fn().mockResolvedValue({}),
    };
    notificationService = {
      notifyPartRequestCreated: jest.fn().mockResolvedValue(null),
      notifyPartRequestDecision: jest.fn().mockResolvedValue(null),
    };

    service = new WorkOrderPartsService(
      {} as never,
      {} as never,
      partRequestModel as never,
      stockModel as never,
      {} as never,
      stockMovementsService as never,
      notificationService as never,
    );
  });

  it('rejects when the part request does not exist', async () => {
    partRequestModel.findById.mockReturnValue(execResult(null));

    await expect(
      service.decidePartRequest({
        requestId: requestId.toHexString(),
        decision: 'approve',
        deciderId: new Types.ObjectId().toHexString(),
      }),
    ).rejects.toThrow(NotFoundException);
    expect(
      notificationService.notifyPartRequestDecision,
    ).not.toHaveBeenCalled();
  });

  it('rejects a part request that has already been decided', async () => {
    partRequestModel.findById.mockReturnValue(
      execResult(pendingRequest({ status: 'reserved' })),
    );

    await expect(
      service.decidePartRequest({
        requestId: requestId.toHexString(),
        decision: 'approve',
        deciderId: new Types.ObjectId().toHexString(),
      }),
    ).rejects.toThrow(ConflictException);
    expect(partRequestModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects when approving would require a stock record that does not exist', async () => {
    stockModel.findOne.mockReturnValue(execResult(null));

    await expect(
      service.decidePartRequest({
        requestId: requestId.toHexString(),
        decision: 'approve',
        deciderId: new Types.ObjectId().toHexString(),
      }),
    ).rejects.toThrow(NotFoundException);
    expect(partRequestModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('approves a pending request, reserves stock transactionally, and notifies the requesting operator', async () => {
    const deciderId = new Types.ObjectId().toHexString();

    const result = await service.decidePartRequest({
      requestId: requestId.toHexString(),
      decision: 'approve',
      deciderId,
    });

    expect(partRequestModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: requestId, status: 'pending' },
      { $set: { status: 'reserved' } },
      { new: true, session },
    );
    expect(stockMovementsService.reserve).toHaveBeenCalledWith(session, {
      stockId: stockId.toString(),
      partId: partId.toString(),
      quantity: 3,
      workOrderId: workOrderId.toString(),
      partRequestId: requestId.toString(),
      actorId: deciderId,
    });
    expect(result.status).toBe('reserved');
    expect(session.endSession).toHaveBeenCalled();
    expect(notificationService.notifyPartRequestDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: 'approve',
        requesterUserId: operatorId.toString(),
        workOrderId: workOrderId.toString(),
      }),
    );
  });

  it('rejects a pending request, sets it to cancelled, never touches Stock, and notifies the requesting operator', async () => {
    partRequestModel.findOneAndUpdate.mockReturnValue(
      execResult(pendingRequest({ status: 'cancelled' })),
    );

    const result = await service.decidePartRequest({
      requestId: requestId.toHexString(),
      decision: 'reject',
      deciderId: new Types.ObjectId().toHexString(),
    });

    expect(partRequestModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: requestId, status: 'pending' },
      { $set: { status: 'cancelled' } },
      { new: true, session },
    );
    expect(stockMovementsService.reserve).not.toHaveBeenCalled();
    expect(stockMovementsService.cancelReservation).not.toHaveBeenCalled();
    expect(result.status).toBe('cancelled');
    expect(notificationService.notifyPartRequestDecision).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'reject' }),
    );
  });

  it('cancels a reserved request, releases the stock reservation transactionally, and notifies the requesting operator', async () => {
    partRequestModel.findById.mockReturnValue(
      execResult(pendingRequest({ status: 'reserved' })),
    );
    partRequestModel.findOneAndUpdate.mockReturnValue(
      execResult(pendingRequest({ status: 'cancelled' })),
    );
    const deciderId = new Types.ObjectId().toHexString();

    const result = await service.decidePartRequest({
      requestId: requestId.toHexString(),
      decision: 'cancel',
      deciderId,
      reason: 'No longer needed',
    });

    expect(partRequestModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: requestId, status: 'reserved' },
      { $set: { status: 'cancelled' } },
      { new: true, session },
    );
    expect(stockMovementsService.cancelReservation).toHaveBeenCalledWith(
      session,
      {
        stockId: stockId.toString(),
        partId: partId.toString(),
        quantity: 3,
        workOrderId: workOrderId.toString(),
        partRequestId: requestId.toString(),
        actorId: deciderId,
        reason: 'No longer needed',
      },
    );
    expect(result.status).toBe('cancelled');
  });

  it('rejects cancelling a request that is not currently reserved', async () => {
    partRequestModel.findById.mockReturnValue(execResult(pendingRequest()));

    await expect(
      service.decidePartRequest({
        requestId: requestId.toHexString(),
        decision: 'cancel',
        deciderId: new Types.ObjectId().toHexString(),
      }),
    ).rejects.toThrow(ConflictException);
    expect(partRequestModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('fails safe (conflict) when a concurrent decision wins the atomic status-guarded update race', async () => {
    partRequestModel.findOneAndUpdate.mockReturnValue(execResult(null));

    await expect(
      service.decidePartRequest({
        requestId: requestId.toHexString(),
        decision: 'approve',
        deciderId: new Types.ObjectId().toHexString(),
      }),
    ).rejects.toThrow(ConflictException);
    expect(
      notificationService.notifyPartRequestDecision,
    ).not.toHaveBeenCalled();
  });
});
