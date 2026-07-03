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

function normalizeGoogleEnv(value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  // Some hosts store env values with wrapping quotes; strip only outer quotes.
  return trimmed.replace(/^['\"]|['\"]$/g, '');
}

function requireGoogleEnv(key: string, value: string): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  if (
    value === 'google-client-id-not-configured' ||
    value === 'google-client-secret-not-configured'
  ) {
    throw new Error(`Invalid value for environment variable: ${key}`);
  }

  return value;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(
  GoogleOAuthStrategy,
  'google',
) {
  constructor(configService: ConfigService) {
    const googleClientId = requireGoogleEnv(
      'GOOGLE_CLIENT_ID',
      normalizeGoogleEnv(configService.get<string>('GOOGLE_CLIENT_ID')),
    );
    const googleClientSecret = requireGoogleEnv(
      'GOOGLE_CLIENT_SECRET',
      normalizeGoogleEnv(configService.get<string>('GOOGLE_CLIENT_SECRET')),
    );

    const callbackUrl =
      normalizeGoogleEnv(configService.get<string>('GOOGLE_CALLBACK_URL')) ||
      `${configService.get<string>('BACKEND_URL')?.trim() ?? 'http://localhost:3001'}/auth/google/callback`;

    super({
      clientID: googleClientId,
      clientSecret: googleClientSecret,
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
