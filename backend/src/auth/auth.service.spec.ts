import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { NotificationsFacade } from '../notifications/notifications.facade';
import { ApprovalStatus, Role, User } from '../schemas/user.schema';
import { ConfigService } from '@nestjs/config';
import { EmailVerificationTokenService } from './email-verification-token.service';
import { AppConfigService } from '../config/app.config';
import { GoogleLoginExchangeService } from './google-login-exchange.service';
import { FileStorageService } from '../storage/file-storage.service';
import { FeatureFlagsConfigService } from '../config/feature-flags.config';

jest.mock('bcrypt', () => ({
  __esModule: true,
  compare: jest.fn(),
  hash: jest.fn(),
}));

type QueryLike<T> = {
  exec: jest.Mock<Promise<T>, []>;
};

function createQuery<T>(result: T): QueryLike<T> {
  return {
    exec: jest.fn<Promise<T>, []>().mockResolvedValue(result),
  };
}

type MockUserDocument = {
  _id: Types.ObjectId;
  email: string;
  user_id: string;
  role: string;
  is_active: boolean;
  is_verified: boolean;
  password: string;
  nom_complet: string;
  created_at: Date;
  toObject: jest.Mock;
  [key: string]: unknown;
};

function createUserDocument(
  overrides: Partial<Record<string, unknown>> = {},
): MockUserDocument {
  const baseId = new Types.ObjectId();
  const userDocument: MockUserDocument = {
    _id: baseId,
    email: 'user@example.com',
    user_id: 'USER-001',
    role: 'operator',
    is_active: true,
    is_verified: true,
    password: 'hashed-password',
    nom_complet: 'Test User',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    toObject: jest.fn().mockReturnValue({
      _id: baseId,
      email: 'user@example.com',
      user_id: 'USER-001',
      role: 'operator',
      is_active: true,
      is_verified: true,
      password: 'hashed-password',
      nom_complet: 'Test User',
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    }),
    ...overrides,
  };

  return userDocument;
}

describe('AuthService', () => {
  let service: AuthService;
  let usersService: {
    findByEmail: jest.Mock;
    findByGoogleId: jest.Mock;
    linkGoogleIdentity: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    findOne: jest.Mock;
    findByResetToken: jest.Mock;
    recordSuccessfulLogin: jest.Mock;
  };
  let jwtService: {
    sign: jest.Mock;
    verify: jest.Mock;
  };
  let notificationsFacade: {
    sendVerificationEmail: jest.Mock;
    sendResetPasswordEmail: jest.Mock;
  };
  let configService: {
    get: jest.Mock;
  };
  let appConfigService: {
    resolveFrontendBaseUrl: jest.Mock;
  };
  let fileStorageService: {
    resolveUrl: jest.Mock;
  };
  let featureFlags: {
    isLegacyResetTokensEnabled: jest.Mock;
  };
  let emailVerificationTokenService: {
    issueToken: jest.Mock;
    verifyToken: jest.Mock;
  };
  let googleLoginExchangeService: {
    createExchange: jest.Mock;
    consumeExchange: jest.Mock;
  };
  let userModel: {
    findById: jest.Mock;
    findByIdAndUpdate: jest.Mock;
    findByIdAndDelete: jest.Mock;
    findOneAndUpdate: jest.Mock;
    findOne: jest.Mock;
  };

  beforeEach(async () => {
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.APP_URL = 'https://app.example.com';
    process.env.DEFAULT_LOCALE = 'en';

    usersService = {
      findByEmail: jest.fn(),
      findByGoogleId: jest.fn(),
      linkGoogleIdentity: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findOne: jest.fn(),
      findByResetToken: jest.fn(),
      recordSuccessfulLogin: jest.fn(),
    };

    jwtService = {
      sign: jest.fn(),
      verify: jest.fn(),
    };

    notificationsFacade = {
      sendVerificationEmail: jest.fn(),
      sendResetPasswordEmail: jest.fn(),
    };

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'DEFAULT_LOCALE') return 'en';
        return undefined;
      }),
    };

    appConfigService = {
      resolveFrontendBaseUrl: jest
        .fn()
        .mockReturnValue('https://app.example.com'),
    };

    emailVerificationTokenService = {
      issueToken: jest.fn(),
      verifyToken: jest.fn(),
    };
    googleLoginExchangeService = {
      createExchange: jest.fn(),
      consumeExchange: jest.fn(),
    };
    fileStorageService = {
      resolveUrl: jest.fn((path?: string | null, url?: string | null) =>
        Promise.resolve(url || path || ''),
      ),
    };
    featureFlags = {
      isLegacyResetTokensEnabled: jest.fn().mockReturnValue(false),
    };

    userModel = {
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      findByIdAndDelete: jest.fn(),
      findOneAndUpdate: jest.fn(),
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        { provide: NotificationsFacade, useValue: notificationsFacade },
        { provide: ConfigService, useValue: configService },
        { provide: AppConfigService, useValue: appConfigService },
        {
          provide: EmailVerificationTokenService,
          useValue: emailVerificationTokenService,
        },
        {
          provide: GoogleLoginExchangeService,
          useValue: googleLoginExchangeService,
        },
        { provide: FileStorageService, useValue: fileStorageService },
        { provide: FeatureFlagsConfigService, useValue: featureFlags },
        { provide: getModelToken(User.name), useValue: userModel },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers a new operator as pending and sends a verification email', async () => {
    const createdUser = createUserDocument({
      email: 'new.user@example.com',
      user_id: 'USER-002',
      is_active: false,
      is_verified: false,
      approval_status: ApprovalStatus.PENDING,
      password: 'hashed-password',
      nom_complet: 'New User',
      role: Role.OPERATOR,
    });

    usersService.findByEmail.mockResolvedValue(null);
    usersService.create.mockResolvedValue(createdUser);
    emailVerificationTokenService.issueToken.mockReturnValue(
      'verification-token',
    );
    notificationsFacade.sendVerificationEmail.mockResolvedValue(undefined);

    await expect(
      service.register(
        {
          nom_complet: 'New User',
          email: '  New.User@Example.COM  ',
          password: 'P@ssword123!',
          role: Role.OPERATOR,
          phone: '+21612345678',
          department: 'Maintenance',
        } as never,
        'fr',
        'http://localhost:3000',
      ),
    ).resolves.toEqual({
      success: true,
      code: 'ACCOUNT_CREATED_PENDING_APPROVAL',
      requiresEmailVerification: true,
      requiresAdminApproval: true,
      user: {
        email: 'new.user@example.com',
        role: Role.OPERATOR,
        is_verified: false,
        is_active: false,
        approval_status: ApprovalStatus.PENDING,
      },
      message:
        'Your account was created successfully. Verify your email and wait for administrator approval before signing in.',
    });

    expect(usersService.findByEmail).toHaveBeenCalledWith(
      'new.user@example.com',
    );
    expect(usersService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'new.user@example.com',
        nom_complet: 'New User',
        role: Role.OPERATOR,
        is_active: false,
        is_verified: false,
        approval_status: ApprovalStatus.PENDING,
      }),
    );
    expect(emailVerificationTokenService.issueToken).toHaveBeenCalledWith(
      createdUser._id.toString(),
    );
    expect(notificationsFacade.sendVerificationEmail).toHaveBeenCalledWith({
      to: 'new.user@example.com',
      token: 'verification-token',
      locale: 'fr',
      frontendOrigin: 'http://localhost:3000',
    });
    expect(jwtService.sign).not.toHaveBeenCalled();
    expect(userModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('registers a new technician as pending', async () => {
    const createdUser = createUserDocument({
      email: 'tech@example.com',
      user_id: 'USER-004',
      is_active: false,
      is_verified: false,
      approval_status: ApprovalStatus.PENDING,
      role: Role.TECHNICIAN,
    });

    usersService.findByEmail.mockResolvedValue(null);
    usersService.create.mockResolvedValue(createdUser);
    emailVerificationTokenService.issueToken.mockReturnValue(
      'verification-token',
    );
    notificationsFacade.sendVerificationEmail.mockResolvedValue(undefined);

    const result = await service.register({
      nom_complet: 'Tech User',
      email: 'tech@example.com',
      password: 'P@ssword123!',
      role: Role.TECHNICIAN,
    } as never);

    expect(usersService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'tech@example.com',
        role: Role.TECHNICIAN,
        is_active: false,
        is_verified: false,
        approval_status: ApprovalStatus.PENDING,
      }),
    );
    expect(result.user.role).toBe(Role.TECHNICIAN);
  });

  it('rejects admin and unknown public registration roles', async () => {
    await expect(
      service.register({
        nom_complet: 'Admin User',
        email: 'admin@example.com',
        password: 'P@ssword123!',
        role: Role.ADMIN,
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      service.register({
        nom_complet: 'Unknown User',
        email: 'unknown@example.com',
        password: 'P@ssword123!',
        role: 'supervisor',
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(usersService.create).not.toHaveBeenCalled();
  });

  it('ignores client attempts to override protected registration state', async () => {
    const createdUser = createUserDocument({
      email: 'override@example.com',
      role: Role.OPERATOR,
      is_active: false,
      is_verified: false,
      approval_status: ApprovalStatus.PENDING,
    });

    usersService.findByEmail.mockResolvedValue(null);
    usersService.create.mockResolvedValue(createdUser);
    emailVerificationTokenService.issueToken.mockReturnValue(
      'verification-token',
    );
    notificationsFacade.sendVerificationEmail.mockResolvedValue(undefined);

    await service.register({
      nom_complet: 'Override User',
      email: 'override@example.com',
      password: 'P@ssword123!',
      role: Role.OPERATOR,
      is_active: true,
      is_verified: true,
      approval_status: ApprovalStatus.APPROVED,
      refresh_token_hash: 'client-token',
      login_history: [new Date()],
    } as never);

    expect(usersService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        is_active: false,
        is_verified: false,
        approval_status: ApprovalStatus.PENDING,
      }),
    );
    const createCalls = usersService.create.mock.calls as unknown as Array<
      [Record<string, unknown>]
    >;
    const createCall = createCalls[0][0];
    expect(createCall).not.toHaveProperty('refresh_token_hash');
    expect(createCall).not.toHaveProperty('login_history');
  });

  it('rejects case-insensitive duplicate email before creation', async () => {
    usersService.findByEmail.mockResolvedValue(createUserDocument());

    await expect(
      service.register({
        nom_complet: 'Duplicate User',
        email: ' USER@EXAMPLE.COM ',
        password: 'P@ssword123!',
        role: Role.OPERATOR,
      } as never),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(usersService.findByEmail).toHaveBeenCalledWith('user@example.com');
    expect(usersService.create).not.toHaveBeenCalled();
  });

  it('turns duplicate-key registration races into controlled conflicts', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    usersService.create.mockRejectedValue({ code: 11000 });

    await expect(
      service.register({
        nom_complet: 'Race User',
        email: 'race@example.com',
        password: 'P@ssword123!',
        role: Role.OPERATOR,
      } as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rolls back registration when verification email sending fails', async () => {
    const createdUserId = new Types.ObjectId();
    const createdUser = createUserDocument({
      _id: createdUserId,
      email: 'rollback@example.com',
      user_id: 'USER-003',
      is_active: false,
      is_verified: false,
      approval_status: ApprovalStatus.PENDING,
      nom_complet: 'Rollback User',
    });

    usersService.findByEmail.mockResolvedValue(null);
    usersService.create.mockResolvedValue(createdUser);
    emailVerificationTokenService.issueToken.mockReturnValue(
      'verification-token',
    );
    notificationsFacade.sendVerificationEmail.mockRejectedValue(
      new Error('smtp failed'),
    );
    userModel.findByIdAndDelete.mockReturnValue(
      createQuery({ acknowledged: true }),
    );

    await expect(
      service.register({
        nom_complet: 'Rollback User',
        email: 'rollback@example.com',
        password: 'P@ssword123!',
        role: Role.OPERATOR,
        phone: '+21612345678',
        department: 'Maintenance',
      } as never),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(userModel.findByIdAndDelete).toHaveBeenCalledWith(createdUserId);
  });

  function mockVerificationToken(userId: Types.ObjectId) {
    emailVerificationTokenService.verifyToken.mockReturnValue({
      userId: userId.toString(),
    });
  }

  it('verifies a pending account without activating or approving it', async () => {
    const userId = new Types.ObjectId();
    const pendingUser = createUserDocument({
      _id: userId,
      is_active: false,
      is_verified: false,
      approval_status: ApprovalStatus.PENDING,
      role: Role.OPERATOR,
    });

    mockVerificationToken(userId);
    userModel.findById.mockReturnValue(createQuery(pendingUser));
    userModel.findByIdAndUpdate.mockReturnValue(
      createQuery({ acknowledged: true }),
    );

    const result = await service.verifyEmail('valid-token');

    expect(emailVerificationTokenService.verifyToken).toHaveBeenCalledWith(
      'valid-token',
    );
    expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
      userId.toString(),
      {
        is_verified: true,
      },
    );
    expect(result).toEqual({
      success: true,
      code: 'EMAIL_VERIFIED_PENDING_APPROVAL',
      emailVerified: true,
      requiresAdminApproval: true,
      message:
        'Your email was verified successfully. Your account is waiting for administrator approval.',
    });
    expect(jwtService.sign).not.toHaveBeenCalled();
    const updateCalls = userModel.findByIdAndUpdate.mock
      .calls as unknown as Array<[string, Record<string, unknown>]>;
    expect(updateCalls[0][1]).toEqual({ is_verified: true });
    expect(updateCalls[0][1]).not.toHaveProperty('is_active');
    expect(updateCalls[0][1]).not.toHaveProperty('approval_status');
    expect(updateCalls[0][1]).not.toHaveProperty('refresh_token_hash');
    expect(updateCalls[0][1]).not.toHaveProperty('last_login');
  });

  it('preserves approved account state and metadata during verification', async () => {
    const userId = new Types.ObjectId();
    const approvedBy = new Types.ObjectId();

    mockVerificationToken(userId);
    userModel.findById.mockReturnValue(
      createQuery(
        createUserDocument({
          _id: userId,
          is_active: false,
          is_verified: false,
          approval_status: ApprovalStatus.APPROVED,
          role: Role.TECHNICIAN,
          approved_by: approvedBy,
          approved_at: new Date('2026-01-02T00:00:00.000Z'),
        }),
      ),
    );
    userModel.findByIdAndUpdate.mockReturnValue(
      createQuery({ acknowledged: true }),
    );

    const result = await service.verifyEmail('approved-token');

    expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
      userId.toString(),
      { is_verified: true },
    );
    expect(result.code).toBe('EMAIL_VERIFIED');
    expect(result.requiresAdminApproval).toBe(false);
  });

  it('preserves rejected account state and metadata during verification', async () => {
    const userId = new Types.ObjectId();
    const rejectedBy = new Types.ObjectId();
    const rejectedAt = new Date('2026-01-03T00:00:00.000Z');

    mockVerificationToken(userId);
    userModel.findById.mockReturnValue(
      createQuery(
        createUserDocument({
          _id: userId,
          is_active: false,
          is_verified: false,
          approval_status: ApprovalStatus.REJECTED,
          rejected_by: rejectedBy,
          rejected_at: rejectedAt,
          rejection_reason: 'Not eligible',
        }),
      ),
    );
    userModel.findByIdAndUpdate.mockReturnValue(
      createQuery({ acknowledged: true }),
    );

    const result = await service.verifyEmail('rejected-token');

    expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
      userId.toString(),
      { is_verified: true },
    );
    const updateCalls = userModel.findByIdAndUpdate.mock
      .calls as unknown as Array<[string, Record<string, unknown>]>;
    expect(updateCalls[0][1]).not.toHaveProperty('approval_status');
    expect(updateCalls[0][1]).not.toHaveProperty('rejected_by');
    expect(updateCalls[0][1]).not.toHaveProperty('rejected_at');
    expect(updateCalls[0][1]).not.toHaveProperty('rejection_reason');
    expect(result).toEqual({
      success: true,
      code: 'EMAIL_VERIFIED_ACCOUNT_REJECTED',
      emailVerified: true,
      requiresAdminApproval: false,
      message:
        'Your email was verified, but the account request has been rejected.',
    });
  });

  it('returns stable responses for reused verification links', async () => {
    const pendingId = new Types.ObjectId();
    mockVerificationToken(pendingId);
    userModel.findById.mockReturnValueOnce(
      createQuery(
        createUserDocument({
          _id: pendingId,
          is_verified: true,
          is_active: false,
          approval_status: ApprovalStatus.PENDING,
        }),
      ),
    );

    await expect(service.verifyEmail('pending-token')).resolves.toEqual({
      success: true,
      code: 'EMAIL_ALREADY_VERIFIED_PENDING_APPROVAL',
      emailVerified: true,
      requiresAdminApproval: true,
      message:
        'Your email is already verified. Your account is waiting for administrator approval.',
    });

    const approvedId = new Types.ObjectId();
    mockVerificationToken(approvedId);
    userModel.findById.mockReturnValueOnce(
      createQuery(
        createUserDocument({
          _id: approvedId,
          is_verified: true,
          is_active: true,
          approval_status: ApprovalStatus.APPROVED,
        }),
      ),
    );

    await expect(service.verifyEmail('approved-token')).resolves.toEqual({
      success: true,
      code: 'EMAIL_ALREADY_VERIFIED',
      emailVerified: true,
      requiresAdminApproval: false,
      message: 'Your email is already verified.',
    });
    expect(userModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects invalid verification tokens without crashing', async () => {
    emailVerificationTokenService.verifyToken.mockReturnValue({});

    await expect(service.verifyEmail('bad-token')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    await expect(service.verifyEmail('')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects verification tokens for missing users', async () => {
    const userId = new Types.ObjectId();
    mockVerificationToken(userId);
    userModel.findById.mockReturnValue(createQuery(null));

    await expect(
      service.verifyEmail('missing-user-token'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  function expectErrorCode(error: unknown, code: string) {
    expect(
      (error as ForbiddenException | UnauthorizedException).getResponse(),
    ).toEqual(expect.objectContaining({ code }));
  }

  async function expectRejectsWithCode(
    promise: Promise<unknown>,
    exceptionClass: typeof ForbiddenException | typeof UnauthorizedException,
    code: string,
  ) {
    try {
      await promise;
      throw new Error(`Expected promise to reject with ${code}`);
    } catch (error) {
      expect(error).toBeInstanceOf(exceptionClass);
      expectErrorCode(error, code);
    }
  }

  type RedirectResponseMock = {
    redirect: jest.Mock<void, [string]>;
    clearCookie: jest.Mock<void, [string, unknown?]>;
  };

  function createRedirectResponse(): RedirectResponseMock {
    return {
      redirect: jest.fn<void, [string]>(),
      clearCookie: jest.fn<void, [string, unknown?]>(),
    };
  }

  it('validates local credentials before revealing account state', async () => {
    const pendingUser = createUserDocument({
      is_active: false,
      is_verified: true,
      approval_status: ApprovalStatus.PENDING,
      password: 'hashed-password',
    });

    usersService.findByEmail.mockResolvedValue(pendingUser);
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await expectRejectsWithCode(
      service.validateUser('  USER@Example.COM  ', 'bad-password'),
      UnauthorizedException,
      'INVALID_CREDENTIALS',
    );

    expect(usersService.findByEmail).toHaveBeenCalledWith('user@example.com');
    expect(usersService.recordSuccessfulLogin).not.toHaveBeenCalled();
    expect(jwtService.sign).not.toHaveBeenCalled();
  });

  it('returns invalid credentials for missing users and local-password gaps', async () => {
    (bcrypt.compare as jest.Mock).mockClear();
    usersService.findByEmail.mockResolvedValueOnce(null);

    await expectRejectsWithCode(
      service.validateUser('missing@example.com', 'P@ssword123!'),
      UnauthorizedException,
      'INVALID_CREDENTIALS',
    );

    usersService.findByEmail.mockResolvedValueOnce(
      createUserDocument({ password: undefined }),
    );

    await expectRejectsWithCode(
      service.validateUser('google-only@example.com', 'P@ssword123!'),
      UnauthorizedException,
      'INVALID_CREDENTIALS',
    );

    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(usersService.recordSuccessfulLogin).not.toHaveBeenCalled();
  });

  it('blocks local login until the account is verified', async () => {
    const unverifiedUser = createUserDocument({
      is_active: true,
      is_verified: false,
      approval_status: ApprovalStatus.APPROVED,
      password: 'hashed-password',
    });

    usersService.findByEmail.mockResolvedValue(unverifiedUser);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    await expectRejectsWithCode(
      service.validateUser('user@example.com', 'P@ssword123!'),
      ForbiddenException,
      'EMAIL_NOT_VERIFIED',
    );
    expect(usersService.recordSuccessfulLogin).not.toHaveBeenCalled();
    expect(jwtService.sign).not.toHaveBeenCalled();
  });

  it('uses stable local-login codes for pending, rejected, inactive, and bad-role accounts', async () => {
    const cases = [
      [
        createUserDocument({
          approval_status: ApprovalStatus.PENDING,
          is_active: false,
          is_verified: true,
        }),
        'ACCOUNT_PENDING_APPROVAL',
      ],
      [
        createUserDocument({
          approval_status: ApprovalStatus.REJECTED,
          is_active: false,
          is_verified: true,
        }),
        'ACCOUNT_REJECTED',
      ],
      [
        createUserDocument({
          approval_status: ApprovalStatus.APPROVED,
          is_active: false,
          is_verified: true,
        }),
        'ACCOUNT_INACTIVE',
      ],
      [
        createUserDocument({
          approval_status: ApprovalStatus.APPROVED,
          is_active: true,
          is_verified: true,
          role: 'supervisor',
        }),
        'ACCOUNT_ROLE_NOT_ALLOWED',
      ],
      [
        createUserDocument({
          is_active: false,
          is_verified: true,
          approval_status: undefined,
        }),
        'ACCOUNT_PENDING_APPROVAL',
      ],
    ] as const;

    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    for (const [user, code] of cases) {
      usersService.findByEmail.mockResolvedValueOnce(user);

      await expectRejectsWithCode(
        service.validateUser('user@example.com', 'P@ssword123!'),
        ForbiddenException,
        code,
      );
    }

    expect(usersService.recordSuccessfulLogin).not.toHaveBeenCalled();
    expect(jwtService.sign).not.toHaveBeenCalled();
  });

  it('records successful local login for verified active approved and legacy users', async () => {
    const approvedUser = createUserDocument({
      approval_status: ApprovalStatus.APPROVED,
      is_active: true,
      is_verified: true,
      approved_by: new Types.ObjectId(),
    });
    const updatedUser = createUserDocument({
      _id: approvedUser._id,
      last_login: new Date('2026-01-02T00:00:00.000Z'),
      refresh_token_hash: 'stored-hash',
      approved_by: new Types.ObjectId(),
    });

    usersService.findByEmail.mockResolvedValueOnce(approvedUser);
    usersService.recordSuccessfulLogin.mockResolvedValueOnce(updatedUser);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const result = await service.validateUser(
      'user@example.com',
      'P@ssword123!',
    );

    expect(usersService.recordSuccessfulLogin).toHaveBeenCalledWith(
      approvedUser._id.toString(),
    );
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('refresh_token_hash');
    expect(result).not.toHaveProperty('approved_by');
  });

  it('creates a new Google user as verified inactive incomplete pending and redirects with an exchange code', async () => {
    const createdUser = createUserDocument({
      email: 'google.user@example.com',
      password: undefined,
      google_id: 'google-123',
      is_verified: true,
      is_active: false,
      approval_status: ApprovalStatus.PENDING,
      role: Role.OPERATOR,
      profile_completed: false,
      photo: 'https://lh3.googleusercontent.com/photo.png',
    });
    const res = createRedirectResponse();

    usersService.findByGoogleId.mockResolvedValue(null);
    usersService.findByEmail.mockResolvedValue(null);
    usersService.create.mockResolvedValue(createdUser);
    usersService.recordSuccessfulLogin.mockResolvedValue(createdUser);
    jwtService.sign
      .mockReturnValueOnce('access-token')
      .mockReturnValueOnce('refresh-token');
    (bcrypt.hash as jest.Mock).mockResolvedValue('refresh-token-hash');
    userModel.findByIdAndUpdate.mockReturnValue(createQuery(null));
    googleLoginExchangeService.createExchange.mockResolvedValue(
      'exchange-code',
    );

    await service.googleLogin(
      {
        provider: 'google',
        google_id: ' google-123 ',
        email: '  Google.User@Example.COM  ',
        name: ' Google User ',
        picture: 'https://lh3.googleusercontent.com/photo.png',
        email_verified: true,
      },
      res as never,
      'en',
      'https://app.example.com',
    );

    expect(usersService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'google.user@example.com',
        google_id: 'google-123',
        role: Role.OPERATOR,
        is_verified: true,
        is_active: false,
        approval_status: ApprovalStatus.PENDING,
        profile_completed: false,
        photo: 'https://lh3.googleusercontent.com/photo.png',
      }),
    );
    expect(usersService.recordSuccessfulLogin).toHaveBeenCalledWith(
      createdUser._id.toString(),
    );
    expect(jwtService.sign).toHaveBeenCalledTimes(2);
    expect(googleLoginExchangeService.createExchange).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
      }),
    );
    expect(res.redirect).toHaveBeenCalledWith(
      'https://app.example.com/en/auth/google-result?exchange=exchange-code',
    );
    expect(res.redirect.mock.calls[0][0]).not.toContain('token=');
  });

  it('blocks existing pending, rejected, and inactive Google accounts without tokens', async () => {
    const cases = [
      [
        createUserDocument({
          google_id: 'google-pending',
          approval_status: ApprovalStatus.PENDING,
          is_verified: true,
          is_active: false,
          profile_completed: true,
          phone: '+21612345678',
          department: 'Maintenance',
          position: 'Operator',
          language: 'en',
        }),
        'pending',
      ],
      [
        createUserDocument({
          google_id: 'google-rejected',
          approval_status: ApprovalStatus.REJECTED,
          is_verified: true,
          is_active: false,
          rejection_reason: 'Not eligible',
        }),
        'rejected',
      ],
      [
        createUserDocument({
          google_id: 'google-inactive',
          approval_status: ApprovalStatus.APPROVED,
          is_verified: true,
          is_active: false,
        }),
        'inactive',
      ],
    ] as const;

    for (const [user, status] of cases) {
      const res = createRedirectResponse();
      usersService.findByGoogleId.mockResolvedValueOnce(user);
      usersService.findByEmail.mockResolvedValueOnce(user);

      await service.googleLogin(
        {
          provider: 'google',
          google_id: String(user.google_id),
          email: user.email,
          name: 'Google User',
          email_verified: true,
        },
        res as never,
        'fr',
        'https://app.example.com',
      );

      expect(res.redirect).toHaveBeenCalledWith(
        `https://app.example.com/fr/auth/google-result?status=${status}`,
      );
    }

    expect(usersService.recordSuccessfulLogin).not.toHaveBeenCalled();
    expect(jwtService.sign).not.toHaveBeenCalled();
    expect(googleLoginExchangeService.createExchange).not.toHaveBeenCalled();
  });

  it('links an existing approved local account and redirects with only an exchange code', async () => {
    const localUser = createUserDocument({
      email: 'linked@example.com',
      password: 'hashed-password',
      google_id: undefined,
      approval_status: ApprovalStatus.APPROVED,
      is_verified: true,
      is_active: true,
      role: Role.TECHNICIAN,
      photo: 'manual-photo.png',
      profile_completed: true,
      phone: '+21612345678',
      department: 'Maintenance',
      position: 'Technician',
      language: 'en',
    });
    const linkedUser = createUserDocument({
      ...localUser,
      google_id: 'google-linked',
      is_verified: true,
      photo: 'manual-photo.png',
    });
    const res = createRedirectResponse();

    usersService.findByGoogleId.mockResolvedValue(null);
    usersService.findByEmail.mockResolvedValue(localUser);
    usersService.linkGoogleIdentity.mockResolvedValue(linkedUser);
    usersService.recordSuccessfulLogin.mockResolvedValue(linkedUser);
    jwtService.sign
      .mockReturnValueOnce('access-token')
      .mockReturnValueOnce('refresh-token');
    (bcrypt.hash as jest.Mock).mockResolvedValue('refresh-token-hash');
    userModel.findByIdAndUpdate.mockReturnValue(createQuery(null));
    googleLoginExchangeService.createExchange.mockResolvedValue(
      'exchange-code',
    );

    await service.googleLogin(
      {
        provider: 'google',
        google_id: 'google-linked',
        email: ' LINKED@example.com ',
        name: 'Linked User',
        picture: 'https://lh3.googleusercontent.com/new-photo.png',
        email_verified: true,
      },
      res as never,
      'de',
      'https://app.example.com',
    );

    expect(usersService.linkGoogleIdentity).toHaveBeenCalledWith(
      localUser._id.toString(),
      'google-linked',
    );
    expect(usersService.recordSuccessfulLogin).toHaveBeenCalledTimes(1);
    expect(jwtService.sign).toHaveBeenCalledTimes(2);
    expect(googleLoginExchangeService.createExchange).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
      }),
    );
    expect(res.redirect).toHaveBeenCalledWith(
      'https://app.example.com/de/auth/google-result?exchange=exchange-code',
    );
    expect(res.redirect.mock.calls[0][0]).not.toContain('token=');
    expect(linkedUser.photo).toBe('manual-photo.png');
    expect(linkedUser.role).toBe(Role.TECHNICIAN);
    expect(linkedUser.password).toBe('hashed-password');
  });

  it('links an existing incomplete pending local account and redirects to completion exchange', async () => {
    const localUser = createUserDocument({
      google_id: undefined,
      is_verified: false,
      is_active: false,
      approval_status: ApprovalStatus.PENDING,
    });
    const linkedUser = createUserDocument({
      ...localUser,
      google_id: 'google-pending-link',
      is_verified: true,
      is_active: false,
      approval_status: ApprovalStatus.PENDING,
      profile_completed: false,
    });
    const res = createRedirectResponse();

    usersService.findByGoogleId.mockResolvedValue(null);
    usersService.findByEmail.mockResolvedValue(localUser);
    usersService.linkGoogleIdentity.mockResolvedValue(linkedUser);
    usersService.recordSuccessfulLogin.mockResolvedValue(linkedUser);
    jwtService.sign
      .mockReturnValueOnce('access-token')
      .mockReturnValueOnce('refresh-token');
    (bcrypt.hash as jest.Mock).mockResolvedValue('refresh-token-hash');
    userModel.findByIdAndUpdate.mockReturnValue(createQuery(null));
    googleLoginExchangeService.createExchange.mockResolvedValue(
      'exchange-code',
    );

    await service.googleLogin(
      {
        provider: 'google',
        google_id: 'google-pending-link',
        email: localUser.email,
        name: 'Pending User',
        email_verified: true,
      },
      res as never,
      'it',
      'https://app.example.com',
    );

    expect(usersService.linkGoogleIdentity).toHaveBeenCalledWith(
      localUser._id.toString(),
      'google-pending-link',
    );
    expect(linkedUser.is_verified).toBe(true);
    expect(linkedUser.is_active).toBe(false);
    expect(linkedUser.approval_status).toBe(ApprovalStatus.PENDING);
    expect(res.redirect).toHaveBeenCalledWith(
      'https://app.example.com/it/auth/google-result?exchange=exchange-code',
    );
    expect(jwtService.sign).toHaveBeenCalledTimes(2);
  });

  it('completes a Google profile and keeps the account pending for admin approval', async () => {
    const googleUser = createUserDocument({
      google_id: 'google-complete',
      profile_completed: false,
      is_verified: true,
      is_active: false,
      approval_status: ApprovalStatus.PENDING,
    });
    const completedUser = createUserDocument({
      _id: googleUser._id,
      email: googleUser.email,
      google_id: 'google-complete',
      phone: '+21612345678',
      role: Role.TECHNICIAN,
      department: 'Maintenance',
      position: 'Shift Lead',
      language: 'fr',
      profile_completed: true,
      is_verified: true,
      is_active: false,
      approval_status: ApprovalStatus.PENDING,
    });

    userModel.findById.mockReturnValue(createQuery(googleUser));
    userModel.findByIdAndUpdate.mockReturnValue(createQuery(completedUser));

    const result = await service.completeGoogleProfile(
      googleUser._id.toString(),
      {
        phone: '+21612345678',
        role: Role.TECHNICIAN,
        department: 'Maintenance',
        position: 'Shift Lead',
        language: 'fr',
      },
    );

    expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
      googleUser._id,
      expect.objectContaining({
        $set: expect.objectContaining({
          phone: '+21612345678',
          role: Role.TECHNICIAN,
          department: 'Maintenance',
          position: 'Shift Lead',
          language: 'fr',
          profile_completed: true,
          approval_status: ApprovalStatus.PENDING,
          is_active: false,
          is_verified: true,
        }),
      }),
      { new: true },
    );
    expect(result.code).toBe('GOOGLE_PROFILE_COMPLETED_PENDING_APPROVAL');
    expect(result.mandatoryFields).toEqual([
      'nom_complet',
      'email',
      'phone',
      'role',
      'department',
      'position',
      'language',
    ]);
    expect(result.user.profile_completed).toBe(true);
    expect(result.user.is_active).toBe(false);
    expect(result.user.approval_status).toBe(ApprovalStatus.PENDING);
  });

  it('fails safely when Google ID and normalized email point to different users', async () => {
    const googleUser = createUserDocument({
      email: 'owner@example.com',
      google_id: 'conflict-google',
    });
    const emailUser = createUserDocument({
      email: 'other@example.com',
      google_id: undefined,
    });
    const res = createRedirectResponse();

    usersService.findByGoogleId.mockResolvedValue(googleUser);
    usersService.findByEmail.mockResolvedValue(emailUser);

    await service.googleLogin(
      {
        provider: 'google',
        google_id: 'conflict-google',
        email: 'other@example.com',
        name: 'Other User',
        email_verified: true,
      },
      res as never,
      'es',
      'https://app.example.com',
    );

    expect(usersService.linkGoogleIdentity).not.toHaveBeenCalled();
    expect(usersService.create).not.toHaveBeenCalled();
    expect(jwtService.sign).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(
      'https://app.example.com/es/auth/google-result?status=failed',
    );
  });

  it('does not create a duplicate account when automatic Google linking is rejected', async () => {
    const localUser = createUserDocument({
      email: 'already-linked@example.com',
      google_id: 'different-google-id',
      password: 'hashed-password',
      is_active: true,
      is_verified: true,
      approval_status: ApprovalStatus.APPROVED,
    });
    const res = createRedirectResponse();

    usersService.findByGoogleId.mockResolvedValue(null);
    usersService.findByEmail.mockResolvedValue(localUser);
    usersService.linkGoogleIdentity.mockRejectedValue(
      new ConflictException({
        code: 'GOOGLE_ACCOUNT_ALREADY_LINKED',
        message: 'Google account cannot be linked automatically.',
      }),
    );

    await service.googleLogin(
      {
        provider: 'google',
        google_id: 'new-google-id',
        email: 'ALREADY-LINKED@example.com',
        name: 'Already Linked',
        email_verified: true,
      },
      res as never,
      'en',
      'https://app.example.com',
    );

    expect(usersService.create).not.toHaveBeenCalled();
    expect(jwtService.sign).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(
      'https://app.example.com/en/auth/google-result?status=failed',
    );
  });

  it('rejects invalid Google profiles with a safe failure redirect', async () => {
    const res = createRedirectResponse();

    await service.googleLogin(
      {
        provider: 'google',
        google_id: 'google-unverified',
        email: 'unverified@example.com',
        name: 'Unverified User',
        email_verified: false,
      },
      res as never,
      'en',
      'https://app.example.com',
    );

    expect(usersService.findByGoogleId).not.toHaveBeenCalled();
    expect(usersService.create).not.toHaveBeenCalled();
    expect(jwtService.sign).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(
      'https://app.example.com/en/auth/google-result?status=failed',
    );
  });

  it('delegates Google login exchange consumption without creating new tokens', async () => {
    const payload = {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      user: {
        _id: new Types.ObjectId(),
        nom_complet: 'Test User',
        email: 'user@example.com',
        role: Role.OPERATOR,
        is_active: true,
        created_at: new Date('2026-01-01T00:00:00.000Z'),
      },
    };
    googleLoginExchangeService.consumeExchange.mockResolvedValue(payload);

    await expect(service.exchangeGoogleLogin('exchange-code')).resolves.toBe(
      payload,
    );
    expect(googleLoginExchangeService.consumeExchange).toHaveBeenCalledWith(
      'exchange-code',
    );
    expect(jwtService.sign).not.toHaveBeenCalled();
  });

  it('logs in successfully with a sanitized plain user object', async () => {
    const plainUser = {
      _id: new Types.ObjectId(),
      email: 'plain@example.com',
      user_id: 'USER-010',
      role: 'operator',
      is_active: true,
      nom_complet: 'Plain User',
      created_at: new Date('2026-01-01T00:00:00.000Z'),
    };

    jwtService.sign
      .mockReturnValueOnce('access-token')
      .mockReturnValueOnce('refresh-token');
    (bcrypt.hash as jest.Mock).mockResolvedValue('refresh-token-hash');
    userModel.findByIdAndUpdate.mockReturnValue(
      createQuery({ acknowledged: true }),
    );

    const result = await service.login(plainUser as never);

    expect(jwtService.sign).toHaveBeenCalledTimes(2);
    expect(bcrypt.hash).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/),
      10,
    );
    expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
      plainUser._id.toString(),
      { refresh_token_hash: 'refresh-token-hash' },
      { new: true },
    );
    expect(result).toEqual({
      access_token: 'access-token',
      token: 'access-token',
      refresh_token: 'refresh-token',
      user: plainUser,
    });
  });

  it('rejects missing, malformed, wrong-type, and bad-subject refresh tokens with stable codes', async () => {
    await expectRejectsWithCode(
      service.refreshToken(''),
      UnauthorizedException,
      'REFRESH_TOKEN_MISSING',
    );

    jwtService.verify.mockImplementationOnce(() => {
      throw new Error('jwt malformed');
    });
    await expectRejectsWithCode(
      service.refreshToken('malformed-refresh'),
      UnauthorizedException,
      'REFRESH_TOKEN_INVALID_OR_EXPIRED',
    );

    jwtService.verify.mockReturnValueOnce({
      sub: new Types.ObjectId().toString(),
      type: 'access',
    });
    await expectRejectsWithCode(
      service.refreshToken('access-token'),
      UnauthorizedException,
      'REFRESH_TOKEN_WRONG_TYPE',
    );

    jwtService.verify.mockReturnValueOnce({ type: 'refresh' });
    await expectRejectsWithCode(
      service.refreshToken('missing-subject'),
      UnauthorizedException,
      'REFRESH_TOKEN_SUBJECT_INVALID',
    );

    jwtService.verify.mockReturnValueOnce({
      sub: 'not-an-object-id',
      type: 'refresh',
    });
    await expectRejectsWithCode(
      service.refreshToken('bad-subject'),
      UnauthorizedException,
      'REFRESH_TOKEN_SUBJECT_INVALID',
    );
  });

  it('validates current database account state before refresh hash rotation', async () => {
    const pendingUser = createUserDocument({
      approval_status: ApprovalStatus.PENDING,
      is_active: false,
      is_verified: true,
      refresh_token_hash: 'stored-refresh-hash',
    });
    jest.clearAllMocks();
    jwtService.verify.mockReturnValue({
      sub: pendingUser._id.toString(),
      type: 'refresh',
    });
    userModel.findById.mockReturnValue(createQuery(pendingUser));

    await expectRejectsWithCode(
      service.refreshToken('refresh-token'),
      ForbiddenException,
      'ACCOUNT_PENDING_APPROVAL',
    );

    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(userModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(jwtService.sign).not.toHaveBeenCalled();
  });

  it('returns revoked refresh errors when the stored hash is missing or mismatched', async () => {
    const user = createUserDocument({
      approval_status: ApprovalStatus.APPROVED,
      is_active: true,
      is_verified: true,
      refresh_token_hash: undefined,
    });
    jwtService.verify.mockReturnValue({
      sub: user._id.toString(),
      type: 'refresh',
    });
    userModel.findById.mockReturnValueOnce(createQuery(user));

    await expectRejectsWithCode(
      service.refreshToken('refresh-token'),
      UnauthorizedException,
      'REFRESH_TOKEN_REVOKED',
    );

    userModel.findById.mockReturnValueOnce(
      createQuery({ ...user, refresh_token_hash: 'stored-refresh-hash' }),
    );
    (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

    await expectRejectsWithCode(
      service.refreshToken('refresh-token'),
      UnauthorizedException,
      'REFRESH_TOKEN_REVOKED',
    );

    expect(userModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rotates refresh tokens atomically and uses the current database role', async () => {
    const user = createUserDocument({
      role: Role.TECHNICIAN,
      approval_status: ApprovalStatus.APPROVED,
      is_active: true,
      is_verified: true,
      refresh_token_hash: 'stored-refresh-hash',
      google_id: 'google-id',
      login_history: [new Date('2026-01-01T00:00:00.000Z')],
      approved_by: new Types.ObjectId(),
      user_id: 'USER-SECRET',
    });
    jwtService.verify.mockReturnValue({
      sub: user._id.toString(),
      type: 'refresh',
      role: Role.ADMIN,
    });
    jwtService.sign
      .mockReturnValueOnce('new-access-token')
      .mockReturnValueOnce('new-refresh-token');
    userModel.findById.mockReturnValue(createQuery(user));
    userModel.findOneAndUpdate.mockReturnValue(createQuery(user));
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.hash as jest.Mock).mockResolvedValue('new-refresh-hash');

    const result = await service.refreshToken('old-refresh-token');

    expect(jwtService.verify).toHaveBeenCalledWith('old-refresh-token', {
      secret: process.env.JWT_REFRESH_SECRET,
    });
    expect(jwtService.sign).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sub: user._id.toString(),
        role: Role.TECHNICIAN,
        type: 'access',
      }),
      expect.objectContaining({ secret: process.env.JWT_SECRET }),
    );
    expect(jwtService.sign).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sub: user._id.toString(),
        type: 'refresh',
      }),
      expect.objectContaining({ secret: process.env.JWT_REFRESH_SECRET }),
    );
    expect(bcrypt.hash).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/),
      10,
    );
    expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: user._id,
        refresh_token_hash: 'stored-refresh-hash',
      },
      {
        $set: {
          refresh_token_hash: 'new-refresh-hash',
        },
      },
      { new: true },
    );
    expect(result.access_token).toBe('new-access-token');
    expect(result.refresh_token).toBe('new-refresh-token');
    expect(result.user).not.toHaveProperty('password');
    expect(result.user).not.toHaveProperty('refresh_token_hash');
    expect(result.user).not.toHaveProperty('google_id');
    expect(result.user).not.toHaveProperty('user_id');
    expect(result.user).not.toHaveProperty('login_history');
    expect(usersService.recordSuccessfulLogin).not.toHaveBeenCalled();
  });

  it('rejects a concurrent refresh when atomic hash replacement loses the race', async () => {
    const user = createUserDocument({
      approval_status: ApprovalStatus.APPROVED,
      is_active: true,
      is_verified: true,
      refresh_token_hash: 'stored-refresh-hash',
    });
    jwtService.verify.mockReturnValue({
      sub: user._id.toString(),
      type: 'refresh',
    });
    jwtService.sign
      .mockReturnValueOnce('new-access-token')
      .mockReturnValueOnce('new-refresh-token');
    userModel.findById.mockReturnValue(createQuery(user));
    userModel.findOneAndUpdate.mockReturnValue(createQuery(null));
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.hash as jest.Mock).mockResolvedValue('new-refresh-hash');

    await expectRejectsWithCode(
      service.refreshToken('old-refresh-token'),
      UnauthorizedException,
      'REFRESH_TOKEN_REUSE_DETECTED',
    );
  });

  it('stores hashed reset token and sends reset email link', async () => {
    const user = createUserDocument({
      email: 'reset@example.com',
    });

    usersService.findByEmail.mockResolvedValue(user);
    userModel.findByIdAndUpdate.mockReturnValue(
      createQuery({ acknowledged: true }),
    );
    notificationsFacade.sendResetPasswordEmail.mockResolvedValue('preview-url');

    const result = await service.forgotPassword('reset@example.com');

    expect(userModel.findByIdAndUpdate).toHaveBeenCalledTimes(1);

    const updateCall = userModel.findByIdAndUpdate.mock.calls[0] as [
      string,
      { reset_password_token: string; reset_password_expires: Date },
      { new: boolean },
    ];

    expect(updateCall[0]).toBe(user._id.toString());
    expect(updateCall[1].reset_password_token).toMatch(/^[a-f0-9]{64}$/);
    expect(updateCall[1].reset_password_expires).toBeInstanceOf(Date);
    expect(updateCall[2]).toEqual({ new: true });

    expect(notificationsFacade.sendResetPasswordEmail).toHaveBeenCalledTimes(1);

    const sendResetCall = notificationsFacade.sendResetPasswordEmail.mock
      .calls[0] as [
      {
        to: string;
        resetToken: string;
        locale?: string;
        frontendOrigin?: string;
      },
    ];

    expect(sendResetCall[0].to).toBe('reset@example.com');
    expect(sendResetCall[0].resetToken).toMatch(/^[a-f0-9]{64}$/);
    expect(result).toEqual(
      expect.objectContaining({
        message:
          'If an account exists with that email, a password reset link has been sent.',
        previewUrl: 'preview-url',
      }),
    );
  });

  it('returns generic forgot-password response when email does not exist', async () => {
    usersService.findByEmail.mockResolvedValue(null);

    const result = await service.forgotPassword('missing@example.com');

    expect(userModel.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(notificationsFacade.sendResetPasswordEmail).not.toHaveBeenCalled();
    expect(result).toEqual({
      message:
        'If an account exists with that email, a password reset link has been sent.',
    });
  });

  it('returns generic forgot-password response when reset email delivery fails', async () => {
    const user = createUserDocument({
      email: 'reset-fail@example.com',
    });

    usersService.findByEmail.mockResolvedValue(user);
    userModel.findByIdAndUpdate.mockReturnValue(
      createQuery({ acknowledged: true }),
    );
    notificationsFacade.sendResetPasswordEmail.mockRejectedValue(
      new Error('smtp failed'),
    );

    const result = await service.forgotPassword('reset-fail@example.com');

    expect(userModel.findByIdAndUpdate).toHaveBeenCalledTimes(1);
    expect(notificationsFacade.sendResetPasswordEmail).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      message:
        'If an account exists with that email, a password reset link has been sent.',
    });
  });

  it('verifies reset token when token hash matches and token is not expired', async () => {
    userModel.findOne.mockReturnValueOnce(createQuery(createUserDocument()));

    const result = await service.verifyResetToken('plain-reset-token');

    expect(userModel.findOne).toHaveBeenCalledTimes(1);
    const findOneCall = userModel.findOne.mock.calls[0] as [
      { reset_password_token: string; reset_password_expires: { $gt: Date } },
    ];

    expect(findOneCall[0].reset_password_token).toMatch(/^[a-f0-9]{64}$/);
    expect(findOneCall[0].reset_password_expires.$gt).toBeInstanceOf(Date);
    expect(result).toEqual({ message: 'Reset token is valid' });
  });

  it('rejects invalid reset token during verification', async () => {
    userModel.findOne.mockReturnValueOnce(createQuery(null));

    await expect(service.verifyResetToken('bad-token')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(userModel.findOne).toHaveBeenCalledTimes(1);
    expect(featureFlags.isLegacyResetTokensEnabled).toHaveBeenCalledTimes(1);
  });

  it('uses plaintext reset-token compatibility only when explicitly enabled', async () => {
    featureFlags.isLegacyResetTokensEnabled.mockReturnValue(true);
    userModel.findOne
      .mockReturnValueOnce(createQuery(null))
      .mockReturnValueOnce(createQuery(createUserDocument()));

    const result = await service.verifyResetToken('legacy-reset-token');

    expect(result).toEqual({ message: 'Reset token is valid' });
    expect(userModel.findOne).toHaveBeenCalledTimes(2);
    expect(userModel.findOne.mock.calls[0][0].reset_password_token).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(userModel.findOne.mock.calls[1][0]).toEqual({
      reset_password_token: 'legacy-reset-token',
      reset_password_expires: { $gt: expect.any(Date) },
    });
  });

  it('rejects expired legacy reset tokens during temporary migration mode', async () => {
    featureFlags.isLegacyResetTokensEnabled.mockReturnValue(true);
    userModel.findOne
      .mockReturnValueOnce(createQuery(null))
      .mockReturnValueOnce(createQuery(null));

    await expect(
      service.verifyResetToken('expired-legacy-token'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(userModel.findOne).toHaveBeenCalledTimes(2);
    expect(userModel.findOne.mock.calls[1][0]).toEqual({
      reset_password_token: 'expired-legacy-token',
      reset_password_expires: { $gt: expect.any(Date) },
    });
  });

  it('resets password, clears reset token, and revokes refresh token', async () => {
    const user = createUserDocument();

    userModel.findOne.mockReturnValueOnce(createQuery(user));
    (bcrypt.hash as jest.Mock).mockResolvedValue('new-password-hash');
    userModel.findByIdAndUpdate.mockReturnValue(
      createQuery({ acknowledged: true }),
    );

    const result = await service.resetPassword({
      token: 'plain-reset-token',
      password: 'P@ssword123!',
    });

    expect(bcrypt.hash).toHaveBeenCalledWith('P@ssword123!', 10);
    expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
      user._id.toString(),
      {
        password: 'new-password-hash',
        reset_password_token: null,
        reset_password_expires: null,
        refresh_token_hash: null,
      },
      { new: true },
    );
    expect(result).toEqual({ message: 'Password has been reset successfully' });
  });

  it('rejects reset password when token is invalid or expired', async () => {
    userModel.findOne.mockReturnValueOnce(createQuery(null));

    await expect(
      service.resetPassword({
        token: 'expired-token',
        password: 'P@ssword123!',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(userModel.findOne).toHaveBeenCalledTimes(1);
  });
});
