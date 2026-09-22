import type { ExecutionContext } from '@nestjs/common';
import { GoogleAuthGuard } from './google-auth.guard';

const mockPassportCanActivate = jest.fn();

jest.mock('@nestjs/passport', () => ({
  AuthGuard: () =>
    class {
      canActivate(context: ExecutionContext) {
        return mockPassportCanActivate(context);
      }
    },
}));

function httpContext(request: Record<string, unknown>) {
  const response = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    redirect: jest.fn(),
  };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return { context, response };
}

describe('GoogleAuthGuard OAuth state boundary', () => {
  const appConfig = {
    resolveFrontendBaseUrl: jest
      .fn()
      .mockReturnValue('https://app.iprotex.test/'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPassportCanActivate.mockResolvedValue(true);
  });

  it('creates secure state/origin/locale cookies before starting OAuth', async () => {
    const request = {
      originalUrl: '/auth/google?locale=fr',
      query: { locale: 'fr', frontendOrigin: 'https://app.iprotex.test' },
      headers: {},
    };
    const { context, response } = httpContext(request);
    const guard = new GoogleAuthGuard(appConfig as never);

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(request).toHaveProperty('googleAuthState', expect.any(String));
    expect(response.cookie).toHaveBeenCalledTimes(3);
    expect(response.cookie).toHaveBeenCalledWith(
      'google_auth_locale',
      'fr',
      expect.objectContaining({ httpOnly: true, secure: true }),
    );
    expect(guard.getAuthenticateOptions(context)).toEqual({
      scope: ['profile', 'email'],
      state: expect.any(String),
    });
  });

  it('accepts a callback only when query and cookie state match', async () => {
    const { context, response } = httpContext({
      originalUrl: '/auth/google/callback?state=same-state',
      query: { state: 'same-state' },
      headers: {
        cookie: 'google_auth_state=same-state; google_auth_locale=de',
      },
    });
    const guard = new GoogleAuthGuard(appConfig as never);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(response.redirect).not.toHaveBeenCalled();
  });

  it.each([
    ['missing state', {}, 'google_auth_locale=es'],
    [
      'different-length state',
      { state: 'short' },
      'google_auth_state=much-longer; google_auth_locale=es',
    ],
    [
      'different state',
      { state: 'same-size-a' },
      'google_auth_state=same-size-b; google_auth_locale=es',
    ],
  ])(
    'rejects callback with %s and clears temporary cookies',
    async (_name, query, cookie) => {
      const { context, response } = httpContext({
        originalUrl: '/auth/google/callback',
        query,
        headers: { cookie },
      });
      const guard = new GoogleAuthGuard(appConfig as never);

      await expect(guard.canActivate(context)).resolves.toBe(false);
      expect(mockPassportCanActivate).not.toHaveBeenCalled();
      expect(response.clearCookie).toHaveBeenCalledTimes(3);
      expect(response.redirect).toHaveBeenCalledWith(
        'https://app.iprotex.test/es/auth/google-result?status=failed',
      );
    },
  );

  it('converts passport callback failures into a safe frontend redirect', async () => {
    mockPassportCanActivate.mockRejectedValue(new Error('provider failure'));
    const { context, response } = httpContext({
      originalUrl: '/auth/google/callback',
      query: { state: 'valid-state' },
      headers: {
        referer: 'https://app.iprotex.test/login',
        cookie: 'google_auth_state=valid-state; google_auth_locale=unsupported',
      },
    });
    const guard = new GoogleAuthGuard(appConfig as never);

    await expect(guard.canActivate(context)).resolves.toBe(false);
    expect(response.redirect).toHaveBeenCalledWith(
      'https://app.iprotex.test/en/auth/google-result?status=failed',
    );
  });

  it('uses safe defaults for unsupported locale and absent state', () => {
    const { context } = httpContext({
      originalUrl: '/auth/google',
      query: { locale: 'xx' },
      headers: {},
    });
    const guard = new GoogleAuthGuard(appConfig as never);

    expect(guard.getAuthenticateOptions()).toEqual({
      scope: ['profile', 'email'],
    });
    expect(guard.getAuthenticateOptions(context)).toEqual({
      scope: ['profile', 'email'],
    });
  });
});
