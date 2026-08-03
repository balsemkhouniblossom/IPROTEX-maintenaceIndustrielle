import { Types } from 'mongoose';
import { WorkOrderQueryService } from './work-order-query.service';

function execResult<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

describe('WorkOrderQueryService.findAll — server-side filtering, search, and sort', () => {
  function findAllChain<T>(value: T) {
    const result: {
      sort: jest.Mock;
      skip: jest.Mock;
      limit: jest.Mock;
      populate: jest.Mock;
      exec: jest.Mock;
    } = {
      sort: jest.fn(),
      skip: jest.fn(),
      limit: jest.fn(),
      populate: jest.fn(),
      exec: jest.fn().mockResolvedValue(value),
    };
    result.sort.mockReturnValue(result);
    result.skip.mockReturnValue(result);
    result.limit.mockReturnValue(result);
    result.populate.mockReturnValue(result);
    return result;
  }

  let workOrderModel: { find: jest.Mock; countDocuments: jest.Mock };
  let service: WorkOrderQueryService;

  beforeEach(() => {
    workOrderModel = {
      find: jest.fn().mockReturnValue(findAllChain([])),
      countDocuments: jest.fn().mockReturnValue(execResult(0)),
    };

    service = new WorkOrderQueryService(workOrderModel as never);
  });

  it('applies status and priority as $in filters from comma-separated query params', async () => {
    await service.findAll(1, 10, 0, {
      status: 'open, in_progress',
      priority: 'high,critical',
    });

    expect(workOrderModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        status: { $in: ['open', 'in_progress'] },
        priorite: { $in: ['high', 'critical'] },
      }),
    );
  });

  it('escapes search input and searches ot_id/description/code_panne', async () => {
    await service.findAll(1, 10, 0, { search: 'a.b+c' });

    const [filter] = workOrderModel.find.mock.calls[0] as [
      { $or: Array<Record<string, RegExp>> },
    ];
    expect(filter.$or).toHaveLength(3);
    expect(filter.$or[0].ot_id.source).toBe('a\\.b\\+c');
  });

  it('builds a date_created range filter from dateFrom/dateTo', async () => {
    await service.findAll(1, 10, 0, {
      dateFrom: '2026-01-01T00:00:00.000Z',
      dateTo: '2026-02-01T00:00:00.000Z',
    });

    expect(workOrderModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        date_created: {
          $gte: new Date('2026-01-01T00:00:00.000Z'),
          $lte: new Date('2026-02-01T00:00:00.000Z'),
        },
      }),
    );
  });

  it('sorts by an allow-listed field and direction', async () => {
    const chain = findAllChain([]);
    workOrderModel.find.mockReturnValue(chain);

    await service.findAll(1, 10, 0, { sort: '-priorite' });

    expect(chain.sort).toHaveBeenCalledWith({ priorite: -1 });
  });

  it('defaults to newest-first when sort is absent or not allow-listed', async () => {
    const chain = findAllChain([]);
    workOrderModel.find.mockReturnValue(chain);

    await service.findAll(1, 10, 0, { sort: 'ot_id' });

    expect(chain.sort).toHaveBeenCalledWith({ date_created: -1 });
  });

  it('ignores an invalid machineId/technicianId instead of throwing', async () => {
    await service.findAll(1, 10, 0, { machineId: 'not-an-object-id' });

    const [filter] = workOrderModel.find.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(filter.machine_id).toBeUndefined();
  });

  it('never fetches the full technician User document — populate is restricted to a safe projection', async () => {
    const chain = findAllChain([]);
    workOrderModel.find.mockReturnValue(chain);

    await service.findAll(1, 10, 0);

    expect(chain.populate).toHaveBeenCalledWith(
      'technician_id',
      'nom_complet user_id role',
    );
    expect(chain.populate).not.toHaveBeenCalledWith('technician_id');
  });
});

describe('WorkOrderQueryService.findOne — technician projection', () => {
  let workOrderModel: { findById: jest.Mock };
  let findByIdChain: { populate: jest.Mock; exec: jest.Mock };
  let service: WorkOrderQueryService;

  beforeEach(() => {
    findByIdChain = {
      populate: jest.fn(),
      exec: jest.fn().mockResolvedValue(null),
    };
    findByIdChain.populate.mockReturnValue(findByIdChain);
    workOrderModel = { findById: jest.fn().mockReturnValue(findByIdChain) };

    service = new WorkOrderQueryService(workOrderModel as never);
  });

  it('never fetches the full technician User document on a single work order lookup either', async () => {
    await service.findOne(new Types.ObjectId().toHexString());

    expect(findByIdChain.populate).toHaveBeenCalledWith(
      'technician_id',
      'nom_complet user_id role',
    );
    expect(findByIdChain.populate).not.toHaveBeenCalledWith('technician_id');
  });
});
