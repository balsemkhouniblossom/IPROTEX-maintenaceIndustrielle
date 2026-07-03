import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
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
import { User } from '../schemas/user.schema';
import { ConfigService } from '@nestjs/config';
import { EmailVerificationTokenService } from './email-verification-token.service';
import { AppConfigService } from '../config/app.config';

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
    create: jest.Mock;
    update: jest.Mock;
    findOne: jest.Mock;
    findByResetToken: jest.Mock;
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
  let emailVerificationTokenService: {
    issueToken: jest.Mock;
    verifyToken: jest.Mock;
  };
  let userModel: {
    findById: jest.Mock;
    findByIdAndUpdate: jest.Mock;
    findByIdAndDelete: jest.Mock;
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
      create: jest.fn(),
      update: jest.fn(),
      findOne: jest.fn(),
      findByResetToken: jest.fn(),
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

    userModel = {
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      findByIdAndDelete: jest.fn(),
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
        { provide: getModelToken(User.name), useValue: userModel },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers a new user and sends a verification email', async () => {
    const createdUser = createUserDocument({
      email: 'new.user@example.com',
      user_id: 'USER-002',
      is_active: false,
      is_verified: false,
      password: 'hashed-password',
      nom_complet: 'New User',
    });

    usersService.findByEmail.mockResolvedValue(null);
    usersService.create.mockResolvedValue(createdUser);
    emailVerificationTokenService.issueToken.mockReturnValue(
      'verification-token',
    );
    notificationsFacade.sendVerificationEmail.mockResolvedValue(undefined);

    await expect(
      service.register({
        nom_complet: 'New User',
        email: 'new.user@example.com',
        password: 'P@ssword123!',
        role: 'operator',
        phone: '+21612345678',
        department: 'Maintenance',
      } as never),
    ).resolves.toEqual(
      expect.objectContaining({ email: 'new.user@example.com' }),
    );

    expect(usersService.findByEmail).toHaveBeenCalledWith(
      'new.user@example.com',
    );
    expect(usersService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'new.user@example.com',
        nom_complet: 'New User',
      }),
    );
    expect(emailVerificationTokenService.issueToken).toHaveBeenCalledWith(
      createdUser._id.toString(),
    );
    expect(notificationsFacade.sendVerificationEmail).toHaveBeenCalledWith({
      to: 'new.user@example.com',
      token: 'verification-token',
    });
  });

  it('rolls back registration when verification email sending fails', async () => {
    const createdUserId = new Types.ObjectId();
    const createdUser = createUserDocument({
      _id: createdUserId,
      email: 'rollback@example.com',
      user_id: 'USER-003',
      is_active: false,
      is_verified: false,
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
        role: 'operator',
        phone: '+21612345678',
        department: 'Maintenance',
      } as never),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(userModel.findByIdAndDelete).toHaveBeenCalledWith(createdUserId);
  });

  it('verifies an email with a valid token', async () => {
    const userId = new Types.ObjectId();

    emailVerificationTokenService.verifyToken.mockReturnValue({
      userId: userId.toString(),
    });
    userModel.findById.mockReturnValue(
      createQuery({
        _id: userId,
        is_verified: false,
      }),
    );
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
        is_active: true,
      },
    );
    expect(result).toEqual({ message: 'Email verified successfully' });
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

  it('blocks login until the account is verified', async () => {
    const unverifiedUser = createUserDocument({
      is_active: true,
      is_verified: false,
      password: 'hashed-password',
    });

    usersService.findByEmail.mockResolvedValue(unverifiedUser);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    await expect(
      service.validateUser('user@example.com', 'P@ssword123!'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(usersService.update).not.toHaveBeenCalled();
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
    userModel.findOne
      .mockReturnValueOnce(createQuery(null))
      .mockReturnValueOnce(createQuery(null));

    await expect(service.verifyResetToken('bad-token')).rejects.toBeInstanceOf(
      BadRequestException,
    );
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
    userModel.findOne
      .mockReturnValueOnce(createQuery(null))
      .mockReturnValueOnce(createQuery(null));

    await expect(
      service.resetPassword({
        token: 'expired-token',
        password: 'P@ssword123!',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
