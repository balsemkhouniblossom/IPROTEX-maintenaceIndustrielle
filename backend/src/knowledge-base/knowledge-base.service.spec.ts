import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { KnowledgeBaseService } from './knowledge-base.service';
import {
  KnowledgeArticleCategory,
  KnowledgeArticleStatus,
} from '../schemas/knowledge-article.schema';

type ArticleModelMock = jest.Mock & {
  findById?: jest.Mock;
  find?: jest.Mock;
  countDocuments?: jest.Mock;
  findOneAndUpdate?: jest.Mock;
  findByIdAndDelete?: jest.Mock;
  db?: { startSession: jest.Mock };
};

function article(plain: Record<string, unknown>) {
  return {
    ...plain,
    save: jest.fn().mockImplementation(function (
      this: Record<string, unknown>,
    ) {
      return Promise.resolve({ ...this });
    }),
  };
}

function existsStub(result = true) {
  return {
    exists: jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue(result) }),
  };
}

function findByIdStub(result: unknown) {
  return jest
    .fn()
    .mockReturnValue({ exec: jest.fn().mockResolvedValue(result) });
}

function oid(): string {
  return new Types.ObjectId().toString();
}

describe('KnowledgeBaseService', () => {
  let articleModel: ArticleModelMock;
  let machineModel: ReturnType<typeof existsStub> & { findById?: jest.Mock };
  let machineTypeModel: ReturnType<typeof existsStub>;
  let maintenancePlanModel: ReturnType<typeof existsStub>;
  let preventiveTaskModel: ReturnType<typeof existsStub>;
  let service: KnowledgeBaseService;

  beforeEach(() => {
    articleModel = jest.fn() as ArticleModelMock;
    machineModel = existsStub();
    machineModel.findById = jest.fn().mockReturnValue({
      select: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
    });
    machineTypeModel = existsStub();
    maintenancePlanModel = existsStub();
    preventiveTaskModel = existsStub();

    service = new KnowledgeBaseService(
      articleModel as never,
      machineModel as never,
      machineTypeModel as never,
      maintenancePlanModel as never,
      preventiveTaskModel as never,
    );
  });

  describe('create', () => {
    it('creates a Draft, version 1, revision 1 article with a created lifecycle entry', async () => {
      articleModel.mockImplementation((input: Record<string, unknown>) =>
        article(input),
      );

      const result = await service.create(
        {
          article_id: 'KB-1',
          title: 'Bearing overheating',
          category: KnowledgeArticleCategory.TROUBLESHOOTING,
          content: 'Check lubrication levels first.',
        },
        'user-1',
      );

      expect(result.status).toBe(KnowledgeArticleStatus.DRAFT);
      expect(result.version).toBe(1);
      expect(result.revision).toBe(1);
      expect(result.lifecycle_history as unknown[]).toHaveLength(1);
      expect((result.lifecycle_history as { action: string }[])[0].action).toBe(
        'created',
      );
    });

    it('rejects a create when the referenced machine does not exist', async () => {
      machineModel.exists = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(false) });

      await expect(
        service.create({
          article_id: 'KB-2',
          title: 'X',
          category: KnowledgeArticleCategory.SAFETY,
          content: 'Y',
          machine_id: new Types.ObjectId().toString(),
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('throws BadRequestException for an invalid id', async () => {
      await expect(service.findOne('not-an-id', false)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when the article does not exist', async () => {
      articleModel.findById = findByIdStub(null);
      await expect(
        service.findOne(new Types.ObjectId().toString(), false),
      ).rejects.toThrow(NotFoundException);
    });

    it('hides a non-Published article from a reader that requires Published', async () => {
      const id = oid();
      articleModel.findById = findByIdStub(
        article({ _id: id, status: KnowledgeArticleStatus.DRAFT }),
      );
      await expect(service.findOne(id, true)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns a Published article to a reader that requires Published', async () => {
      const id = oid();
      articleModel.findById = findByIdStub(
        article({ _id: id, status: KnowledgeArticleStatus.PUBLISHED }),
      );
      const result = await service.findOne(id, true);
      expect(result.status).toBe(KnowledgeArticleStatus.PUBLISHED);
    });
  });

  describe('listVersionHistory', () => {
    it('queries the whole chain via root_article_id or self id', async () => {
      const id = oid();
      const rootId = new Types.ObjectId();
      articleModel.findById = findByIdStub(
        article({
          _id: id,
          root_article_id: rootId,
          status: KnowledgeArticleStatus.PUBLISHED,
        }),
      );
      const sortMock = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(['v1', 'v2']) });
      articleModel.find = jest.fn().mockReturnValue({ sort: sortMock });

      const result = await service.listVersionHistory(id, false);

      expect(articleModel.find).toHaveBeenCalledWith({
        $or: [{ _id: rootId }, { root_article_id: rootId }],
      });
      expect(sortMock).toHaveBeenCalledWith({ revision: 1 });
      expect(result).toEqual(['v1', 'v2']);
    });
  });

  describe('update', () => {
    it('rejects editing a Published article directly', async () => {
      const id = oid();
      articleModel.findById = findByIdStub(
        article({
          _id: id,
          status: KnowledgeArticleStatus.PUBLISHED,
          version: 1,
        }),
      );
      await expect(service.update(id, { title: 'New title' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('requires expected_version once the article has a version', async () => {
      const id = oid();
      articleModel.findById = findByIdStub(
        article({ _id: id, status: KnowledgeArticleStatus.DRAFT, version: 3 }),
      );
      await expect(service.update(id, { title: 'New title' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('increments version and applies the update when expected_version matches', async () => {
      const id = oid();
      articleModel.findById = findByIdStub(
        article({ _id: id, status: KnowledgeArticleStatus.DRAFT, version: 1 }),
      );
      articleModel.findOneAndUpdate = jest.fn().mockReturnValue({
        exec: jest
          .fn()
          .mockResolvedValue(
            article({ _id: id, title: 'New title', version: 2 }),
          ),
      });

      const result = await service.update(id, {
        title: 'New title',
        expected_version: 1,
      });

      expect(articleModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: id, version: 1 },
        { $set: { title: 'New title' }, $inc: { version: 1 } },
        { new: true },
      );
      expect(result.version).toBe(2);
    });

    it('raises a conflict when the conditional update matches nothing (concurrent edit)', async () => {
      const id = oid();
      articleModel.findById = findByIdStub(
        article({ _id: id, status: KnowledgeArticleStatus.DRAFT, version: 1 }),
      );
      articleModel.findOneAndUpdate = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await expect(
        service.update(id, { title: 'New title', expected_version: 1 }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('publish', () => {
    it('publishes a plain Draft with no predecessor directly', async () => {
      const id = oid();
      articleModel.findById = findByIdStub(
        article({ _id: id, status: KnowledgeArticleStatus.DRAFT, version: 1 }),
      );
      articleModel.findOneAndUpdate = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(
          article({
            _id: id,
            status: KnowledgeArticleStatus.PUBLISHED,
            version: 2,
          }),
        ),
      });

      const result = await service.publish(
        id,
        { expected_version: 1 },
        'user-1',
      );
      expect(result.status).toBe(KnowledgeArticleStatus.PUBLISHED);
    });

    it('rejects publishing an already-Published article', async () => {
      const id = oid();
      articleModel.findById = findByIdStub(
        article({
          _id: id,
          status: KnowledgeArticleStatus.PUBLISHED,
          version: 1,
        }),
      );
      await expect(service.publish(id, {})).rejects.toThrow(ConflictException);
    });

    it('publishing a revision archives its predecessor in the same transaction', async () => {
      const id = oid();
      const predecessorId = new Types.ObjectId();
      articleModel.findById = findByIdStub(
        article({
          _id: id,
          status: KnowledgeArticleStatus.DRAFT,
          version: 1,
          supersedes_article_id: predecessorId,
        }),
      );

      const publishedUpdate = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(
          article({
            _id: id,
            status: KnowledgeArticleStatus.PUBLISHED,
            version: 2,
          }),
        ),
      });
      const predecessorUpdate = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(
          article({
            _id: predecessorId,
            status: KnowledgeArticleStatus.ARCHIVED,
            superseded_by_article_id: id,
          }),
        ),
      });
      articleModel.findOneAndUpdate = jest
        .fn()
        .mockImplementationOnce(() => publishedUpdate())
        .mockImplementationOnce(() => predecessorUpdate());

      const sessionMock = {
        withTransaction: jest.fn(async (fn: () => Promise<unknown>) => fn()),
        endSession: jest.fn().mockResolvedValue(undefined),
      };
      articleModel.db = {
        startSession: jest.fn().mockResolvedValue(sessionMock),
      };

      const result = await service.publish(
        id,
        { expected_version: 1 },
        'user-1',
      );

      expect(result.status).toBe(KnowledgeArticleStatus.PUBLISHED);
      expect(articleModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
      expect(sessionMock.endSession).toHaveBeenCalled();
    });
  });

  describe('archive', () => {
    it('archives a Draft or Published article', async () => {
      const id = oid();
      articleModel.findById = findByIdStub(
        article({
          _id: id,
          status: KnowledgeArticleStatus.PUBLISHED,
          version: 1,
        }),
      );
      articleModel.findOneAndUpdate = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(
          article({
            _id: id,
            status: KnowledgeArticleStatus.ARCHIVED,
            version: 2,
          }),
        ),
      });

      const result = await service.archive(
        id,
        { expected_version: 1 },
        'user-1',
      );
      expect(result.status).toBe(KnowledgeArticleStatus.ARCHIVED);
    });

    it('rejects archiving an already-Archived article', async () => {
      const id = oid();
      articleModel.findById = findByIdStub(
        article({
          _id: id,
          status: KnowledgeArticleStatus.ARCHIVED,
          version: 1,
        }),
      );
      await expect(service.archive(id, {})).rejects.toThrow(ConflictException);
    });
  });

  describe('reviseArticle', () => {
    it('rejects revising a Draft article (use update instead)', async () => {
      const id = oid();
      articleModel.findById = findByIdStub(
        article({ _id: id, status: KnowledgeArticleStatus.DRAFT, version: 1 }),
      );
      await expect(service.reviseArticle(id, {})).rejects.toThrow(
        ConflictException,
      );
    });

    it('creates a new Draft revision linked back to a Published article', async () => {
      const id = oid();
      articleModel.findById = findByIdStub(
        article({
          _id: id,
          article_id: 'KB-13',
          status: KnowledgeArticleStatus.PUBLISHED,
          version: 1,
          revision: 1,
          root_article_id: undefined,
          title: 'Old title',
          category: KnowledgeArticleCategory.PROCEDURE,
          content: 'Old content',
        }),
      );
      articleModel.mockImplementation((input: Record<string, unknown>) =>
        article(input),
      );

      const result = await service.reviseArticle(
        id,
        { content: 'New content', expected_version: 1 },
        'user-1',
      );

      expect(result.status).toBe(KnowledgeArticleStatus.DRAFT);
      expect(result.revision).toBe(2);
      expect(result.supersedes_article_id).toBe(id);
      expect(result.root_article_id).toBe(id);
      expect(result.content).toBe('New content');
      expect(result.title).toBe('Old title');
    });
  });

  describe('remove', () => {
    it('deletes an untouched Draft', async () => {
      const id = oid();
      articleModel.findById = findByIdStub(
        article({
          _id: id,
          status: KnowledgeArticleStatus.DRAFT,
          lifecycle_history: [{ action: 'created' }],
        }),
      );
      articleModel.findByIdAndDelete = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(article({ _id: id })),
      });

      const result = await service.remove(id);
      expect(result._id).toBe(id);
    });

    it('rejects deleting a Published article', async () => {
      const id = oid();
      articleModel.findById = findByIdStub(
        article({
          _id: id,
          status: KnowledgeArticleStatus.PUBLISHED,
          lifecycle_history: [{ action: 'created' }, { action: 'published' }],
        }),
      );
      await expect(service.remove(id)).rejects.toThrow(ConflictException);
    });
  });

  describe('computeSuggestions', () => {
    it('returns an empty array when no matching criteria are supplied', async () => {
      const result = await service.computeSuggestions({});
      expect(result).toEqual([]);
    });

    it('resolves machine_type_id from the machine when not explicitly supplied', async () => {
      const machineTypeId = new Types.ObjectId();
      const machineId = new Types.ObjectId().toString();
      machineModel.findById = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ type_id: machineTypeId }),
        }),
      });
      articleModel.find = jest.fn().mockReturnValue({
        limit: jest
          .fn()
          .mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      });

      await service.computeSuggestions({ machineId });

      expect(machineModel.findById).toHaveBeenCalledWith(machineId);
    });

    it('scores and sorts candidates by how many criteria they match, highest first', async () => {
      const machineId = new Types.ObjectId().toString();
      const faultCode = 'E-42';

      const weakMatch = article({
        _id: 'weak',
        status: KnowledgeArticleStatus.PUBLISHED,
        machine_id: machineId,
        fault_codes: [],
      });
      const strongMatch = article({
        _id: 'strong',
        status: KnowledgeArticleStatus.PUBLISHED,
        machine_id: machineId,
        fault_codes: [faultCode],
      });

      articleModel.find = jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([weakMatch, strongMatch]),
        }),
      });

      const result = await service.computeSuggestions({ machineId, faultCode });

      expect(result.map((entry) => (entry as { _id: string })._id)).toEqual([
        'strong',
        'weak',
      ]);
    });

    it('caps results at the requested limit', async () => {
      const machineId = new Types.ObjectId().toString();
      const candidates = Array.from({ length: 8 }, (_, index) =>
        article({
          _id: `m${index}`,
          status: KnowledgeArticleStatus.PUBLISHED,
          machine_id: machineId,
        }),
      );
      articleModel.find = jest.fn().mockReturnValue({
        limit: jest
          .fn()
          .mockReturnValue({ exec: jest.fn().mockResolvedValue(candidates) }),
      });

      const result = await service.computeSuggestions({ machineId, limit: 3 });
      expect(result).toHaveLength(3);
    });
  });
});
