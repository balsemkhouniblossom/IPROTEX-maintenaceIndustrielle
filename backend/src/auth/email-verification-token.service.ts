import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { FeatureFlagsConfigService } from '../config/feature-flags.config';

interface VerificationTokenPayload {
  userId?: string;
  purpose?: string;
}

@Injectable()
export class EmailVerificationTokenService {
  private readonly logger = new Logger(EmailVerificationTokenService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly featureFlags: FeatureFlagsConfigService,
  ) {}

  issueToken(userId: string): string {
    const secret = this.getEmailVerificationSecret();
    return this.jwtService.sign(
      {
        userId,
        purpose: 'email_verification',
      },
      {
        secret,
        expiresIn: '1d',
      },
    );
  }

  verifyToken(token: string): { userId?: string } {
    try {
      const payload = this.jwtService.verify<VerificationTokenPayload>(token, {
        secret: this.getEmailVerificationSecret(),
      });

      if (payload.purpose !== 'email_verification') {
        return {};
      }

      return { userId: payload.userId };
    } catch {
      if (!this.featureFlags.isLegacyEmailTokensEnabled()) {
        return {};
      }

      try {
        const payload = this.jwtService.verify<VerificationTokenPayload>(
          token,
          {
            secret: this.getLegacySecret(),
          },
        );

        if (payload.userId) {
          this.logger.warn(
            `Legacy verification token accepted for user ${payload.userId}`,
          );
        }

        return { userId: payload.userId };
      } catch {
        return {};
      }
    }
  }

  private getEmailVerificationSecret(): string {
    return (
      this.configService.get<string>('EMAIL_VERIFICATION_SECRET') ??
      this.getLegacySecret()
    );
  }

  private getLegacySecret(): string {
    return this.configService.get<string>('JWT_SECRET') ?? '';
  }
}
