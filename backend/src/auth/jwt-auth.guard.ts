import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ApprovalStatus } from '../schemas/user.schema';
import { validateAccountAccess } from './account-access.validator';
import type { AuthenticatedRequest } from './types/authenticated-request';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const authenticated = await super.canActivate(context);
    if (!authenticated) return false;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (this.isLimitedSessionAllowed(request)) {
      return true;
    }

    if (user?.profile_completed === false) {
      throw new ForbiddenException({
        code: 'PROFILE_COMPLETION_REQUIRED',
        message: 'Complete your profile before accessing the application.',
      });
    }

    validateAccountAccess({
      approval_status: user?.approval_status as ApprovalStatus | undefined,
      is_active: user?.is_active,
      is_verified: user?.is_verified,
      role: user?.role,
      must_reset_password: user?.must_reset_password,
    });

    return true;
  }

  private isLimitedSessionAllowed(request: AuthenticatedRequest): boolean {
    const path = request.path || request.originalUrl?.split('?')[0] || '';
    return (
      request.method === 'POST' &&
      (path.endsWith('/auth/complete-profile') || path.endsWith('/auth/logout'))
    );
  }
}
