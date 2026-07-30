import { AuthController } from './auth.controller';

describe('AuthController refresh cookie configuration', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.JWT_REFRESH_COOKIE_MAX_AGE_MS;
  });

  it('sets production refresh cookies for cross-site Vercel-to-Render sessions', async () => {
    process.env.NODE_ENV = 'production';

    const authService = {
      login: jest.fn().mockResolvedValue({
        access_token: 'access-token',
        token: 'access-token',
        refresh_token: 'refresh-token',
        user: { _id: 'user-id' },
      }),
    };
    const authThrottleService = {
      consume: jest.fn(),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
    };
    const controller = new AuthController(
      authService as never,
      authThrottleService as never,
    );
    const res = { cookie: jest.fn() };

    const result = await controller.login(
      { user: { _id: 'user-id' } } as never,
      res as never,
    );

    expect(result).toEqual({
      access_token: 'access-token',
      token: 'access-token',
      user: { _id: 'user-id' },
    });
    expect(res.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'refresh-token',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
      }),
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'csrf_token',
      expect.any(String),
      expect.objectContaining({
        httpOnly: false,
        secure: true,
        sameSite: 'none',
        path: '/',
      }),
    );
  });
});
