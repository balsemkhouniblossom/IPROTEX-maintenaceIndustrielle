import { Types } from 'mongoose';
import { AnalyticsService } from './analytics.service';
import { DocumentAccessService } from '../documents/document-access.service';
import { MttrSourceService } from '../kpi/mttr-source.service';
import { Role } from '../schemas/user.schema';

describe('AnalyticsService.getMttr', () => {
  const year = 2026;
  let documentAccessService: {
    assertCanAccessMachine: jest.Mock;
    listAccessibleMachineIds: jest.Mock;
  };
  let mttrSource: { calculate: jest.Mock };
  let service: AnalyticsService;

  const actor = {
    userId: new Types.ObjectId().toString(),
    role: Role.ADMIN,
  };

  beforeEach(() => {
    documentAccessService = {
      assertCanAccessMachine: jest.fn().mockResolvedValue(undefined),
      listAccessibleMachineIds: jest.fn().mockResolvedValue(null),
    };
    mttrSource = { calculate: jest.fn().mockResolvedValue({}) };
    service = new AnalyticsService(
      mttrSource as unknown as MttrSourceService,
      documentAccessService as unknown as DocumentAccessService,
    );
  });

  it('delegates the selected year and filters to the shared source service', async () => {
    const machineId = new Types.ObjectId().toHexString();
    const technicianId = new Types.ObjectId().toHexString();
    const expected = { year, months: [] };
    mttrSource.calculate.mockResolvedValueOnce(expected);

    await expect(
      service.getMttr(year, { machineId, technicianId, actor }),
    ).resolves.toBe(expected);

    expect(documentAccessService.assertCanAccessMachine).toHaveBeenCalledWith(
      { userId: actor.userId, role: actor.role },
      machineId,
    );
    expect(mttrSource.calculate).toHaveBeenCalledWith({
      year,
      machineIds: [machineId],
      technicianId,
    });
  });

  it('resolves accessible machines for non-admin actors', async () => {
    const machineId = new Types.ObjectId();
    const technicianActor = {
      userId: new Types.ObjectId().toString(),
      role: Role.TECHNICIAN,
    };
    documentAccessService.listAccessibleMachineIds.mockResolvedValueOnce([
      machineId,
    ]);
    const expected = { year, months: [] };
    mttrSource.calculate.mockResolvedValueOnce(expected);

    await expect(
      service.getMttr(year, { actor: technicianActor }),
    ).resolves.toBe(expected);

    expect(documentAccessService.listAccessibleMachineIds).toHaveBeenCalledWith(
      {
        userId: technicianActor.userId,
        role: technicianActor.role,
      },
    );
    expect(mttrSource.calculate).toHaveBeenCalledWith({
      year,
      machineIds: [machineId.toHexString()],
    });
  });

  it('rejects an inaccessible or invalid machine before calculating', async () => {
    documentAccessService.assertCanAccessMachine.mockRejectedValueOnce(
      new Error('access denied'),
    );

    await expect(
      service.getMttr(year, {
        machineId: new Types.ObjectId().toHexString(),
        actor,
      }),
    ).rejects.toThrow('access denied');

    expect(mttrSource.calculate).not.toHaveBeenCalled();
  });

  it('rejects a non-admin technician filter for another user', async () => {
    const technicianActor = {
      userId: new Types.ObjectId().toString(),
      role: Role.TECHNICIAN,
    };
    const otherTechnicianId = new Types.ObjectId().toHexString();

    await expect(
      service.getMttr(year, {
        technicianId: otherTechnicianId,
        actor: technicianActor,
      }),
    ).rejects.toThrow('only by their own technician record');

    expect(mttrSource.calculate).not.toHaveBeenCalled();
  });

  it('rejects invalid years and identifiers', async () => {
    await expect(service.getMttr(0, { actor })).rejects.toThrow('Invalid year');
    await expect(
      service.getMttr(year, { machineId: 'invalid', actor }),
    ).rejects.toThrow('Invalid machineId');
    await expect(
      service.getMttr(year, { technicianId: 'invalid', actor }),
    ).rejects.toThrow('Invalid technicianId');
  });
});
