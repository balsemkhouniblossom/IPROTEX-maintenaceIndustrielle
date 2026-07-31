import {
  BadRequestException,
  Controller,
  Request,
  Post,
  Body,
  Query,
  Get,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  UnauthorizedException,
  Req,
  Res,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  AuthThrottleService,
  type AuthThrottleEndpoint,
} from './auth-throttle.service';
import { LocalAuthGuard } from './local-auth.guard';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyResetTokenDto } from './dto/verify-reset-token.dto';
import { GoogleLoginExchangeDto } from './dto/google-login-exchange.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { CompleteGoogleProfileDto } from './dto/complete-google-profile.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { GoogleAuthGuard } from './google-auth.guard';
import type { CookieOptions, Request as ExpressRequest, Response } from 'express';
import * as crypto from 'crypto';
import type { UserDocument } from '../schemas/user.schema';
import type { GoogleUserProfile } from './auth.service';
import { Public } from './decorators/public.decorator';

type LoginRequest = ExpressRequest & {
  user?: UserDocument;
};

type JwtRequest = ExpressRequest & {
  user?: {
    userId: string;
  };
};

type GoogleAuthRequest = ExpressRequest & {
  user?: GoogleUserProfile;
};

const SUPPORTED_LOCALES = new Set(['ar', 'de', 'en', 'es', 'fr', 'it']);
const REFRESH_COOKIE_NAME = 'refresh_token';
const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';

function getLocaleFromCookie(cookieHeader?: string): string {
  if (!cookieHeader) {
    return 'en';
  }

  const localeCookie = cookieHeader
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('NEXT_LOCALE='));

  if (!localeCookie) {
    return 'en';
  }

  const locale = decodeURIComponent(localeCookie.slice('NEXT_LOCALE='.length));
  return SUPPORTED_LOCALES.has(locale) ? locale : 'en';
}

function getCookieValue(cookieHeader: string | undefined, key: string): string {
  if (!cookieHeader) {
    return '';
  }

  const entry = cookieHeader
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${key}=`));

  return entry ? decodeURIComponent(entry.slice(key.length + 1)) : '';
}

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private readonly authThrottleService: AuthThrottleService,
  ) {}

  @UseGuards(LocalAuthGuard)
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Request() req: LoginRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!req.user) {
      throw new UnauthorizedException('Authentication failed');
    }

    return this.attachRefreshCookie(res, await this.authService.login(req.user));
  }
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @Public()
  googleAuth() {
    // Passport redirects to Google
  }
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @Public()
  googleAuthCallback(@Req() req: GoogleAuthRequest, @Res() res: Response) {
    const locale =
      getCookieValue(req.headers.cookie, 'google_auth_locale') ||
      getLocaleFromCookie(req.headers.cookie);
    const frontendOrigin = getCookieValue(
      req.headers.cookie,
      'google_auth_origin',
    );

    if (!req.user) {
      return this.authService.redirectFailedGoogleLogin(
        res,
        locale,
        frontendOrigin,
      );
    }

    return this.authService.googleLogin(req.user, res, locale, frontendOrigin);
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() dto: RefreshTokenDto | undefined,
    @Request() req: ExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookieRefreshToken = getCookieValue(
      req.headers.cookie,
      REFRESH_COOKIE_NAME,
    );
    const refreshToken = dto?.refresh_token || cookieRefreshToken;

    if (cookieRefreshToken && !dto?.refresh_token) {
      this.assertCsrfToken(req);
    }

    return this.attachRefreshCookie(
      res,
      await this.authService.refreshToken(refreshToken ?? ''),
    );
  }

  @Post('google/exchange')
  @Public()
  @HttpCode(HttpStatus.OK)
  exchangeGoogleLogin(
    @Body() dto: GoogleLoginExchangeDto,
    @Request() req: ExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.withAuthThrottle(
      'google-exchange',
      req,
      { code: dto.code },
      async () =>
        this.attachRefreshCookie(
          res,
          await this.authService.exchangeGoogleLogin(dto.code),
        ),
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('complete-profile')
  @HttpCode(HttpStatus.OK)
  completeProfile(
    @Request() req: JwtRequest,
    @Body() dto: CompleteGoogleProfileDto,
  ) {
    if (!req.user?.userId) {
      throw new UnauthorizedException('Authentication failed');
    }

    return this.authService.completeGoogleProfile(req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Request() req: JwtRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!req.user?.userId) {
      throw new UnauthorizedException('Authentication failed');
    }

    this.assertCsrfToken(req);
    this.clearRefreshCookies(res);
    return this.authService.logout(req.user.userId);
  }

  @Post('register')
  @Public()
  async register(
    @Body() registerDto: RegisterDto,
    @Request() req: ExpressRequest,
  ) {
    const requestedLocale = req.headers['x-app-locale'];
    const localeHeader = Array.isArray(requestedLocale)
      ? requestedLocale[0]
      : requestedLocale;
    const locale =
      localeHeader && SUPPORTED_LOCALES.has(localeHeader) ? localeHeader : 'en';
    const frontendOrigin = req.headers.origin ?? req.headers.referer;
    return this.withAuthThrottle(
      'register',
      req,
      { email: registerDto.email },
      () => this.authService.register(registerDto, locale, frontendOrigin),
    );
  }
  @Get('verify-email')
  @Public()
  async verifyEmail(@Query('token') token: string) {
    return this.authService.verifyEmail(token);
  }

  @Post('forgot-password')
  @Public()
  async forgotPassword(
    @Body() forgotPasswordDto: ForgotPasswordDto,
    @Request() req: ExpressRequest,
  ) {
    const requestOrigin =
      req.headers.origin ??
      req.headers.referer ??
      forgotPasswordDto.frontendOrigin;

    return this.withAuthThrottle(
      'forgot-password',
      req,
      { email: forgotPasswordDto.email },
      () =>
        this.authService.forgotPassword(
          forgotPasswordDto.email,
          forgotPasswordDto.locale,
          requestOrigin,
        ),
    );
  }

  @Get('verify-reset-token')
  @Public()
  async verifyResetToken(
    @Query('token') token: string,
    @Request() req: ExpressRequest,
  ) {
    if (!token?.trim()) {
      throw new BadRequestException('Reset token is required');
    }

    return this.withAuthThrottle(
      'verify-reset-token',
      req,
      { token },
      () => this.authService.verifyResetToken(token),
    );
  }

  @Post('verify-reset-token')
  @Public()
  async verifyResetTokenFromBody(
    @Body() verifyResetTokenDto: VerifyResetTokenDto,
    @Request() req: ExpressRequest,
  ) {
    return this.withAuthThrottle(
      'verify-reset-token',
      req,
      { token: verifyResetTokenDto.token },
      () => this.authService.verifyResetToken(verifyResetTokenDto.token),
    );
  }

  @Post('reset-password')
  @Public()
  async resetPassword(
    @Body() resetPasswordDto: ResetPasswordDto,
    @Request() req: ExpressRequest,
  ) {
    return this.withAuthThrottle(
      'reset-password',
      req,
      { token: resetPasswordDto.token },
      () => this.authService.resetPassword(resetPasswordDto),
    );
  }

  private async withAuthThrottle<T>(
    endpoint: AuthThrottleEndpoint,
    req: ExpressRequest,
    identity: { email?: string; token?: string; code?: string },
    action: () => Promise<T>,
  ): Promise<T> {
    await this.authThrottleService.consume(endpoint, req, identity);

    try {
      const result = await action();
      this.authThrottleService.recordSuccess(endpoint, req, identity);
      return result;
    } catch (error) {
      this.authThrottleService.recordFailure(endpoint, req, identity);
      throw error;
    }
  }

  private attachRefreshCookie(
    res: Response,
    result: {
      access_token: string;
      token?: string;
      refresh_token: string;
      user: unknown;
    },
  ) {
    const csrfToken = cryptoRandomToken();
    const cookieOptions = this.getRefreshCookieOptions();

    res.cookie(REFRESH_COOKIE_NAME, result.refresh_token, {
      ...cookieOptions,
      httpOnly: true,
    });
    res.cookie(CSRF_COOKIE_NAME, csrfToken, {
      ...cookieOptions,
      httpOnly: false,
    });

    const { refresh_token: _refreshToken, ...publicResult } = result;
    return publicResult;
  }

  private clearRefreshCookies(res: Response): void {
    const { maxAge: _maxAge, ...cookieOptions } =
      this.getRefreshCookieOptions();

    res.clearCookie(REFRESH_COOKIE_NAME, {
      ...cookieOptions,
      httpOnly: true,
    });
    res.clearCookie(CSRF_COOKIE_NAME, {
      ...cookieOptions,
      httpOnly: false,
    });
  }

  private getRefreshCookieOptions(): CookieOptions {
    const secure = process.env.NODE_ENV === 'production';

    return {
      secure,
      sameSite: secure ? 'none' : 'lax',
      path: '/',
      maxAge: this.getRefreshCookieMaxAgeMs(),
    };
  }

  private assertCsrfToken(req: ExpressRequest): void {
    const cookieToken = getCookieValue(req.headers.cookie, CSRF_COOKIE_NAME);
    const headerToken = req.headers[CSRF_HEADER_NAME];
    const submittedToken = Array.isArray(headerToken) ? headerToken[0] : headerToken;

    if (
      !cookieToken ||
      typeof submittedToken !== 'string' ||
      submittedToken !== cookieToken
    ) {
      throw new ForbiddenException({
        code: 'CSRF_TOKEN_INVALID',
        message: 'CSRF token is missing or invalid.',
      });
    }
  }

  private getRefreshCookieMaxAgeMs(): number {
    const configured = process.env.JWT_REFRESH_COOKIE_MAX_AGE_MS;
    const parsed = Number(configured);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 7 * 24 * 60 * 60 * 1000;
  }
}

function cryptoRandomToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}
