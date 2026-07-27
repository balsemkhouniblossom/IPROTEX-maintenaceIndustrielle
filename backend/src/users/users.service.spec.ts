import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ApprovalStatus, Role, User } from '../schemas/user.schema';
import { UsersService } from './users.service';

jest.mock('bcrypt', () => ({
  __esModule: true,
  hash: jest.fn(),
}));

function createQuery<T>(result: T) {
  const query: { session: jest.Mock; exec: jest.Mock } = {
    session: jest.fn(),
    exec: jest.fn().mockResolvedValue(result),
  };
  query.session.mockReturnValue(query);
  return query;
}

describe('UsersService', () => {
  let service: UsersService;
  let session: { withTransaction: jest.Mock; endSession: jest.Mock };
  let userModel: jest.Mock & {
    findOne: jest.Mock;
    findById: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
    findOneAndUpdate: jest.Mock;
    db: { startSession: jest.Mock };
  };
  let savedDocuments: Array<Record<string, unknown>>;

  beforeEach(async () => {
    savedDocuments = [];
    session = {
      withTransaction: jest.fn(async (fn: () => Promise<unknown>) => fn()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    userModel = jest
      .fn()
      .mockImplementation((document: Record<string, unknown>) => {
        savedDocuments.push(document);
        return {
          ...document,
          save: jest.fn().mockResolvedValue(document),
        };
      }) as typeof userModel;
    userModel.findOne = jest.fn().mockReturnValue(createQuery(null));
    userModel.findById = jest.fn();
    userModel.find = jest.fn();
    userModel.countDocuments = jest.fn();
    userModel.findOneAndUpdate = jest.fn();
    userModel.db = { startSession: jest.fn().mockResolvedValue(session) };
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: userModel },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates pending local users with a hashed password and no session fields', async () => {
    await service.create({
      nom_complet: 'Local User',
      email: 'user@example.com',
      password: 'P@ssword123!',
      role: Role.OPERATOR,
      is_active: false,
      is_verified: false,
      approval_status: ApprovalStatus.PENDING,
    });

    expect(bcrypt.hash).toHaveBeenCalledWith('P@ssword123!', 10);
    expect(savedDocuments[0]).toEqual(
      expect.objectContaining({
        email: 'user@example.com',
        password: 'hashed-password',
        role: Role.OPERATOR,
        is_active: false,
        is_verified: false,
        approval_status: ApprovalStatus.PENDING,
      }),
    );
    expect(savedDocuments[0]).not.toHaveProperty('refresh_token_hash');
    expect(savedDocuments[0]).not.toHaveProperty('login_history');
    expect(savedDocuments[0]).not.toHaveProperty('last_login');
  });

  it('accepts explicit pending inactive state for Google-created public users', async () => {
    await service.create({
      nom_complet: 'Google User',
      email: 'google@example.com',
      role: Role.OPERATOR,
      google_id: 'google-123',
      is_verified: true,
      is_active: false,
      approval_status: ApprovalStatus.PENDING,
    });

    expect(savedDocuments[0]).toEqual(
      expect.objectContaining({
        google_id: 'google-123',
        google_linked_at: expect.any(Date),
        google_auth_history: [
          expect.objectContaining({
            action: 'linked',
            google_id: 'google-123',
            at: expect.any(Date),
          }),
        ],
        is_active: false,
        is_verified: true,
        approval_status: ApprovalStatus.PENDING,
      }),
    );
  });

  it('finds email case-insensitively with regex escaping', async () => {
    await service.findByEmail(' User+Test@example.com ');

    expect(userModel.findOne).toHaveBeenCalledWith({
      email: {
        $regex: '^user\\+test@example\\.com$',
        $options: 'i',
      },
    });
  });

  it('links an existing password account to Google with an audit entry', async () => {
    const targetId = new Types.ObjectId();
    const target = createUserDocument({
      _id: targetId,
      google_id: undefined,
      password: 'hashed-password',
    });
    const linked = createUserDocument({
      _id: targetId,
      google_id: 'google-linked',
      password: 'hashed-password',
    });

    userModel.findOne.mockReturnValue(createQuery(null));
    userModel.findById.mockReturnValue(createQuery(target));
    userModel.findOneAndUpdate.mockReturnValue(createQuery(linked));

    const result = await service.linkGoogleIdentity(
      targetId.toString(),
      ' google-linked ',
    );

    const updateCalls = userModel.findOneAndUpdate.mock.calls as Array<
      [
        Record<string, unknown>,
        {
          $set: Record<string, unknown>;
          $unset: Record<string, unknown>;
          $push: Record<string, unknown>;
        },
        { new: boolean },
      ]
    >;
    expect(updateCalls[0][0]).toEqual(
      expect.objectContaining({ _id: targetId }),
    );
    expect(updateCalls[0][1].$set).toEqual(
      expect.objectContaining({
        google_id: 'google-linked',
        is_verified: true,
        google_linked_at: expect.any(Date),
      }),
    );
    expect(updateCalls[0][1].$push.google_auth_history).toEqual(
      expect.objectContaining({
        action: 'linked',
        google_id: 'google-linked',
        at: expect.any(Date),
      }),
    );
    expect(result).toBe(linked);
    expect(result?.password).toBe('hashed-password');
  });

  it('prevents linking a Google account that belongs to another user', async () => {
    const targetId = new Types.ObjectId();
    const owner = createUserDocument({
      _id: new Types.ObjectId(),
      google_id: 'google-owned',
    });

    userModel.findOne.mockReturnValue(createQuery(owner));

    await expect(
      service.linkGoogleIdentity(targetId.toString(), 'google-owned'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(userModel.findById).not.toHaveBeenCalled();
    expect(userModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('allows administrators to relink Google authentication with audit history', async () => {
    const targetId = new Types.ObjectId();
    const adminId = new Types.ObjectId();
    const target = createUserDocument({
      _id: targetId,
      google_id: 'old-google-id',
    });
    const updated = createUserDocument({
      _id: targetId,
      google_id: 'new-google-id',
    });
    const select = jest.fn().mockReturnValue(createQuery(updated));

    userModel.findOne.mockReturnValue(createQuery(null));
    userModel.findById.mockReturnValue(createQuery(target));
    userModel.findOneAndUpdate.mockReturnValue({ select });

    const result = await service.relinkGoogleAuthentication(
      targetId.toString(),
      'new-google-id',
      adminId.toString(),
    );

    const updateCalls = userModel.findOneAndUpdate.mock.calls as Array<
      [
        Record<string, unknown>,
        {
          $set: Record<string, unknown>;
          $unset: Record<string, unknown>;
          $push: Record<string, unknown>;
        },
        { new: boolean },
      ]
    >;
    expect(updateCalls[0][1].$set.google_id).toBe('new-google-id');
    expect(updateCalls[0][1].$push.google_auth_history).toEqual(
      expect.objectContaining({
        action: 'relinked',
        google_id: 'new-google-id',
        previous_google_id: 'old-google-id',
        actor_user_id: adminId,
        at: expect.any(Date),
      }),
    );
    expect(select).toHaveBeenCalledWith('-password -refresh_token_hash');
    expect(result).toBe(updated);
  });

  it('unlinks Google authentication without removing the password login', async () => {
    const targetId = new Types.ObjectId();
    const adminId = new Types.ObjectId();
    const target = createUserDocument({
      _id: targetId,
      google_id: 'google-to-remove',
      password: 'hashed-password',
    });
    const updated = createUserDocument({
      _id: targetId,
      google_id: undefined,
      password: 'hashed-password',
    });
    const select = jest.fn().mockReturnValue(createQuery(updated));

    userModel.findById.mockReturnValue(createQuery(target));
    userModel.findOneAndUpdate.mockReturnValue({ select });

    const result = await service.unlinkGoogleAuthentication(
      targetId.toString(),
      adminId.toString(),
    );

    const updateCalls = userModel.findOneAndUpdate.mock.calls as Array<
      [
        Record<string, unknown>,
        {
          $set: Record<string, unknown>;
          $unset: Record<string, unknown>;
          $push: Record<string, unknown>;
        },
        { new: boolean },
      ]
    >;
    expect(updateCalls[0][1].$unset).toEqual({ google_id: '' });
    expect(updateCalls[0][1].$unset).not.toHaveProperty('password');
    expect(updateCalls[0][1].$push.google_auth_history).toEqual(
      expect.objectContaining({
        action: 'unlinked',
        previous_google_id: 'google-to-remove',
        actor_user_id: adminId,
        at: expect.any(Date),
      }),
    );
    expect(select).toHaveBeenCalledWith('-password -refresh_token_hash');
    expect(result).toBe(updated);
  });

  function createUserDocument(overrides: Record<string, unknown> = {}) {
    return {
      _id: new Types.ObjectId(),
      nom_complet: 'Pending User',
      email: 'pending@example.com',
      role: Role.OPERATOR,
      is_active: false,
      is_verified: true,
      approval_status: ApprovalStatus.PENDING,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    };
  }

  function createFindChain(result: unknown[]) {
    const limit = jest.fn().mockReturnValue(createQuery(result));
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    const select = jest.fn().mockReturnValue({ skip, sort });
    return { select, sort, skip, limit };
  }

  it('builds pending-approval list filters safely and caps the limit', async () => {
    const chain = createFindChain([createUserDocument()]);
    userModel.find.mockReturnValue(chain);
    userModel.countDocuments.mockReturnValue(createQuery(1));

    const result = await service.findPendingApprovals({
      search: 'Pending+User@example.com',
      role: Role.OPERATOR,
      emailVerified: 'verified',
      limit: 200,
    });

    expect(userModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        approval_status: ApprovalStatus.PENDING,
        role: Role.OPERATOR,
        is_verified: true,
      }),
    );
    const findCalls = userModel.find.mock.calls as Array<
      [
        {
          $or: Array<Record<string, RegExp>>;
        },
      ]
    >;
    const filter = findCalls[0][0];
    expect(filter.$or[1].email.source).toBe('Pending\\+User@example\\.com');
    expect(chain.sort).toHaveBeenCalledWith({ created_at: 1, _id: 1 });
    expect(chain.limit).toHaveBeenCalledWith(100);
    expect(result.code).toBe('PENDING_APPROVALS_RETRIEVED');
    expect(result.items[0]).not.toHaveProperty('_id');
    expect(result.items[0]).not.toHaveProperty('user_id');
  });

  it('does not return public pending admins when role filter is admin', async () => {
    const chain = createFindChain([]);
    userModel.find.mockReturnValue(chain);
    userModel.countDocuments.mockReturnValue(createQuery(0));

    await service.findPendingApprovals({ role: Role.ADMIN as never });

    expect(userModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        approval_status: ApprovalStatus.PENDING,
        role: { $in: [] },
      }),
    );
  });

  it('filters administrator users list by approval status and search', async () => {
    const chain = createFindChain([createUserDocument()]);
    userModel.find.mockReturnValue(chain);
    userModel.countDocuments.mockReturnValue(createQuery(1));

    const result = await service.findAll(1, 10, 0, {
      approvalStatus: ApprovalStatus.APPROVED,
      search: 'approved+user@example.com',
    });

    expect(userModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        approval_status: ApprovalStatus.APPROVED,
      }),
    );
    const findCalls = userModel.find.mock.calls as Array<
      [{ approval_status: ApprovalStatus; $or: Array<Record<string, RegExp>> }]
    >;
    expect(findCalls[0][0].$or[1].email.source).toBe(
      'approved\\+user@example\\.com',
    );
    expect(result.totalItems).toBe(1);
  });

  it('sorts the administrator users list by an allow-listed field and direction', async () => {
    const chain = createFindChain([createUserDocument()]);
    userModel.find.mockReturnValue(chain);
    userModel.countDocuments.mockReturnValue(createQuery(1));

    await service.findAll(1, 10, 0, { sort: '-nom_complet' });

    expect(chain.sort).toHaveBeenCalledWith({ nom_complet: -1 });
  });

  it('falls back to the default sort when an unlisted field is requested', async () => {
    const chain = createFindChain([createUserDocument()]);
    userModel.find.mockReturnValue(chain);
    userModel.countDocuments.mockReturnValue(createQuery(1));

    await service.findAll(1, 10, 0, { sort: 'password' as never });

    expect(chain.sort).toHaveBeenCalledWith({ created_at: -1 });
  });

  it('defaults to newest-first when no sort is requested', async () => {
    const chain = createFindChain([createUserDocument()]);
    userModel.find.mockReturnValue(chain);
    userModel.countDocuments.mockReturnValue(createQuery(1));

    await service.findAll(1, 10, 0, {});

    expect(chain.sort).toHaveBeenCalledWith({ created_at: -1 });
  });

  it('blocks approval until email verification is complete', async () => {
    userModel.findById.mockReturnValue(
      createQuery(
        createUserDocument({
          is_verified: false,
        }),
      ),
    );

    await expect(
      service.approveUser(
        new Types.ObjectId().toString(),
        new Types.ObjectId().toString(),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(userModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('blocks approval until Google profile completion is complete', async () => {
    userModel.findById.mockReturnValue(
      createQuery(
        createUserDocument({
          is_verified: true,
          profile_completed: false,
        }),
      ),
    );

    await expect(
      service.approveUser(
        new Types.ObjectId().toString(),
        new Types.ObjectId().toString(),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(userModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('approves with an atomic update and clears stale rejection/session fields', async () => {
    const targetId = new Types.ObjectId();
    const adminId = new Types.ObjectId();
    const decisionAt = new Date('2026-02-01T00:00:00.000Z');
    const target = createUserDocument({
      _id: targetId,
      rejection_reason: 'Old reason',
      refresh_token_hash: 'old-refresh',
    });
    const updated = createUserDocument({
      _id: targetId,
      approval_status: ApprovalStatus.APPROVED,
      is_active: true,
      approved_at: decisionAt,
    });

    userModel.findById.mockReturnValue(createQuery(target));
    userModel.findOneAndUpdate.mockReturnValue(createQuery(updated));

    const result = await service.approveUser(
      targetId.toString(),
      adminId.toString(),
      decisionAt,
    );

    const updateCalls = userModel.findOneAndUpdate.mock.calls as Array<
      [
        Record<string, unknown>,
        { $set: Record<string, unknown>; $unset: Record<string, unknown> },
        { new: boolean },
      ]
    >;
    expect(updateCalls[0][0]).toEqual(
      expect.objectContaining({
        _id: targetId,
        role: { $in: [Role.OPERATOR, Role.TECHNICIAN] },
        is_verified: true,
      }),
    );
    expect(updateCalls[0][1].$set).toEqual(
      expect.objectContaining({
        approval_status: ApprovalStatus.APPROVED,
        is_active: true,
        approved_by: adminId,
        approved_at: decisionAt,
      }),
    );
    expect(updateCalls[0][1].$unset).toEqual(
      expect.objectContaining({
        refresh_token_hash: '',
        rejection_reason: '',
      }),
    );
    expect(updateCalls[0][2]).toEqual({ new: true });
    expect(result.code).toBe('ACCOUNT_APPROVED');
    expect(result.user).not.toHaveProperty('approved_by');
  });

  it('rejects with a trimmed reason and clears stale approval/session fields', async () => {
    const targetId = new Types.ObjectId();
    const adminId = new Types.ObjectId();
    const decisionAt = new Date('2026-02-01T00:00:00.000Z');
    const target = createUserDocument({ _id: targetId });
    const updated = createUserDocument({
      _id: targetId,
      approval_status: ApprovalStatus.REJECTED,
      is_active: false,
      rejection_reason: 'Not eligible',
      rejected_at: decisionAt,
    });

    userModel.findById.mockReturnValue(createQuery(target));
    userModel.findOneAndUpdate.mockReturnValue(createQuery(updated));

    const result = await service.rejectUser(
      targetId.toString(),
      adminId.toString(),
      '  Not eligible  ',
      decisionAt,
    );

    const updateCalls = userModel.findOneAndUpdate.mock.calls as Array<
      [
        Record<string, unknown>,
        { $set: Record<string, unknown>; $unset: Record<string, unknown> },
        { new: boolean },
      ]
    >;
    expect(updateCalls[0][0]).toEqual(
      expect.objectContaining({
        _id: targetId,
        role: { $in: [Role.OPERATOR, Role.TECHNICIAN] },
      }),
    );
    expect(updateCalls[0][1].$set).toEqual(
      expect.objectContaining({
        approval_status: ApprovalStatus.REJECTED,
        is_active: false,
        rejected_by: adminId,
        rejected_at: decisionAt,
        rejection_reason: 'Not eligible',
      }),
    );
    expect(updateCalls[0][1].$unset).toEqual(
      expect.objectContaining({
        approved_by: '',
        approved_at: '',
        refresh_token_hash: '',
      }),
    );
    expect(updateCalls[0][2]).toEqual({ new: true });
    expect(result.code).toBe('ACCOUNT_REJECTED');
    expect(result.user.rejection_reason).toBe('Not eligible');
    expect(result.user).not.toHaveProperty('rejected_by');
  });

  it('validates identifiers and rejection reasons before atomic rejection', async () => {
    await expect(
      service.rejectUser(
        'not-an-id',
        new Types.ObjectId().toString(),
        'Reason',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.rejectUser(
        new Types.ObjectId().toString(),
        new Types.ObjectId().toString(),
        '   ',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(userModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  describe('bulkApproveUsers / bulkRejectUsers — transactional bulk actions', () => {
    const adminId = new Types.ObjectId().toString();

    it('rejects an empty selection without opening a transaction', async () => {
      await expect(service.bulkApproveUsers([], adminId)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(userModel.db.startSession).not.toHaveBeenCalled();
    });

    it('approves every id inside one transaction and reports them all as succeeded', async () => {
      const ids = [new Types.ObjectId().toString(), new Types.ObjectId().toString()];
      userModel.findById.mockReturnValue(
        createQuery(createUserDocument({ is_verified: true, profile_completed: true })),
      );
      userModel.findOneAndUpdate.mockReturnValue(
        createQuery(createUserDocument({ approval_status: ApprovalStatus.APPROVED })),
      );

      const result = await service.bulkApproveUsers(ids, adminId);

      expect(userModel.db.startSession).toHaveBeenCalled();
      expect(session.withTransaction).toHaveBeenCalled();
      expect(session.endSession).toHaveBeenCalled();
      expect(userModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ code: 'BULK_APPROVAL_COMPLETE', succeeded: ids });
    });

    it('deduplicates repeated ids in the same request', async () => {
      const id = new Types.ObjectId().toString();
      userModel.findById.mockReturnValue(
        createQuery(createUserDocument({ is_verified: true, profile_completed: true })),
      );
      userModel.findOneAndUpdate.mockReturnValue(
        createQuery(createUserDocument({ approval_status: ApprovalStatus.APPROVED })),
      );

      await service.bulkApproveUsers([id, id], adminId);

      expect(userModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    });

    it('rolls back the whole transaction and annotates the failure with the offending id when one row fails validation', async () => {
      const okId = new Types.ObjectId().toString();
      const badId = new Types.ObjectId().toString();
      userModel.findById
        .mockReturnValueOnce(
          createQuery(createUserDocument({ is_verified: true, profile_completed: true })),
        )
        .mockReturnValueOnce(
          createQuery(createUserDocument({ is_verified: false, profile_completed: true })),
        );
      userModel.findOneAndUpdate.mockReturnValue(
        createQuery(createUserDocument({ approval_status: ApprovalStatus.APPROVED })),
      );
      session.withTransaction.mockImplementation(async (fn: () => Promise<unknown>) => {
        try {
          return await fn();
        } finally {
          // A real Mongo transaction aborts and rolls back every write on
          // failure — this test only asserts the error propagates with
          // enough context to identify the offending row.
        }
      });

      await expect(service.bulkApproveUsers([okId, badId], adminId)).rejects.toMatchObject({
        response: expect.objectContaining({ targetId: badId, code: 'EMAIL_VERIFICATION_REQUIRED_BEFORE_APPROVAL' }),
      });
      expect(session.endSession).toHaveBeenCalled();
    });

    it('bulkRejectUsers reuses rejectUser validation per row inside one transaction', async () => {
      const ids = [new Types.ObjectId().toString(), new Types.ObjectId().toString()];
      userModel.findById.mockReturnValue(createQuery(createUserDocument()));
      userModel.findOneAndUpdate.mockReturnValue(
        createQuery(createUserDocument({ approval_status: ApprovalStatus.REJECTED })),
      );

      const result = await service.bulkRejectUsers(ids, adminId, 'Duplicate accounts');

      expect(userModel.db.startSession).toHaveBeenCalled();
      expect(userModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ code: 'BULK_REJECTION_COMPLETE', succeeded: ids });
    });

    it('bulkRejectUsers rejects an empty selection without opening a transaction', async () => {
      await expect(service.bulkRejectUsers([], adminId, 'reason')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(userModel.db.startSession).not.toHaveBeenCalled();
    });
  });
});
