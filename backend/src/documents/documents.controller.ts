import {
  Controller,
  ForbiddenException,
  Get,
  Post,
  Body,
  Param,
  Delete,
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
import { normalizePagination } from '../common/pagination';
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

    if (role !== Role.ADMIN && role !== Role.TECHNICIAN && role !== Role.OPERATOR) {
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
    return this.documentsService.create({
      ...dto,
      uploaded_by: uploaderId,
    });
  }

  @Get()
  async findAll(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    this.ensureDocumentReader(req);
    const pagination = normalizePagination(page, limit);
    const machineIds = await this.documentAccessService.listAccessibleMachineIds(
      req.user ?? {},
    );
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

  @Get(':id/file')
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

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.ensureDocumentReader(req);
    const document = await this.documentAccessService.resolveAccessibleDocument(
      req.user ?? {},
      id,
    );
    return this.documentsService.findOne(id, document);
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

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.ensureDocumentManager(req);
    return this.documentsService.remove(id);
  }
}

function sanitizeDownloadFileName(fileName: string): string {
  return fileName.replace(/[^A-Za-z0-9._-]/g, '_') || 'download';
}
