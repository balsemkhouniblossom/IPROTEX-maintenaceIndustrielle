import { LubrificationLogsService } from './lubrification-logs.service';

function chain<T>(value: T) {
  const result: { populate: jest.Mock; exec: jest.Mock } = {
    populate: jest.fn(),
    exec: jest.fn().mockResolvedValue(value),
  };
  result.populate.mockReturnValue(result);
  return result;
}

describe('LubrificationLogsService — technician projection', () => {
  let lubrificationLogModel: {
    find: jest.Mock;
    findById: jest.Mock;
    countDocuments: jest.Mock;
  };
  let service: LubrificationLogsService;

  beforeEach(() => {
    lubrificationLogModel = {
      find: jest.fn(),
      findById: jest.fn(),
      countDocuments: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(0),
      }),
    };
    service = new LubrificationLogsService(lubrificationLogModel as never);
  });

  it('findAll never fetches the full technician User document', async () => {
    const findChain: {
      skip: jest.Mock;
      limit: jest.Mock;
      populate: jest.Mock;
      exec: jest.Mock;
    } = {
      skip: jest.fn(),
      limit: jest.fn(),
      populate: jest.fn(),
      exec: jest.fn().mockResolvedValue([]),
    };
    findChain.skip.mockReturnValue(findChain);
    findChain.limit.mockReturnValue(findChain);
    findChain.populate.mockReturnValue(findChain);
    lubrificationLogModel.find.mockReturnValue(findChain);

    await service.findAll(1, 10, 0);

    expect(findChain.populate).toHaveBeenCalledWith(
      'technician_id',
      'nom_complet user_id role',
    );
    expect(findChain.populate).not.toHaveBeenCalledWith('technician_id');
  });

  it('findOne never fetches the full technician User document', async () => {
    const findByIdChain = chain(null);
    lubrificationLogModel.findById.mockReturnValue(findByIdChain);

    await service.findOne('log-id');

    expect(findByIdChain.populate).toHaveBeenCalledWith(
      'technician_id',
      'nom_complet user_id role',
    );
    expect(findByIdChain.populate).not.toHaveBeenCalledWith('technician_id');
  });
});
