import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '../../schemas/user.schema';
import { MachineHistoryReportProvider } from './machine-history.provider';

function execResolves(result: unknown) {
  return { exec: jest.fn().mockResolvedValue(result) };
}

describe('MachineHistoryReportProvider', () => {
  const actor = {
    userId: new Types.ObjectId().toString(),
    role: Role.TECHNICIAN,
  };
  const machineId = new Types.ObjectId().toString();

  function buildProvider(workOrders: unknown[], reports: unknown[] = []) {
    const workOrderModel = {
      find: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(workOrders),
      }),
    };
    const interventionReportModel = {
      find: jest.fn().mockReturnValue(execResolves(reports)),
    };
    const documentAccessService = {
      assertCanAccessMachine: jest.fn().mockResolvedValue(undefined),
    };

    const provider = new MachineHistoryReportProvider(
      workOrderModel as never,
      interventionReportModel as never,
      documentAccessService as never,
    );
    return { provider, documentAccessService };
  }

  it('requires a machineId', async () => {
    const { provider } = buildProvider([]);
    await expect(provider.buildDataset({}, actor)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('joins work orders with their intervention report by ot_id', async () => {
    const workOrderId = new Types.ObjectId();
    const { provider } = buildProvider(
      [
        {
          _id: workOrderId,
          ot_id: 'OT-1',
          date_created: new Date('2026-06-01'),
          type_maintenance: 'corrective',
          status: 'completed',
          code_panne: 'E-1',
          description: 'desc',
          technician_id: { nom_complet: 'Jane Tech' },
        },
      ],
      [
        {
          ot_id: workOrderId,
          cause_racine: 'worn part',
          description_action: 'replaced part',
        },
      ],
    );

    const dataset = await provider.buildDataset({ machineId }, actor);

    expect(dataset.rows).toEqual([
      expect.objectContaining({
        work_order: 'OT-1',
        technician: 'Jane Tech',
        root_cause: 'worn part',
        action_taken: 'replaced part',
      }),
    ]);
    expect(dataset.summary).toEqual([{ label: 'Total work orders', value: 1 }]);
  });

  it('checks machine access before querying', async () => {
    const { provider, documentAccessService } = buildProvider([]);
    await provider.buildDataset({ machineId }, actor);
    expect(documentAccessService.assertCanAccessMachine).toHaveBeenCalledWith(
      { userId: actor.userId, role: actor.role },
      machineId,
    );
  });
});
