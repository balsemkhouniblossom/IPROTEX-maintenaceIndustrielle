import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from '../../users/users.service';
import { Role } from '../../schemas/user.schema';
import { validateAccountAccess } from '../account-access.validator';
import type { AuthenticatedRequest } from '../types/authenticated-request';

@Injectable()
export class AdminAccountGuard implements CanActivate {
  constructor(private readonly usersService: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authenticatedUserId = request.user?.userId;

    if (!authenticatedUserId) {
      throw new UnauthorizedException({
        code: 'AUTHENTICATED_USER_NOT_FOUND',
        message: 'Authenticated user was not found.',
      });
    }

    const currentUser = await this.usersService.findOne(authenticatedUserId);

    if (!currentUser) {
      throw new UnauthorizedException({
        code: 'AUTHENTICATED_USER_NOT_FOUND',
        message: 'Authenticated user was not found.',
      });
    }

    if (currentUser.role !== Role.ADMIN) {
      throw new ForbiddenException({
        code: 'ADMIN_ACCESS_REQUIRED',
        message: 'Administrator access is required.',
      });
    }

    validateAccountAccess(currentUser);
    request.currentUser = currentUser;

    return true;
  }
}
