import { ForbiddenException } from '@nestjs/common';
import { MachineTimelineController } from './machine-timeline.controller';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { Role } from '../schemas/user.schema';

describe('MachineTimelineController authorization', () => {
  let machineTimelineService: { getSummary: jest.Mock; getTimeline: jest.Mock };
  let documentAccessService: { assertCanAccessMachine: jest.Mock };
  let controller: MachineTimelineController;

  beforeEach(() => {
    machineTimelineService = {
      getSummary: jest.fn().mockResolvedValue({ machine: {}, stats: {} }),
      getTimeline: jest.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    };
    documentAccessService = {
      assertCanAccessMachine: jest.fn().mockResolvedValue(undefined),
    };
    controller = new MachineTimelineController(
      machineTimelineService as never,
      documentAccessService as never,
    );
  });

  it('checks machine access before building the summary', async () => {
    const req = { user: { userId: 'user-1', role: Role.OPERATOR } } as AuthenticatedRequest;

    await controller.getSummary('machine-1', req);

    expect(documentAccessService.assertCanAccessMachine).toHaveBeenCalledWith(
      req.user,
      'machine-1',
    );
    expect(machineTimelineService.getSummary).toHaveBeenCalledWith('machine-1');
  });

  it('checks machine access before building the timeline', async () => {
    const req = { user: { userId: 'user-1', role: Role.TECHNICIAN } } as AuthenticatedRequest;
    const query = { page: 1, limit: 20 };

    await controller.getTimeline('machine-1', query as never, req);

    expect(documentAccessService.assertCanAccessMachine).toHaveBeenCalledWith(
      req.user,
      'machine-1',
    );
    expect(machineTimelineService.getTimeline).toHaveBeenCalledWith('machine-1', query);
  });

  it('blocks an unauthorized machine timeline request before any data is read', async () => {
    documentAccessService.assertCanAccessMachine.mockRejectedValue(
      new ForbiddenException('Operator is not assigned to this machine'),
    );
    const req = { user: { userId: 'user-1', role: Role.OPERATOR } } as AuthenticatedRequest;

    await expect(
      controller.getTimeline('machine-1', {} as never, req),
    ).rejects.toThrow(ForbiddenException);
    expect(machineTimelineService.getTimeline).not.toHaveBeenCalled();
  });
});
