import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SavedViewsService } from './saved-views.service';

function execResolves(result: unknown) {
  return { exec: jest.fn().mockResolvedValue(result) };
}

describe('SavedViewsService', () => {
  const actor = { userId: new Types.ObjectId().toString() };
  const otherActor = { userId: new Types.ObjectId().toString() };

  let savedViewModel: {
    create: jest.Mock;
    find: jest.Mock;
    findById: jest.Mock;
    findByIdAndDelete: jest.Mock;
  };

  function buildService() {
    return new SavedViewsService(savedViewModel as never);
  }

  beforeEach(() => {
    savedViewModel = {
      create: jest.fn().mockImplementation((doc) => Promise.resolve({ ...doc, _id: new Types.ObjectId() })),
      find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnValue(execResolves([])) }),
      findById: jest.fn().mockReturnValue(execResolves(null)),
      findByIdAndDelete: jest.fn().mockReturnValue(execResolves(undefined)),
    };
  });

  describe('create', () => {
    it('scopes the new view to the calling user and generates a view_id', async () => {
      const service = buildService();

      const view = await service.create(
        { pageKey: 'work-orders', name: 'My open orders', query: { status: 'open' } },
        actor,
      );

      expect(view.user_id).toEqual(new Types.ObjectId(actor.userId));
      expect(view.page_key).toBe('work-orders');
      expect(view.view_id).toMatch(/^VIEW-/);
      expect(view.is_default).toBe(false);
    });

    it('honors an explicit isDefault flag', async () => {
      const service = buildService();
      const view = await service.create(
        { pageKey: 'users', name: 'Pending', query: {}, isDefault: true },
        actor,
      );
      expect(view.is_default).toBe(true);
    });
  });

  describe('listForPage', () => {
    it('scopes the query to both the calling user and the requested page', async () => {
      const service = buildService();
      await service.listForPage('users', actor);

      expect(savedViewModel.find).toHaveBeenCalledWith({
        user_id: new Types.ObjectId(actor.userId),
        page_key: 'users',
      });
    });
  });

  describe('update / remove ownership', () => {
    function viewDoc(overrides: Record<string, unknown> = {}) {
      return {
        _id: 'v1',
        user_id: new Types.ObjectId(actor.userId),
        name: 'Old name',
        query: { status: 'open' },
        is_default: false,
        save: jest.fn().mockResolvedValue(undefined),
        ...overrides,
      };
    }

    it('throws NotFoundException for a missing view', async () => {
      savedViewModel.findById.mockReturnValue(execResolves(null));
      const service = buildService();
      await expect(service.update('missing', {}, actor)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when a different user tries to update it', async () => {
      savedViewModel.findById.mockReturnValue(execResolves(viewDoc()));
      const service = buildService();
      await expect(service.update('v1', { name: 'x' }, otherActor)).rejects.toThrow(ForbiddenException);
    });

    it('updates name/query/isDefault and persists via save()', async () => {
      const doc = viewDoc();
      savedViewModel.findById.mockReturnValue(execResolves(doc));
      const service = buildService();

      const updated = await service.update(
        'v1',
        { name: 'New name', query: { status: 'closed' }, isDefault: true },
        actor,
      );

      expect(updated.name).toBe('New name');
      expect(updated.query).toEqual({ status: 'closed' });
      expect(updated.is_default).toBe(true);
      expect(doc.save).toHaveBeenCalled();
    });

    it('removes an owned view', async () => {
      const doc = viewDoc();
      savedViewModel.findById.mockReturnValue(execResolves(doc));
      const service = buildService();

      await service.remove('v1', actor);
      expect(savedViewModel.findByIdAndDelete).toHaveBeenCalledWith('v1');
    });

    it('a different user cannot delete someone else\'s saved view', async () => {
      savedViewModel.findById.mockReturnValue(execResolves(viewDoc()));
      const service = buildService();
      await expect(service.remove('v1', otherActor)).rejects.toThrow(ForbiddenException);
      expect(savedViewModel.findByIdAndDelete).not.toHaveBeenCalled();
    });
  });
});
