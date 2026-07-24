import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';

import {
  GoogleLoginExchange,
  GoogleLoginExchangeDocument,
} from './schemas/google-login-exchange.schema';
import type { LoginResult, UserWithoutSensitiveData } from './auth.service';

export type GoogleLoginExchangePayload = {
  access_token: string;
  refresh_token: string;
  user: UserWithoutSensitiveData;
};

const GOOGLE_LOGIN_EXCHANGE_TTL_MS = 2 * 60 * 1000;

@Injectable()
export class GoogleLoginExchangeService {
  constructor(
    @InjectModel(GoogleLoginExchange.name)
    private readonly exchangeModel: Model<GoogleLoginExchangeDocument>,
    private readonly configService: ConfigService,
  ) {}

  async createExchange(loginResult: LoginResult): Promise<string> {
    const code = crypto.randomBytes(32).toString('base64url');
    const codeHash = this.hashCode(code);
    const expiresAt = new Date(Date.now() + GOOGLE_LOGIN_EXCHANGE_TTL_MS);
    const payload: GoogleLoginExchangePayload = {
      access_token: loginResult.access_token,
      refresh_token: loginResult.refresh_token,
      user: this.sanitizeUser(loginResult.user),
    };
    const encryptedPayload = this.encryptPayload(payload);

    await this.exchangeModel.create({
      code_hash: codeHash,
      encrypted_payload: encryptedPayload.ciphertext,
      encryption_iv: encryptedPayload.iv,
      encryption_tag: encryptedPayload.tag,
      expires_at: expiresAt,
    });

    return code;
  }

  async consumeExchange(code: string): Promise<GoogleLoginExchangePayload> {
    if (!code?.trim()) {
      this.throwInvalidOrExpired();
    }

    const codeHash = this.hashCode(code.trim());
    const exchange = await this.exchangeModel
      .findOneAndDelete({
        code_hash: codeHash,
        expires_at: { $gt: new Date() },
      })
      .exec();

    if (!exchange) {
      this.throwInvalidOrExpired();
    }

    return this.sanitizePayload(this.decryptPayload(exchange));
  }

  private hashCode(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }

  private encryptPayload(payload: GoogleLoginExchangePayload): {
    ciphertext: string;
    iv: string;
    tag: string;
  } {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      this.getEncryptionKey(),
      iv,
    );
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
    ]);

    return {
      ciphertext: ciphertext.toString('base64url'),
      iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
    };
  }

  private decryptPayload(exchange: GoogleLoginExchangeDocument): unknown {
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.getEncryptionKey(),
        Buffer.from(exchange.encryption_iv, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(exchange.encryption_tag, 'base64url'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(exchange.encrypted_payload, 'base64url')),
        decipher.final(),
      ]).toString('utf8');

      return JSON.parse(plaintext);
    } catch {
      this.throwInvalidOrExpired();
    }
  }

  private getEncryptionKey(): Buffer {
    const configuredKey = this.configService
      .get<string>('GOOGLE_LOGIN_EXCHANGE_ENCRYPTION_KEY')
      ?.trim();
    const source =
      configuredKey ||
      this.configService.get<string>('JWT_REFRESH_SECRET')?.trim() ||
      this.configService.get<string>('JWT_SECRET')?.trim() ||
      'test-google-login-exchange-encryption-key';

    try {
      const decoded = Buffer.from(source, 'base64');
      if (decoded.length === 32) {
        return decoded;
      }
    } catch {
      // Fall through to deterministic key derivation for non-base64 values.
    }

    return crypto.createHash('sha256').update(source).digest();
  }

  private sanitizePayload(payload: unknown): GoogleLoginExchangePayload {
    const candidate = payload as Partial<GoogleLoginExchangePayload>;

    if (
      typeof candidate.access_token !== 'string' ||
      typeof candidate.refresh_token !== 'string' ||
      !candidate.user
    ) {
      this.throwInvalidOrExpired();
    }

    return {
      access_token: candidate.access_token,
      refresh_token: candidate.refresh_token,
      user: this.sanitizeUser(candidate.user),
    };
  }

  private sanitizeUser(
    user: UserWithoutSensitiveData,
  ): UserWithoutSensitiveData {
    const safeUser = { ...user } as Record<string, unknown>;
    delete safeUser.password;
    delete safeUser.refresh_token_hash;
    delete safeUser.google_id;
    delete safeUser.approved_by;
    delete safeUser.rejected_by;
    delete safeUser.reset_password_token;
    delete safeUser.reset_password_expires;
    delete safeUser.login_history;
    delete safeUser.user_id;

    return safeUser as unknown as UserWithoutSensitiveData;
  }

  private throwInvalidOrExpired(): never {
    throw new UnauthorizedException({
      code: 'GOOGLE_LOGIN_EXCHANGE_INVALID_OR_EXPIRED',
      message: 'Google sign-in link is invalid or has expired.',
    });
  }
}
