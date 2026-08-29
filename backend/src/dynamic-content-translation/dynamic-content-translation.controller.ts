import {
  Body,
  Controller,
  ForbiddenException,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthenticatedRoles } from '../auth/decorators/roles.decorator';
import { DynamicContentTranslationService } from './dynamic-content-translation.service';
import { BatchTranslationDto } from './dto/batch-translation.dto';

interface AuthenticatedRequest extends Request {
  user?: {
    userId?: string;
    role?: string;
  };
}

@Controller('translations')
@AuthenticatedRoles()
export class DynamicContentTranslationController {
  constructor(
    private readonly translationService: DynamicContentTranslationService,
  ) {}

  @Post('batch')
  batch(@Req() req: AuthenticatedRequest, @Body() dto: BatchTranslationDto) {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new ForbiddenException('Missing authenticated user');
    }
    return this.translationService.batch({ userId, role }, dto);
  }
}
