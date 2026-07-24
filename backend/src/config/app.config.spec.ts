import { ConfigService } from '@nestjs/config';
import { AppConfigService } from './app.config';
import { UrlBuilderService } from '../notifications/url-builder.service';

function createConfig(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('frontend URL configuration', () => {
  it('uses the local FRONTEND_URL before a production APP_URL', () => {
    const config = new AppConfigService(
      createConfig({
        FRONTEND_URL: 'http://localhost:3000',
        APP_URL: 'https://app.example.com',
      }),
    );

    expect(config.getFrontendBaseUrl()).toBe('http://localhost:3000');
  });

  it('uses the configured production frontend base URL', () => {
    const config = new AppConfigService(
      createConfig({
        FRONTEND_BASE_URL: 'https://app.example.com',
        CORS_ORIGINS: 'https://app.example.com',
        DEFAULT_LOCALE: 'en',
      }),
    );
    const urls = new UrlBuilderService(config);

    expect(urls.verificationEmailUrl('token/value', 'fr')).toBe(
      'https://app.example.com/fr/auth/verify-email?token=token%2Fvalue',
    );
  });

  it('accepts an allowed local request origin and rejects an unknown origin', () => {
    const config = new AppConfigService(
      createConfig({
        FRONTEND_BASE_URL: 'https://app.example.com',
        CORS_ORIGINS: 'http://localhost:3000,https://app.example.com',
      }),
    );

    expect(
      config.resolveFrontendBaseUrl('http://localhost:3000/register'),
    ).toBe('http://localhost:3000');
    expect(config.resolveFrontendBaseUrl('https://attacker.example')).toBe(
      'https://app.example.com',
    );
  });
});
