import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import googleOAuth20 from 'passport-google-oauth20';
import type { GoogleUserProfile } from './auth.service';

type StrategyConstructor = new (...args: unknown[]) => object;

type GoogleOAuthProfile = {
  id?: string;
  displayName?: string;
  emails?: Array<{ value?: string }>;
  photos?: Array<{ value?: string }>;
};

const GoogleOAuthStrategy = (googleOAuth20 as { Strategy: StrategyConstructor })
  .Strategy;

@Injectable()
export class GoogleStrategy extends PassportStrategy(
  GoogleOAuthStrategy,
  'google',
) {
  constructor(configService: ConfigService) {
    const callbackUrl =
      configService.get<string>('GOOGLE_CALLBACK_URL')?.trim() ||
      `${configService.get<string>('BACKEND_URL')?.trim() ?? 'http://localhost:3001'}/auth/google/callback`;

    super({
      clientID:
        configService.get<string>('GOOGLE_CLIENT_ID')?.trim() ??
        'google-client-id-not-configured',
      clientSecret:
        configService.get<string>('GOOGLE_CLIENT_SECRET')?.trim() ??
        'google-client-secret-not-configured',
      callbackURL: callbackUrl,
      scope: ['profile', 'email'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: GoogleOAuthProfile,
  ): GoogleUserProfile {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      throw new Error('Google account email is missing from profile payload');
    }

    return {
      google_id: profile.id,
      email,
      name: profile.displayName ?? email,
      picture: profile.photos?.[0]?.value,
    };
  }
}
