import {
  Controller,
  ForbiddenException,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Patch,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { KnowledgeBaseService } from './knowledge-base.service';
import { CreateKnowledgeArticleDto } from './dto/create-knowledge-article.dto';
import { UpdateKnowledgeArticleDto } from './dto/update-knowledge-article.dto';
import { KnowledgeArticleTransitionDto } from './dto/knowledge-article-transition.dto';
import { ReviseKnowledgeArticleDto } from './dto/revise-knowledge-article.dto';
import { normalizePagination } from '../common/pagination';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { Role } from '../schemas/user.schema';
import { AuthenticatedRoles } from '../auth/decorators/roles.decorator';
import { KnowledgeArticleStatus } from '../schemas/knowledge-article.schema';

@Controller('knowledge-base/articles')
@UseGuards(JwtAuthGuard)
@AuthenticatedRoles()
export class KnowledgeBaseController {
  constructor(private readonly knowledgeBaseService: KnowledgeBaseService) {}

  private ensureReader(req: AuthenticatedRequest): void {
    const role = req.user?.role;
    if (
      role !== Role.ADMIN &&
      role !== Role.TECHNICIAN &&
      role !== Role.OPERATOR
    ) {
      throw new ForbiddenException('Knowledge base access required');
    }
  }

  private ensureManager(req: AuthenticatedRequest): string {
    const userId = req.user?.userId;
    if (!userId || req.user?.role !== Role.ADMIN) {
      throw new ForbiddenException('Knowledge base management access required');
    }
    return userId;
  }

  private isAdmin(req: AuthenticatedRequest): boolean {
    return req.user?.role === Role.ADMIN;
  }

  @Post()
  create(
    @Body() dto: CreateKnowledgeArticleDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actorId = this.ensureManager(req);
    return this.knowledgeBaseService.create(dto, actorId);
  }

  @Get()
  findAll(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('machineId') machineId?: string,
    @Query('machineTypeId') machineTypeId?: string,
    @Query('maintenancePlanId') maintenancePlanId?: string,
    @Query('faultCode') faultCode?: string,
    @Query('errorCode') errorCode?: string,
    @Query('search') search?: string,
  ) {
    this.ensureReader(req);
    const pagination = normalizePagination(page, limit);
    const isAdmin = this.isAdmin(req);

    const resolvedStatus = isAdmin
      ? (status as KnowledgeArticleStatus | undefined)
      : KnowledgeArticleStatus.PUBLISHED;

    return this.knowledgeBaseService.findAll(
      {
        status: resolvedStatus,
        category,
        machineId,
        machineTypeId,
        maintenancePlanId,
        faultCode,
        errorCode,
        search,
      },
      pagination.page,
      pagination.limit,
      pagination.skip,
    );
  }

  @Get('suggestions')
  getSuggestions(
    @Req() req: AuthenticatedRequest,
    @Query('machineId') machineId?: string,
    @Query('machineTypeId') machineTypeId?: string,
    @Query('faultCode') faultCode?: string,
    @Query('maintenancePlanId') maintenancePlanId?: string,
    @Query('limit') limit?: string,
  ) {
    this.ensureReader(req);
    const parsedLimit = Number(limit);
    return this.knowledgeBaseService.computeSuggestions({
      machineId,
      machineTypeId,
      faultCode,
      maintenancePlanId,
      limit:
        Number.isFinite(parsedLimit) && parsedLimit > 0
          ? parsedLimit
          : undefined,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.ensureReader(req);
    return this.knowledgeBaseService.findOne(id, !this.isAdmin(req));
  }

  @Get(':id/versions')
  listVersions(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.ensureReader(req);
    return this.knowledgeBaseService.listVersionHistory(id, !this.isAdmin(req));
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeArticleDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.ensureManager(req);
    return this.knowledgeBaseService.update(id, dto);
  }

  @Patch(':id/publish')
  publish(
    @Param('id') id: string,
    @Body() dto: KnowledgeArticleTransitionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actorId = this.ensureManager(req);
    return this.knowledgeBaseService.publish(id, dto, actorId);
  }

  @Patch(':id/archive')
  archive(
    @Param('id') id: string,
    @Body() dto: KnowledgeArticleTransitionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actorId = this.ensureManager(req);
    return this.knowledgeBaseService.archive(id, dto, actorId);
  }

  @Post(':id/revise')
  revise(
    @Param('id') id: string,
    @Body() dto: ReviseKnowledgeArticleDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actorId = this.ensureManager(req);
    return this.knowledgeBaseService.reviseArticle(id, dto, actorId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.ensureManager(req);
    return this.knowledgeBaseService.remove(id);
  }
}
