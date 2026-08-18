import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Body,
  InternalServerErrorException,
  Logger,
  Param,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { extname } from 'node:path';
import { DocumentsService } from './documents.service';
import { Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { Role } from '../schemas/user.schema';
import { FileStorageService } from '../storage/file-storage.service';
import { AuthenticatedRoles } from '../auth/decorators/roles.decorator';
import { DocumentAccessService } from './document-access.service';
import {
  DocumentUploadValidationResult,
  validateManagedDocumentUpload,
} from './document-file-validation';
import { SkipTimeout } from '../common/decorators/skip-timeout.decorator';

interface UploadDocumentBody {
  document_id?: string;
  machine_id: string;
  maintenance_plan_id?: string;
  work_order_id?: string;
  intervention_report_id?: string;
  type_document?: string;
  description?: string;
  tags?: unknown;
  uploaded_by?: string;
}

type ValidUploadDocumentBody = UploadDocumentBody & {
  document_id: string;
  machine_id: string;
  type_document: string;
};

interface ReplaceDocumentBody {
  document_id?: string;
  reason?: string;
  expected_version?: string;
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

type SupportedPhotoType = {
  extension: '.jpg' | '.png' | '.webp';
};

interface PreparedUploadFile {
  buffer: Buffer;
  extension: string;
  contentType: string;
  isPhoto: boolean;
}

interface SavedUploadFile {
  path: string;
  storagePath: string;
  deleteRef: string;
}

export async function normalizeOperatorPhoto(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .rotate()
    .resize({
      width: 1920,
      height: 1920,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp()
    .toBuffer();
}

@Controller('documents')
@AuthenticatedRoles()
export class DocumentsUploadController {
  private readonly logger = new Logger(DocumentsUploadController.name);

  constructor(
    private readonly documentsService: DocumentsService,
    private readonly fileStorageService: FileStorageService,
    private readonly documentAccessService: DocumentAccessService,
  ) {}

  private ensureDocumentUploader(req: AuthenticatedRequest): string {
    const userId = req.user?.userId;
    const role = req.user?.role;

    if (
      !userId ||
      (role !== Role.ADMIN &&
        role !== Role.TECHNICIAN &&
        role !== Role.OPERATOR)
    ) {
      throw new ForbiddenException('Document upload access required');
    }

    return userId;
  }

  private ensureDocumentManager(req: AuthenticatedRequest): string {
    const userId = req.user?.userId;
    if (!userId || req.user?.role !== Role.ADMIN) {
      throw new ForbiddenException('Document management access required');
    }
    return userId;
  }

  private isOperatorPhotoType(typeDocument: string): boolean {
    return typeDocument.trim().toLowerCase().includes('photo');
  }

  private detectSupportedPhotoType(buffer: Buffer): SupportedPhotoType | null {
    if (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    ) {
      return { extension: '.jpg' };
    }

    if (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return { extension: '.png' };
    }

    if (
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
      return { extension: '.webp' };
    }

    return null;
  }

  private parseTags(input: unknown): string[] {
    if (Array.isArray(input)) {
      return input.map(String).filter(Boolean);
    }

    if (input == null || input === '') {
      return [];
    }

    if (typeof input !== 'string') {
      if (
        typeof input === 'number' ||
        typeof input === 'boolean' ||
        typeof input === 'bigint'
      ) {
        return [String(input)];
      }

      throw new BadRequestException(
        'Invalid tags format. Expected JSON array or comma-separated list.',
      );
    }

    const raw = input.trim();
    if (!raw) {
      return [];
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(String).filter(Boolean);
      }

      if (typeof parsed === 'string' && parsed.trim()) {
        return [parsed.trim()];
      }

      return [];
    } catch {
      // Support simple comma-separated tags when client does not send JSON.
      if (raw.includes(',')) {
        return raw
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean);
      }

      throw new BadRequestException(
        'Invalid tags format. Expected JSON array or comma-separated list.',
      );
    }
  }

  /**
   * Runs the PDF/Office validation pipeline for a non-photo document
   * upload. On failure, the rejected bytes are quarantined (never written
   * to the managed `uploads` folder a Document could ever reference) and
   * an immutable `DocumentRejection` audit row is written before the
   * matching HTTP exception is thrown — so a malicious or malformed
   * upload always leaves evidence instead of silently disappearing.
   */
  private async validateOrQuarantine(
    file: Express.Multer.File,
    machineId: string | undefined,
    actorId: string,
  ): Promise<DocumentUploadValidationResult & { ok: true }> {
    const result = validateManagedDocumentUpload({
      originalName: file.originalname,
      mimeType: file.mimetype,
      buffer: file.buffer,
      size: file.size,
      maxBytes: MAX_UPLOAD_BYTES,
    });

    if (result.ok) {
      return result;
    }

    let quarantineStorageKey: string | undefined;
    try {
      const quarantined = await this.fileStorageService.save({
        buffer: file.buffer,
        fileName: `${Date.now()}-${randomUUID()}.rejected`,
        folder: 'quarantine',
        contentType: file.mimetype,
      });
      quarantineStorageKey = quarantined.storageKey ?? quarantined.relativePath;
    } catch (error) {
      this.logger.error(
        'Failed to quarantine a rejected document upload',
        error instanceof Error ? error.stack : undefined,
      );
    }

    await this.documentsService.recordRejection({
      machineId,
      originalFileName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      reason: result.reason,
      rejectedBy: actorId,
      quarantineStorageKey,
    });

    throw toRejectionException(result.reason);
  }

  private assertUploadFile(
    file: Express.Multer.File | undefined,
  ): asserts file {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    if (!file.buffer?.length) {
      throw new BadRequestException('Uploaded file is empty');
    }

    if (file.size > MAX_UPLOAD_BYTES || file.buffer.length > MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException('Uploaded file exceeds 10 MB');
    }
  }

  private assertUploadBody(
    body: UploadDocumentBody,
  ): asserts body is ValidUploadDocumentBody {
    if (!Types.ObjectId.isValid(body.machine_id)) {
      throw new BadRequestException('Invalid machine_id');
    }

    for (const [field, value] of [
      ['maintenance_plan_id', body.maintenance_plan_id],
      ['work_order_id', body.work_order_id],
      ['intervention_report_id', body.intervention_report_id],
    ] as const) {
      if (value !== undefined && !Types.ObjectId.isValid(value)) {
        throw new BadRequestException(`Invalid ${field}`);
      }
    }

    if (!body.document_id?.trim()) {
      throw new BadRequestException('document_id is required');
    }

    if (!body.type_document?.trim()) {
      throw new BadRequestException('type_document is required');
    }
  }

  private async prepareUploadFile(
    file: Express.Multer.File,
    typeDocument: string,
  ): Promise<PreparedUploadFile> {
    const isPhoto = this.isOperatorPhotoType(typeDocument);
    if (!isPhoto) {
      return {
        buffer: file.buffer,
        extension: extname(file.originalname || '').toLowerCase(),
        contentType: file.mimetype,
        isPhoto: false,
      };
    }

    const detectedPhotoType = this.detectSupportedPhotoType(file.buffer);
    if (!detectedPhotoType) {
      throw new UnsupportedMediaTypeException(
        'Unsupported photo content. Only JPEG, PNG, and WebP images are allowed.',
      );
    }

    try {
      return {
        buffer: await normalizeOperatorPhoto(file.buffer),
        extension: '.webp',
        contentType: 'image/webp',
        isPhoto: true,
      };
    } catch {
      throw new BadRequestException('Uploaded photo could not be processed');
    }
  }

  private async saveUploadFile(
    preparedFile: PreparedUploadFile,
  ): Promise<SavedUploadFile> {
    const storedFileName = `${Date.now()}-${randomUUID()}${preparedFile.extension}`;

    try {
      const storedFile = await this.fileStorageService.save({
        buffer: preparedFile.buffer,
        fileName: storedFileName,
        folder: 'uploads',
        contentType: preparedFile.contentType,
      });
      const storagePath = storedFile.storageKey ?? storedFile.relativePath;
      return {
        path: storedFile.relativePath,
        storagePath,
        deleteRef: storagePath,
      };
    } catch {
      throw new InternalServerErrorException('Failed to store uploaded file');
    }
  }

  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @SkipTimeout()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadDocumentBody,
    @Req() req: AuthenticatedRequest,
  ) {
    const uploaderId = this.ensureDocumentUploader(req);
    this.assertUploadFile(file);
    this.assertUploadBody(body);

    await this.documentAccessService.assertCanAccessMachine(
      req.user ?? {},
      body.machine_id,
    );

    const preparedFile = await this.prepareUploadFile(file, body.type_document);
    if (!preparedFile.isPhoto) {
      await this.validateOrQuarantine(file, body.machine_id, uploaderId);
    }

    const storedFile = await this.saveUploadFile(preparedFile);

    try {
      return await this.documentsService.create(
        {
          document_id: body.document_id,
          machine_id: body.machine_id,
          maintenance_plan_id: body.maintenance_plan_id,
          work_order_id: body.work_order_id,
          intervention_report_id: body.intervention_report_id,
          type_document: body.type_document,
          file_path: storedFile.path,
          storage_path: storedFile.storagePath,
          file_url: undefined,
          file_name: file.originalname,
          description: body.description,
          tags: this.parseTags(body.tags),
          uploaded_by: uploaderId,
        },
        uploaderId,
      );
    } catch (error) {
      try {
        await this.fileStorageService.delete(storedFile.deleteRef);
      } catch (rollbackError) {
        this.logger.error(
          'Failed to roll back uploaded document file after database error',
          rollbackError instanceof Error ? rollbackError.stack : undefined,
        );
      }

      throw error;
    }
  }

  @Post(':id/replace')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @SkipTimeout()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  async replaceFile(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: ReplaceDocumentBody,
    @Req() req: AuthenticatedRequest,
  ) {
    const actorId = this.ensureDocumentManager(req);

    if (!file) {
      throw new BadRequestException('File is required');
    }
    if (!file.buffer?.length) {
      throw new BadRequestException('Uploaded file is empty');
    }
    if (file.size > MAX_UPLOAD_BYTES || file.buffer.length > MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException('Uploaded file exceeds 10 MB');
    }

    let expectedVersion: number | undefined;
    if (body.expected_version !== undefined) {
      expectedVersion = Number(body.expected_version);
      if (!Number.isFinite(expectedVersion)) {
        throw new BadRequestException('Invalid expected_version');
      }
    }

    const existing = await this.documentAccessService.resolveAccessibleDocument(
      req.user ?? {},
      id,
    );

    await this.validateOrQuarantine(
      file,
      existing.machine_id?.toString(),
      actorId,
    );

    const fileExtension = extname(file.originalname || '').toLowerCase();
    const storedFileName = `${Date.now()}-${randomUUID()}${fileExtension}`;
    let storedFilePath: string;
    let storedFileStoragePath: string;
    let storedFileDeleteRef: string;

    try {
      const storedFile = await this.fileStorageService.save({
        buffer: file.buffer,
        fileName: storedFileName,
        folder: 'uploads',
        contentType: file.mimetype,
      });
      storedFilePath = storedFile.relativePath;
      storedFileStoragePath = storedFile.storageKey ?? storedFile.relativePath;
      storedFileDeleteRef = storedFileStoragePath;
    } catch {
      throw new InternalServerErrorException('Failed to store uploaded file');
    }

    try {
      return await this.documentsService.replace(id, {
        file: {
          document_id: body.document_id,
          file_path: storedFilePath,
          storage_path: storedFileStoragePath,
          file_url: undefined,
          file_name: file.originalname,
        },
        reason: body.reason,
        expectedVersion,
        actorId,
      });
    } catch (error) {
      try {
        await this.fileStorageService.delete(storedFileDeleteRef);
      } catch (rollbackError) {
        this.logger.error(
          'Failed to roll back replacement document file after database error',
          rollbackError instanceof Error ? rollbackError.stack : undefined,
        );
      }

      throw error;
    }
  }
}

function toRejectionException(reason: string): Error {
  if (reason.startsWith('Uploaded file exceeds')) {
    return new PayloadTooLargeException(reason);
  }
  if (
    reason.startsWith('Unsupported file type') ||
    reason.startsWith('Declared file type') ||
    reason.startsWith('File content does not match')
  ) {
    return new UnsupportedMediaTypeException(reason);
  }
  return new BadRequestException(reason);
}
