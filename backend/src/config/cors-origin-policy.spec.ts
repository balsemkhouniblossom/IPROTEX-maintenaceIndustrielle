import {
  buildCorsOriginDelegate,
  isAllowedCorsOrigin,
  parseConfiguredCorsOrigin,
} from './cors-origin-policy';

function checkDelegate(
  origin: string | undefined,
  allowOriginless: boolean,
): Promise<boolean | undefined> {
  const delegate = buildCorsOriginDelegate(
    ['https://pfe-maintenace-industrielle.vercel.app'],
    { allowOriginless },
  );
  return new Promise((resolve, reject) => {
    delegate(origin, (error, allowed) => {
      if (error) reject(error);
      else resolve(allowed);
    });
  });
}

describe('CORS origin policy', () => {
  it('accepts the configured Vercel production origin and normalizes trailing slashes', () => {
    const allowed = ['https://pfe-maintenace-industrielle.vercel.app'];

    expect(
      isAllowedCorsOrigin(
        'https://pfe-maintenace-industrielle.vercel.app/',
        allowed,
      ),
    ).toBe(true);
  });

  it('rejects unknown, malicious suffix, and malicious prefix origins', () => {
    const allowed = ['https://trusted-app.vercel.app'];

    expect(isAllowedCorsOrigin('https://evil.example.com', allowed)).toBe(
      false,
    );
    expect(
      isAllowedCorsOrigin(
        'https://trusted-app.vercel.app.attacker.com',
        allowed,
      ),
    ).toBe(false);
    expect(
      isAllowedCorsOrigin(
        'https://trusted-app.vercel.app@attacker.com',
        allowed,
      ),
    ).toBe(false);
  });

  it('uses exact scheme, host, and port matching', () => {
    const allowed = ['https://app.example.com:443'];

    expect(isAllowedCorsOrigin('https://app.example.com', allowed)).toBe(true);
    expect(isAllowedCorsOrigin('http://app.example.com', allowed)).toBe(false);
    expect(isAllowedCorsOrigin('https://app.example.com:444', allowed)).toBe(
      false,
    );
  });

  it('rejects malformed origins', () => {
    expect(isAllowedCorsOrigin('not a url', ['https://app.example.com'])).toBe(
      false,
    );
  });

  it('rejects production wildcard configuration', () => {
    expect(() => parseConfiguredCorsOrigin('*', 'production')).toThrow(
      'CORS_ORIGINS cannot contain wildcards in production',
    );
  });

  it('rejects localhost in production unless policy is explicitly changed elsewhere', () => {
    expect(() =>
      parseConfiguredCorsOrigin('https://localhost:3000', 'production'),
    ).toThrow('CORS_ORIGINS cannot include localhost in production');
  });

  it('accepts approved localhost in development', () => {
    expect(
      parseConfiguredCorsOrigin('http://localhost:3000', 'development'),
    ).toBe('http://localhost:3000');
  });

  it('matches development wildcard origins while escaping other regex characters', () => {
    const allowed = [
      parseConfiguredCorsOrigin('https://*.preview.example.com', 'development'),
    ];

    expect(
      isAllowedCorsOrigin('https://one.preview.example.com', allowed),
    ).toBe(true);
    expect(isAllowedCorsOrigin('https://previewxexample.com', allowed)).toBe(
      false,
    );
  });

  it('shares the same delegate shape for HTTP and WebSocket policy callbacks', async () => {
    await expect(
      checkDelegate('https://pfe-maintenace-industrielle.vercel.app', false),
    ).resolves.toBe(true);
    await expect(
      checkDelegate('https://evil.example.com', false),
    ).resolves.toBe(false);
  });

  it('documents originless behavior: HTTP may allow it, production WebSocket policy rejects it', async () => {
    await expect(checkDelegate(undefined, true)).resolves.toBe(true);
    await expect(checkDelegate(undefined, false)).resolves.toBe(false);
  });
});
