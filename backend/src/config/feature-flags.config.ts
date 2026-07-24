import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

@Injectable()
export class FeatureFlagsConfigService {
  constructor(private readonly configService: ConfigService) {}

  isLegacyEmailTokensEnabled(): boolean {
    return parseBoolean(
      this.configService.get<string>('ENABLE_LEGACY_EMAIL_TOKENS'),
      false,
    );
  }

  isLegacyResetTokensEnabled(): boolean {
    return parseBoolean(
      this.configService.get<string>('ENABLE_LEGACY_RESET_TOKENS'),
      false,
    );
  }

  isEventBasedEmailsEnabled(): boolean {
    return parseBoolean(
      this.configService.get<string>('ENABLE_EVENT_BASED_EMAILS'),
      false,
    );
  }
}
