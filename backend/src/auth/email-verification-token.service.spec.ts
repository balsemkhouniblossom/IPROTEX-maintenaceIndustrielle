import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EmailVerificationTokenService } from './email-verification-token.service';
import { FeatureFlagsConfigService } from '../config/feature-flags.config';

describe('EmailVerificationTokenService', () => {
  let service: EmailVerificationTokenService;
  let jwtService: { sign: jest.Mock; verify: jest.Mock };
  let configService: { get: jest.Mock };
  let featureFlags: { isLegacyEmailTokensEnabled: jest.Mock };

  beforeEach(() => {
    jwtService = {
      sign: jest.fn(),
      verify: jest.fn(),
    };
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'EMAIL_VERIFICATION_SECRET') return 'email-secret';
        if (key === 'JWT_SECRET') return 'legacy-jwt-secret';
        return undefined;
      }),
    };
    featureFlags = {
      isLegacyEmailTokensEnabled: jest.fn().mockReturnValue(false),
    };

    service = new EmailVerificationTokenService(
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
      featureFlags as unknown as FeatureFlagsConfigService,
    );
  });

  it('verifies current purpose-scoped hashed email tokens', () => {
    jwtService.verify.mockReturnValue({
      userId: 'user-1',
      purpose: 'email_verification',
    });

    expect(service.verifyToken('current-token')).toEqual({ userId: 'user-1' });
    expect(jwtService.verify).toHaveBeenCalledWith('current-token', {
      secret: 'email-secret',
    });
  });

  it('rejects current tokens with the wrong purpose', () => {
    jwtService.verify.mockReturnValue({
      userId: 'user-1',
      purpose: 'password_reset',
    });

    expect(service.verifyToken('wrong-purpose-token')).toEqual({});
  });

  it('keeps legacy email-token fallback disabled by default', () => {
    jwtService.verify
      .mockImplementationOnce(() => {
        throw new Error('invalid current token');
      })
      .mockReturnValueOnce({ userId: 'legacy-user' });

    expect(service.verifyToken('legacy-token')).toEqual({});
    expect(featureFlags.isLegacyEmailTokensEnabled).toHaveBeenCalledTimes(1);
    expect(jwtService.verify).toHaveBeenCalledTimes(1);
  });

  it('accepts legacy email tokens only during temporary migration mode', () => {
    featureFlags.isLegacyEmailTokensEnabled.mockReturnValue(true);
    jwtService.verify
      .mockImplementationOnce(() => {
        throw new Error('invalid current token');
      })
      .mockReturnValueOnce({ userId: 'legacy-user' });

    expect(service.verifyToken('legacy-token')).toEqual({
      userId: 'legacy-user',
    });
    expect(jwtService.verify).toHaveBeenCalledTimes(2);
    expect(jwtService.verify.mock.calls[1]).toEqual([
      'legacy-token',
      { secret: 'legacy-jwt-secret' },
    ]);
  });

  it('rejects expired legacy email tokens during temporary migration mode', () => {
    featureFlags.isLegacyEmailTokensEnabled.mockReturnValue(true);
    jwtService.verify.mockImplementation(() => {
      throw new Error('expired token');
    });

    expect(service.verifyToken('expired-legacy-token')).toEqual({});
    expect(jwtService.verify).toHaveBeenCalledTimes(2);
  });
});
