import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRoles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { SavedViewsService } from './saved-views.service';
import { CreateSavedViewDto } from './dto/create-saved-view.dto';
import { UpdateSavedViewDto } from './dto/update-saved-view.dto';

function actorFrom(req: AuthenticatedRequest) {
  return { userId: req.user!.userId! };
}

@Controller('saved-views')
@UseGuards(JwtAuthGuard)
@AuthenticatedRoles()
export class SavedViewsController {
  constructor(private readonly savedViewsService: SavedViewsService) {}

  @Get()
  list(@Query('pageKey') pageKey: string, @Req() req: AuthenticatedRequest) {
    return this.savedViewsService.listForPage(pageKey, actorFrom(req));
  }

  @Post()
  create(@Body() dto: CreateSavedViewDto, @Req() req: AuthenticatedRequest) {
    return this.savedViewsService.create(dto, actorFrom(req));
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSavedViewDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.savedViewsService.update(id, dto, actorFrom(req));
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.savedViewsService.remove(id, actorFrom(req));
    return { deleted: true };
  }
}
