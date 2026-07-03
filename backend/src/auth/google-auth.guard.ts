import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { AppConfigService } from '../config/app.config';

import type { ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  constructor(private readonly appConfig: AppConfigService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const frontendOriginParam = request.query?.frontendOrigin;
    const requestedOrigin =
      typeof frontendOriginParam === 'string' && frontendOriginParam.trim()
        ? frontendOriginParam
        : (request.headers.origin ?? request.headers.referer);
    const frontendBaseUrl =
      this.appConfig.resolveFrontendBaseUrl(requestedOrigin);

    response.cookie('google_auth_origin', frontendBaseUrl, {
      httpOnly: true,
      sameSite: 'lax',
      secure: frontendBaseUrl.startsWith('https://'),
      maxAge: 10 * 60 * 1000,
      path: '/',
    });

    return (await super.canActivate(context)) as boolean;
  }

  getAuthenticateOptions() {
    return {
      scope: ['profile', 'email'],
    };
  }
}
