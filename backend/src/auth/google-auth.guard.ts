import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import * as crypto from 'node:crypto';

import { AppConfigService } from '../config/app.config';

import type { ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';

const SUPPORTED_LOCALES = new Set(['ar', 'de', 'en', 'es', 'fr', 'it']);

type GoogleAuthRequest = Request & {
  googleAuthState?: string;
};

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  constructor(private readonly appConfig: AppConfigService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GoogleAuthRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const frontendOriginParam = request.query?.frontendOrigin;
    const requestedOrigin =
      typeof frontendOriginParam === 'string' && frontendOriginParam.trim()
        ? frontendOriginParam
        : (request.headers.origin ?? request.headers.referer);
    const frontendBaseUrl =
      this.appConfig.resolveFrontendBaseUrl(requestedOrigin);
    const callback = this.isCallback(request);

    if (callback) {
      if (!this.isValidCallbackState(request)) {
        this.clearGoogleAuthCookies(response, frontendBaseUrl);
        response.redirect(
          `${frontendBaseUrl.replace(/\/$/, '')}/${this.getLocaleFromCookie(request.headers.cookie)}/auth/google-result?status=failed`,
        );
        return false;
      }

      try {
        return (await super.canActivate(context)) as boolean;
      } catch {
        this.clearGoogleAuthCookies(response, frontendBaseUrl);
        response.redirect(
          `${frontendBaseUrl.replace(/\/$/, '')}/${this.getLocaleFromCookie(request.headers.cookie)}/auth/google-result?status=failed`,
        );
        return false;
      }
    }

    const locale = this.normalizeLocale(request.query?.locale);
    const state = crypto.randomBytes(32).toString('base64url');
    request.googleAuthState = state;

    response.cookie('google_auth_origin', frontendBaseUrl, {
      httpOnly: true,
      sameSite: 'lax',
      secure: frontendBaseUrl.startsWith('https://'),
      maxAge: 10 * 60 * 1000,
      path: '/',
    });
    response.cookie('google_auth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: frontendBaseUrl.startsWith('https://'),
      maxAge: 10 * 60 * 1000,
      path: '/',
    });
    response.cookie('google_auth_locale', locale, {
      httpOnly: true,
      sameSite: 'lax',
      secure: frontendBaseUrl.startsWith('https://'),
      maxAge: 10 * 60 * 1000,
      path: '/',
    });

    return (await super.canActivate(context)) as boolean;
  }

  getAuthenticateOptions(context?: ExecutionContext) {
    const request = context
      ?.switchToHttp()
      .getRequest<GoogleAuthRequest | undefined>();

    return {
      scope: ['profile', 'email'],
      ...(request?.googleAuthState ? { state: request.googleAuthState } : {}),
    };
  }

  private isCallback(request: Request): boolean {
    return request.originalUrl.includes('/auth/google/callback');
  }

  private isValidCallbackState(request: Request): boolean {
    const queryState =
      typeof request.query?.state === 'string' ? request.query.state : '';
    const cookieState = this.getCookieValue(
      request.headers.cookie,
      'google_auth_state',
    );

    if (!queryState || !cookieState) {
      return false;
    }

    if (Buffer.byteLength(queryState) !== Buffer.byteLength(cookieState)) {
      return false;
    }

    return crypto.timingSafeEqual(
      Buffer.from(queryState),
      Buffer.from(cookieState),
    );
  }

  private normalizeLocale(locale: unknown): string {
    return typeof locale === 'string' && SUPPORTED_LOCALES.has(locale)
      ? locale
      : 'en';
  }

  private getLocaleFromCookie(cookieHeader?: string): string {
    const locale = this.getCookieValue(cookieHeader, 'google_auth_locale');
    return SUPPORTED_LOCALES.has(locale) ? locale : 'en';
  }

  private getCookieValue(
    cookieHeader: string | undefined,
    key: string,
  ): string {
    if (!cookieHeader) {
      return '';
    }

    const entry = cookieHeader
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith(`${key}=`));

    return entry ? decodeURIComponent(entry.slice(key.length + 1)) : '';
  }

  private clearGoogleAuthCookies(
    response: Response,
    frontendBaseUrl: string,
  ): void {
    const cookieOptions = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: frontendBaseUrl.startsWith('https://'),
      path: '/',
    };

    response.clearCookie('google_auth_origin', cookieOptions);
    response.clearCookie('google_auth_state', cookieOptions);
    response.clearCookie('google_auth_locale', cookieOptions);
  }
}
