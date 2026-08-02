import { MachinesService } from './machines.service';

function chain<T>(value: T) {
  return {
    select: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

describe('MachinesService lifecycle history', () => {
  function buildService(existingStatus: string | null) {
    const saved = { toObject: () => ({}) };
    const machineModelInstance = { save: jest.fn().mockResolvedValue(saved) };
    const machineModel = jest.fn().mockImplementation((doc: unknown) => ({
      ...machineModelInstance,
      doc,
    })) as unknown as jest.Mock & {
      findById: jest.Mock;
      findByIdAndUpdate: jest.Mock;
    };
    machineModel.findById = jest.fn().mockReturnValue(
      chain(existingStatus === null ? null : { status: existingStatus }),
    );
    machineModel.findByIdAndUpdate = jest.fn().mockReturnValue(chain({}));

    const service = new MachinesService(
      machineModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    return { service, machineModel };
  }

  it('seeds a "created" lifecycle entry when a machine is created', async () => {
    const { service, machineModel } = buildService(null);

    await service.create({
      machine_id: 'M-1',
      type_id: 'type-1',
      serial_no: 'SN-1',
      status: 'operational',
    } as never);

    expect(machineModel).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'operational',
        lifecycle_history: [
          expect.objectContaining({ action: 'created', to_status: 'operational' }),
        ],
      }),
    );
  });

  it('pushes a status_changed lifecycle entry when the status actually changes', async () => {
    const { service, machineModel } = buildService('operational');

    await service.update('machine-1', { status: 'maintenance' } as never);

    expect(machineModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'machine-1',
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'maintenance' }),
        $push: {
          lifecycle_history: expect.objectContaining({
            action: 'status_changed',
            from_status: 'operational',
            to_status: 'maintenance',
          }),
        },
      }),
      { new: true },
    );
  });

  it('does not push a lifecycle entry when the status is unchanged', async () => {
    const { service, machineModel } = buildService('operational');

    await service.update('machine-1', {
      status: 'operational',
      location: 'Bay 2',
    } as never);

    expect(machineModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'machine-1',
      { status: 'operational', location: 'Bay 2' },
      { new: true },
    );
  });
});
