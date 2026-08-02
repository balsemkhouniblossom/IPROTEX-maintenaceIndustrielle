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
    expect(res.cookie.mock.calls[0][2]).not.toHaveProperty('domain');
    expect(res.cookie.mock.calls[1][2]).not.toHaveProperty('domain');
  });

  it('rotates refresh and CSRF cookies after a valid cookie refresh', async () => {
    process.env.NODE_ENV = 'production';

    const authService = {
      refreshToken: jest.fn().mockResolvedValue({
        access_token: 'new-access-token',
        token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        user: { _id: 'user-id' },
      }),
    };
    const controller = new AuthController(
      authService as never,
      {
        consume: jest.fn(),
        recordSuccess: jest.fn(),
        recordFailure: jest.fn(),
      } as never,
    );
    const res = { cookie: jest.fn() };

    const result = await controller.refresh(
      {},
      {
        headers: {
          cookie: 'refresh_token=old-refresh-token; csrf_token=csrf-one',
          'x-csrf-token': 'csrf-one',
        },
      } as never,
      res as never,
    );

    expect(authService.refreshToken).toHaveBeenCalledWith('old-refresh-token');
    expect(result).toEqual({
      access_token: 'new-access-token',
      token: 'new-access-token',
      user: { _id: 'user-id' },
    });
    expect(res.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'new-refresh-token',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
      }),
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'csrf_token',
      expect.not.stringMatching(/^csrf-one$/),
      expect.objectContaining({
        httpOnly: false,
        secure: true,
        sameSite: 'none',
        path: '/',
      }),
    );
  });

  it('rejects cookie refresh when the CSRF header does not match the CSRF cookie', async () => {
    const authService = {
      refreshToken: jest.fn(),
    };
    const controller = new AuthController(
      authService as never,
      {
        consume: jest.fn(),
        recordSuccess: jest.fn(),
        recordFailure: jest.fn(),
      } as never,
    );

    await expect(
      controller.refresh(
        {},
        {
          headers: {
            cookie: 'refresh_token=old-refresh-token; csrf_token=csrf-one',
            'x-csrf-token': 'csrf-two',
          },
        } as never,
        { cookie: jest.fn() } as never,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'CSRF_TOKEN_INVALID',
      },
    });
    expect(authService.refreshToken).not.toHaveBeenCalled();
  });

  it('rejects cookie refresh when the CSRF header is missing', async () => {
    const authService = {
      refreshToken: jest.fn(),
    };
    const controller = new AuthController(
      authService as never,
      {
        consume: jest.fn(),
        recordSuccess: jest.fn(),
        recordFailure: jest.fn(),
      } as never,
    );

    await expect(
      controller.refresh(
        {},
        {
          headers: {
            cookie: 'refresh_token=old-refresh-token; csrf_token=csrf-one',
          },
        } as never,
        { cookie: jest.fn() } as never,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'CSRF_TOKEN_INVALID',
      },
    });
    expect(authService.refreshToken).not.toHaveBeenCalled();
  });

  it('logs out by refresh cookie and clears cookies with matching options', async () => {
    process.env.NODE_ENV = 'production';

    const authService = {
      logoutByRefreshToken: jest
        .fn()
        .mockResolvedValue({ message: 'Logged out successfully' }),
    };
    const controller = new AuthController(
      authService as never,
      {
        consume: jest.fn(),
        recordSuccess: jest.fn(),
        recordFailure: jest.fn(),
      } as never,
    );
    const res = { clearCookie: jest.fn() };

    const result = await controller.logout(
      {
        headers: {
          cookie: 'refresh_token=refresh-one; csrf_token=csrf-one',
          'x-csrf-token': 'csrf-one',
        },
      } as never,
      res as never,
    );

    expect(authService.logoutByRefreshToken).toHaveBeenCalledWith(
      'refresh-one',
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      'refresh_token',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
      }),
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      'csrf_token',
      expect.objectContaining({
        httpOnly: false,
        secure: true,
        sameSite: 'none',
        path: '/',
      }),
    );
    expect(result).toEqual({ message: 'Logged out successfully' });
  });

  it('rejects cookie logout when the CSRF token is missing', async () => {
    const authService = {
      logoutByRefreshToken: jest.fn(),
    };
    const controller = new AuthController(
      authService as never,
      {
        consume: jest.fn(),
        recordSuccess: jest.fn(),
        recordFailure: jest.fn(),
      } as never,
    );

    await expect(
      controller.logout(
        {
          headers: {
            cookie: 'refresh_token=refresh-one; csrf_token=csrf-one',
          },
        } as never,
        { clearCookie: jest.fn() } as never,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'CSRF_TOKEN_INVALID',
      },
    });
    expect(authService.logoutByRefreshToken).not.toHaveBeenCalled();
  });
});

describe('AuthController.forcePasswordReset', () => {
  it('delegates to AuthService with the target user id and request origin', async () => {
    const authService = {
      forcePasswordReset: jest
        .fn()
        .mockResolvedValue({ code: 'PASSWORD_RESET_FORCED', message: 'ok' }),
    };
    const controller = new AuthController(
      authService as never,
      {
        consume: jest.fn(),
        recordSuccess: jest.fn(),
        recordFailure: jest.fn(),
      } as never,
    );

    const result = await controller.forcePasswordReset('user-1', {
      headers: { origin: 'https://app.example.com' },
    } as never);

    expect(authService.forcePasswordReset).toHaveBeenCalledWith(
      'user-1',
      'https://app.example.com',
    );
    expect(result).toEqual({ code: 'PASSWORD_RESET_FORCED', message: 'ok' });
  });
});
