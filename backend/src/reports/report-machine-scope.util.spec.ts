import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '../schemas/user.schema';
import { resolveReportMachineScope } from './report-machine-scope.util';

describe('resolveReportMachineScope', () => {
  const actor = {
    userId: new Types.ObjectId().toString(),
    role: Role.TECHNICIAN,
  };

  it('checks and returns a single-element scope when machineId is given', async () => {
    const machineId = new Types.ObjectId().toString();
    const documentAccessService = {
      assertCanAccessMachine: jest.fn().mockResolvedValue(undefined),
    };

    const scope = await resolveReportMachineScope(
      documentAccessService as never,
      actor,
      machineId,
    );

    expect(documentAccessService.assertCanAccessMachine).toHaveBeenCalledWith(
      { userId: actor.userId, role: actor.role },
      machineId,
    );
    expect(scope).toEqual([new Types.ObjectId(machineId)]);
  });

  it('returns undefined (unrestricted) for Admin with no machineId', async () => {
    const documentAccessService = {
      listAccessibleMachineIds: jest.fn().mockResolvedValue(null),
    };
    const scope = await resolveReportMachineScope(
      documentAccessService as never,
      actor,
    );
    expect(scope).toBeUndefined();
  });

  it('returns the accessible machine list for a scoped role', async () => {
    const ids = [new Types.ObjectId(), new Types.ObjectId()];
    const documentAccessService = {
      listAccessibleMachineIds: jest.fn().mockResolvedValue(ids),
    };
    const scope = await resolveReportMachineScope(
      documentAccessService as never,
      actor,
    );
    expect(scope).toEqual(ids);
  });

  it('throws ForbiddenException when the caller has no accessible machines', async () => {
    const documentAccessService = {
      listAccessibleMachineIds: jest.fn().mockResolvedValue([]),
    };
    await expect(
      resolveReportMachineScope(documentAccessService as never, actor),
    ).rejects.toThrow(ForbiddenException);
  });

  it('caps an oversized accessible-machine list at 200', async () => {
    const ids = Array.from({ length: 250 }, () => new Types.ObjectId());
    const documentAccessService = {
      listAccessibleMachineIds: jest.fn().mockResolvedValue(ids),
    };
    const scope = await resolveReportMachineScope(
      documentAccessService as never,
      actor,
    );
    expect(scope).toHaveLength(200);
  });
});
