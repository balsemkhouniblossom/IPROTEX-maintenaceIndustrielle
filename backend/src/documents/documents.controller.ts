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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { DocumentsService } from './documents.service';
import { DocumentAccessService } from './document-access.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { DocumentTransitionDto } from './dto/document-transition.dto';
import { normalizePagination } from '../common/pagination';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { Role } from '../schemas/user.schema';
import { AuthenticatedRoles } from '../auth/decorators/roles.decorator';

@Controller('documents')
@UseGuards(JwtAuthGuard)
@AuthenticatedRoles()
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly documentAccessService: DocumentAccessService,
  ) {}

  private ensureDocumentReader(req: AuthenticatedRequest): void {
    const role = req.user?.role;

    if (
      role !== Role.ADMIN &&
      role !== Role.TECHNICIAN &&
      role !== Role.OPERATOR
    ) {
      throw new ForbiddenException('Document access required');
    }
  }

  private ensureDocumentManager(req: AuthenticatedRequest): string {
    const userId = req.user?.userId;

    if (!userId || req.user?.role !== Role.ADMIN) {
      throw new ForbiddenException('Document management access required');
    }

    return userId;
  }

  @Post()
  create(@Body() dto: CreateDocumentDto, @Req() req: AuthenticatedRequest) {
    const uploaderId = this.ensureDocumentManager(req);
    return this.documentsService.create(
      {
        ...dto,
        uploaded_by: uploaderId,
      },
      uploaderId,
    );
  }

  @Get()
  async findAll(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    this.ensureDocumentReader(req);
    const pagination = normalizePagination(page, limit);
    const machineIds =
      await this.documentAccessService.listAccessibleMachineIds(req.user ?? {});
    return this.documentsService.findAll(
      pagination.page,
      pagination.limit,
      pagination.skip,
      machineIds,
    );
  }

  @Get('machine/:machineId')
  async findByMachine(
    @Param('machineId') machineId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.ensureDocumentReader(req);
    await this.documentAccessService.assertCanAccessMachine(
      req.user ?? {},
      machineId,
    );
    return this.documentsService.findByMachine(machineId);
  }

  @Get('rejections')
  listRejections(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    this.ensureDocumentManager(req);
    const pagination = normalizePagination(page, limit);
    return this.documentsService.listRejections(
      pagination.page,
      pagination.limit,
      pagination.skip,
    );
  }

  @Get(':id/file')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async viewFile(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    this.ensureDocumentReader(req);
    const document = await this.documentAccessService.resolveAccessibleDocument(
      req.user ?? {},
      id,
    );
    const file = await this.documentsService.readProtectedFile(id, document);

    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Length', String(file.size));
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${sanitizeDownloadFileName(file.fileName)}"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(file.buffer);
  }

  @Get(':id/preview')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async previewSpreadsheet(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    this.ensureDocumentReader(req);
    const document = await this.documentAccessService.resolveAccessibleDocument(
      req.user ?? {},
      id,
    );
    const preview = await this.documentsService.createSpreadsheetPreview(
      id,
      document,
    );
    res.setHeader('Content-Type', preview.contentType);
    res.setHeader('Content-Length', String(preview.size));
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${sanitizeDownloadFileName(preview.fileName)}"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(preview.buffer);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.ensureDocumentReader(req);
    const document = await this.documentAccessService.resolveAccessibleDocument(
      req.user ?? {},
      id,
    );
    return this.documentsService.findOne(id, document);
  }

  @Get(':id/versions')
  async listVersions(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.ensureDocumentReader(req);
    await this.documentAccessService.resolveAccessibleDocument(
      req.user ?? {},
      id,
    );
    return this.documentsService.listVersionHistory(id);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDocumentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.ensureDocumentManager(req);
    return this.documentsService.update(id, dto);
  }

  @Patch(':id/publish')
  publish(
    @Param('id') id: string,
    @Body() dto: DocumentTransitionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actorId = this.ensureDocumentManager(req);
    return this.documentsService.publish(id, dto, actorId);
  }

  @Patch(':id/archive')
  archive(
    @Param('id') id: string,
    @Body() dto: DocumentTransitionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actorId = this.ensureDocumentManager(req);
    return this.documentsService.archive(id, dto, actorId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.ensureDocumentManager(req);
    return this.documentsService.remove(id);
  }
}

function sanitizeDownloadFileName(fileName: string): string {
  return fileName.replace(/[^A-Za-z0-9._-]/g, '_') || 'download';
}
