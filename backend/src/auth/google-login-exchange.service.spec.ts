import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';

import { GoogleLoginExchangeService } from './google-login-exchange.service';
import { GoogleLoginExchange } from './schemas/google-login-exchange.schema';
import { Role } from '../schemas/user.schema';

type CreatedExchange = {
  code_hash: string;
  encrypted_payload: string;
  encryption_iv: string;
  encryption_tag: string;
  expires_at: Date;
};

type ConsumeExchangeQuery = {
  code_hash: string;
  expires_at: { $gt: Date };
};

type QueryLike<T> = {
  exec: jest.Mock<Promise<T>, []>;
};

function createQuery<T>(result: T): QueryLike<T> {
  return {
    exec: jest.fn<Promise<T>, []>().mockResolvedValue(result),
  };
}

describe('GoogleLoginExchangeService', () => {
  let service: GoogleLoginExchangeService;
  let exchangeModel: {
    create: jest.Mock<Promise<unknown>, [CreatedExchange]>;
    findOneAndDelete: jest.Mock<QueryLike<unknown>, [ConsumeExchangeQuery]>;
  };
  let createdExchange!: CreatedExchange;

  beforeEach(async () => {
    exchangeModel = {
      create: jest.fn<Promise<unknown>, [CreatedExchange]>().mockImplementation(
        (document) => {
          createdExchange = document;
          return Promise.resolve(document);
        },
      ),
      findOneAndDelete: jest.fn<QueryLike<unknown>, [ConsumeExchangeQuery]>(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleLoginExchangeService,
        {
          provide: getModelToken(GoogleLoginExchange.name),
          useValue: exchangeModel,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'GOOGLE_LOGIN_EXCHANGE_ENCRYPTION_KEY'
                ? 'test-google-login-exchange-key-32'
                : undefined,
            ),
          },
        },
      ],
    }).compile();

    service = module.get(GoogleLoginExchangeService);
  });

  it('creates a short-lived random exchange while storing only a hash', async () => {
    const code = await service.createExchange({
      access_token: 'access-token',
      token: 'access-token',
      refresh_token: 'refresh-token',
      user: {
        _id: new Types.ObjectId(),
        user_id: 'USER-001',
        nom_complet: 'Google User',
        email: 'google@example.com',
        role: Role.OPERATOR,
        is_active: true,
        created_at: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createdExchange.code_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(createdExchange.code_hash).not.toBe(code);
    expect(createdExchange.encrypted_payload).toEqual(expect.any(String));
    expect(createdExchange.encryption_iv).toEqual(expect.any(String));
    expect(createdExchange.encryption_tag).toEqual(expect.any(String));
    expect(createdExchange.expires_at).toBeInstanceOf(Date);
    expect(
      createdExchange.expires_at.getTime() - Date.now(),
    ).toBeLessThanOrEqual(2 * 60 * 1000);
    const storedRecord = JSON.stringify(createdExchange);
    expect(storedRecord).not.toContain('access-token');
    expect(storedRecord).not.toContain('refresh-token');
    expect(storedRecord).not.toContain('Google User');
    expect(storedRecord).not.toContain('USER-001');
  });

  it('atomically consumes a valid encrypted exchange and returns the stored session once', async () => {
    const code = await service.createExchange({
      access_token: 'access-token',
      token: 'access-token',
      refresh_token: 'refresh-token',
      user: {
        _id: new Types.ObjectId(),
        nom_complet: 'Google User',
        email: 'google@example.com',
        role: Role.OPERATOR,
        is_active: true,
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        ...( {
          password: 'hidden',
          google_id: 'google-123',
          refresh_token_hash: 'hidden',
        } as Record<string, unknown>),
      },
    });
    const exchange = {
      ...createdExchange,
    };

    exchangeModel.findOneAndDelete.mockReturnValueOnce(createQuery(exchange));
    exchangeModel.findOneAndDelete.mockReturnValueOnce(createQuery(null));

    const result = await service.consumeExchange(code);

    const consumeQuery = exchangeModel.findOneAndDelete.mock.calls[0][0];
    expect(consumeQuery.code_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(consumeQuery.expires_at.$gt).toBeInstanceOf(Date);
    expect(result).toEqual(
      expect.objectContaining({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
      }),
    );
    expect(result.user).not.toHaveProperty('password');
    expect(result.user).not.toHaveProperty('google_id');

    await expect(service.consumeExchange(code)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects malformed, unknown, and expired exchange codes with a stable code', async () => {
    exchangeModel.findOneAndDelete.mockReturnValue(createQuery(null));

    await expect(service.consumeExchange('')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      service.consumeExchange('missing-code'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects malformed encrypted exchange records without exposing token material', async () => {
    exchangeModel.findOneAndDelete.mockReturnValue(
      createQuery({
        encrypted_payload: 'not-valid-base64',
        encryption_iv: 'bad-iv',
        encryption_tag: 'bad-tag',
      }),
    );

    await expect(
      service.consumeExchange('malformed-code'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
