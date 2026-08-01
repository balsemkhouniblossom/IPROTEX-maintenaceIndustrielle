import { ForbiddenException } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { Role } from '../schemas/user.schema';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';

describe('DocumentsController authorization', () => {
  let documentsService: { remove: jest.Mock; readProtectedFile: jest.Mock };
  let documentAccessService: {
    resolveAccessibleDocument: jest.Mock;
    listAccessibleMachineIds: jest.Mock;
    assertCanAccessMachine: jest.Mock;
  };
  let controller: DocumentsController;

  beforeEach(() => {
    documentsService = {
      remove: jest.fn(),
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
});
