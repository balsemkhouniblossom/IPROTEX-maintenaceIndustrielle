import { ForbiddenException } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { Role } from '../schemas/user.schema';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';

describe('DocumentsController authorization', () => {
  let documentsService: {
    remove: jest.Mock;
    readProtectedFile: jest.Mock;
    findAll: jest.Mock;
    findByMachine: jest.Mock;
  };
  let documentAccessService: {
    resolveAccessibleDocument: jest.Mock;
    listAccessibleMachineIds: jest.Mock;
    assertCanAccessMachine: jest.Mock;
  };
  let controller: DocumentsController;

  beforeEach(() => {
    documentsService = {
      remove: jest.fn(),
      findAll: jest.fn().mockResolvedValue({ items: [] }),
      findByMachine: jest.fn().mockResolvedValue([]),
      readProtectedFile: jest.fn().mockResolvedValue({
        buffer: Buffer.from('file'),
        contentType: 'application/pdf',
        fileName: 'manual.pdf',
        size: 4,
      }),
    };
    documentAccessService = {
      resolveAccessibleDocument: jest.fn().mockResolvedValue({ _id: 'doc-id' }),
      listAccessibleMachineIds: jest.fn().mockResolvedValue(null),
      assertCanAccessMachine: jest.fn().mockResolvedValue(undefined),
    };
    controller = new DocumentsController(
      documentsService as never,
      documentAccessService as never,
    );
  });

  it('blocks unauthorized document deletion before storage or Mongo deletion runs', () => {
    const req = {
      user: {
        userId: 'user-1',
        role: Role.OPERATOR,
      },
    } as AuthenticatedRequest;

    expect(() => controller.remove('doc-id', req)).toThrow(ForbiddenException);
    expect(documentsService.remove).not.toHaveBeenCalled();
  });

  it('streams protected document files only after role authorization', async () => {
    const req = {
      user: {
        userId: 'user-1',
        role: Role.TECHNICIAN,
      },
    } as AuthenticatedRequest;
    const res = {
      setHeader: jest.fn(),
      send: jest.fn(),
    };

    await controller.viewFile('doc-id', req, res as never);

    expect(
      documentAccessService.resolveAccessibleDocument,
    ).toHaveBeenCalledWith(req.user, 'doc-id');
    expect(documentsService.readProtectedFile).toHaveBeenCalledWith('doc-id', {
      _id: 'doc-id',
    });
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/pdf',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    );
    expect(res.send).toHaveBeenCalledWith(Buffer.from('file'));
  });

  it('blocks cross-role document file access before storage reads run', async () => {
    const req = {
      user: {
        userId: 'user-1',
        role: 'viewer',
      },
    } as unknown as AuthenticatedRequest;

    await expect(
      controller.viewFile('doc-id', req, {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as never),
    ).rejects.toThrow(ForbiddenException);
    expect(documentsService.readProtectedFile).not.toHaveBeenCalled();
  });

  it.each([Role.OPERATOR, Role.TECHNICIAN])(
    'applies current-published visibility to %s list reads',
    async (role) => {
      const req = { user: { userId: 'user-1', role } } as AuthenticatedRequest;
      documentAccessService.listAccessibleMachineIds.mockResolvedValue([]);

      await controller.findAll(req, '1', '10');

      expect(documentsService.findAll).toHaveBeenCalledWith(
        1,
        10,
        0,
        [],
        expect.objectContaining({ status: 'published' }),
      );
    },
  );

  it('does not constrain Admin management list reads to published documents', async () => {
    const req = {
      user: { userId: 'admin-1', role: Role.ADMIN },
    } as AuthenticatedRequest;

    await controller.findAll(req, '1', '10');

    expect(documentsService.findAll).toHaveBeenCalledWith(1, 10, 0, null, {});
  });

  it('restricts version history to Admin', async () => {
    const req = {
      user: { userId: 'user-1', role: Role.TECHNICIAN },
    } as AuthenticatedRequest;

    await expect(controller.listVersions('doc-id', req)).rejects.toThrow(
      ForbiddenException,
    );
    expect(
      documentAccessService.resolveAccessibleDocument,
    ).not.toHaveBeenCalled();
  });
});
