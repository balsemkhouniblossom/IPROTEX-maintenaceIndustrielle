import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRoles } from '../auth/decorators/roles.decorator';
import { normalizePagination } from '../common/pagination';
import { NotificationCenterService } from './notification-center.service';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string; role?: string };
}

/**
 * A single shared surface for Operator, Technician, and Admin notifications:
 * every route derives identity from the authenticated request and scopes
 * the query to that user (their own targeted notifications plus anything
 * broadcast to their role) — there is no cross-role visibility here, so one
 * controller safely serves all three roles instead of three near-identical
 * copies.
 */
@Controller('notifications')
@UseGuards(JwtAuthGuard)
@AuthenticatedRoles()
export class NotificationCenterController {
  constructor(
    private readonly notificationCenterService: NotificationCenterService,
  ) {}

  private identity(req: AuthenticatedRequest): { userId: string; role: string } {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new ForbiddenException('Missing authenticated user');
    }
    return { userId, role };
  }

  @Get()
  list(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    const { userId, role } = this.identity(req);
    const pagination = normalizePagination(page, limit, 20, 100);
    return this.notificationCenterService.listForUser(
      userId,
      role,
      pagination.page,
      pagination.limit,
      unreadOnly === 'true',
    );
  }

  @Get('unread-count')
  async unreadCount(@Req() req: AuthenticatedRequest) {
    const { userId, role } = this.identity(req);
    const count = await this.notificationCenterService.unreadCount(
      userId,
      role,
    );
    return { count };
  }

  @Patch('read-all')
  markAllAsRead(@Req() req: AuthenticatedRequest) {
    const { userId, role } = this.identity(req);
    return this.notificationCenterService.markAllAsRead(userId, role);
  }

  @Patch(':id/read')
  markAsRead(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const { userId, role } = this.identity(req);
    return this.notificationCenterService.markAsRead(userId, role, id);
  }

  @Delete()
  clearAll(@Req() req: AuthenticatedRequest) {
    const { userId, role } = this.identity(req);
    return this.notificationCenterService.clearAll(userId, role);
  }

  @Delete(':id')
  async clearOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const { userId, role } = this.identity(req);
    await this.notificationCenterService.clearOne(userId, role, id);
    return { success: true };
  }
}
