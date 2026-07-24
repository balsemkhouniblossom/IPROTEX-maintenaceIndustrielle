import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService) {}

  getFrontendBaseUrl(): string {
    return (
      this.configService.get<string>('FRONTEND_BASE_URL') ??
      this.configService.get<string>('FRONTEND_URL') ??
      this.configService.get<string>('APP_URL') ??
      this.configService.get<string>('RENDER_EXTERNAL_URL') ??
      'http://localhost:3000'
    );
  }

  resolveFrontendBaseUrl(overrideOrigin?: string): string {
    const fallback = this.getFrontendBaseUrl();

    if (!overrideOrigin?.trim()) {
      return fallback;
    }

    const normalizedOrigin = this.normalizeOrigin(overrideOrigin);
    if (!normalizedOrigin) {
      return fallback;
    }

    const configuredOrigins = this.parseConfiguredCorsOrigins();
    const isAllowed = configuredOrigins.some((entry) =>
      this.matchesCorsEntry(normalizedOrigin, entry),
    );

    return isAllowed ? normalizedOrigin : fallback;
  }

  getDefaultLocale(): string {
    return this.configService.get<string>('DEFAULT_LOCALE') ?? 'en';
  }

  private normalizeOrigin(value: string): string | null {
    try {
      const normalized = value.includes('://') ? value : `http://${value}`;
      const parsed = new URL(normalized);
      return parsed.origin;
    } catch {
      return null;
    }
  }

  private parseConfiguredCorsOrigins(): string[] {
    const fallback = [this.getFrontendBaseUrl(), 'http://localhost:3000'];

    const configured = this.configService.get<string>('CORS_ORIGINS');
    if (!configured?.trim()) {
      return fallback;
    }

    return configured
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  private matchesCorsEntry(origin: string, entry: string): boolean {
    if (!entry.includes('*')) {
      return origin === entry;
    }

    const pattern = entry
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');

    return new RegExp(`^${pattern}$`).test(origin);
  }
}
