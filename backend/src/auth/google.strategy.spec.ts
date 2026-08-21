import { GoogleStrategy } from './google.strategy';

describe('GoogleStrategy', () => {
  function config(values: Record<string, string | undefined>) {
    return {
      get: jest.fn((key: string) => values[key]),
    };
  }

  it('normalizes quoted Google env values and builds the callback URL fallback', () => {
    const strategy = new GoogleStrategy(
      config({
        GOOGLE_CLIENT_ID: ' "client-id" ',
        GOOGLE_CLIENT_SECRET: "'client-secret'",
        BACKEND_URL: ' https://api.example.test ',
      }) as never,
    );

    expect(strategy).toBeDefined();
  });

  it('requires a real Google client id and secret', () => {
    expect(
      () =>
        new GoogleStrategy(
          config({
            GOOGLE_CLIENT_ID: 'google-client-id-not-configured',
            GOOGLE_CLIENT_SECRET: 'client-secret',
          }) as never,
        ),
    ).toThrow('Invalid value for environment variable: GOOGLE_CLIENT_ID');

    expect(
      () =>
        new GoogleStrategy(
          config({
            GOOGLE_CLIENT_ID: 'client-id',
            GOOGLE_CLIENT_SECRET: '',
          }) as never,
        ),
    ).toThrow('Missing required environment variable: GOOGLE_CLIENT_SECRET');
  });

  it('maps a Google profile to the internal auth profile', () => {
    const strategy = new GoogleStrategy(
      config({
        GOOGLE_CLIENT_ID: 'client-id',
        GOOGLE_CLIENT_SECRET: 'client-secret',
        GOOGLE_CALLBACK_URL: 'https://api.example.test/auth/google/callback',
      }) as never,
    );

    expect(
      strategy.validate('', '', {
        provider: 'google',
        id: 'google-id',
        displayName: 'Ada Admin',
        emails: [{ value: 'ada@example.test' }],
        photos: [{ value: 'https://example.test/ada.png' }],
        _json: { email_verified: true },
      }),
    ).toEqual({
      provider: 'google',
      google_id: 'google-id',
      email: 'ada@example.test',
      name: 'Ada Admin',
      picture: 'https://example.test/ada.png',
      email_verified: true,
    });
  });

  it('falls back to the email as display name and rejects profiles without email', () => {
    const strategy = new GoogleStrategy(
      config({
        GOOGLE_CLIENT_ID: 'client-id',
        GOOGLE_CLIENT_SECRET: 'client-secret',
      }) as never,
    );

    expect(
      strategy.validate('', '', {
        emails: [{ value: 'fallback@example.test' }],
      }),
    ).toMatchObject({
      email: 'fallback@example.test',
      name: 'fallback@example.test',
    });

    expect(() => strategy.validate('', '', {})).toThrow(
      'Google account email is missing from profile payload',
    );
  });
});
