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
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { DocumentsService } from './documents.service';
import { Types } from 'mongoose';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { Role } from '../schemas/user.schema';
import { FileStorageService } from '../storage/file-storage.service';
import { AuthenticatedRoles } from '../auth/decorators/roles.decorator';
import { DocumentAccessService } from './document-access.service';

interface UploadDocumentBody {
  document_id?: string;
  machine_id: string;
  type_document?: string;
  description?: string;
  tags?: unknown;
  uploaded_by?: string;
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

type SupportedPhotoType = {
  extension: '.jpg' | '.png' | '.webp';
};

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
      (role !== Role.ADMIN && role !== Role.TECHNICIAN && role !== Role.OPERATOR)
    ) {
      throw new ForbiddenException('Document upload access required');
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
      return input.map((tag) => String(tag)).filter(Boolean);
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
        return parsed.map((tag) => String(tag)).filter(Boolean);
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

  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
    }),
  )
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadDocumentBody,
    @Req() req: AuthenticatedRequest,
  ) {
    const uploaderId = this.ensureDocumentUploader(req);

    if (!file) {
      throw new BadRequestException('File is required');
    }

    if (!file.buffer?.length) {
      throw new BadRequestException('Uploaded file is empty');
    }

    if (file.size > MAX_UPLOAD_BYTES || file.buffer.length > MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException('Uploaded file exceeds 10 MB');
    }

    if (!Types.ObjectId.isValid(body.machine_id)) {
      throw new BadRequestException('Invalid machine_id');
    }

    await this.documentAccessService.assertCanAccessMachine(
      req.user ?? {},
      body.machine_id,
    );

    if (!body.document_id?.trim()) {
      throw new BadRequestException('document_id is required');
    }

    if (!body.type_document?.trim()) {
      throw new BadRequestException('type_document is required');
    }

    const detectedPhotoType = this.isOperatorPhotoType(body.type_document)
      ? this.detectSupportedPhotoType(file.buffer)
      : null;

    if (this.isOperatorPhotoType(body.type_document) && !detectedPhotoType) {
      throw new UnsupportedMediaTypeException(
        'Unsupported photo content. Only JPEG, PNG, and WebP images are allowed.',
      );
    }

    let storedBuffer = file.buffer;
    let fileExtension =
      detectedPhotoType?.extension || extname(file.originalname || '').toLowerCase();

    if (detectedPhotoType) {
      try {
        storedBuffer = await normalizeOperatorPhoto(file.buffer);
        fileExtension = '.webp';
      } catch {
        throw new BadRequestException('Uploaded photo could not be processed');
      }
    }

    const storedFileName = `${Date.now()}-${randomUUID()}${fileExtension}`;
    let storedFilePath: string;
    let storedFileStoragePath: string;
    let storedFileDeleteRef: string;

    try {
      const storedFile = await this.fileStorageService.save({
        buffer: storedBuffer,
        fileName: storedFileName,
        folder: 'uploads',
        contentType: detectedPhotoType ? 'image/webp' : file.mimetype,
      });
      storedFilePath = storedFile.relativePath;
      storedFileStoragePath = storedFile.storageKey ?? storedFile.relativePath;
      storedFileDeleteRef = storedFileStoragePath;
    } catch {
      throw new InternalServerErrorException('Failed to store uploaded file');
    }

    try {
      return await this.documentsService.create({
        document_id: body.document_id,
        machine_id: body.machine_id,
        type_document: body.type_document,
        file_path: storedFilePath,
        storage_path: storedFileStoragePath,
        file_url: undefined,
        file_name: file.originalname,
        description: body.description,
        tags: this.parseTags(body.tags),
        uploaded_by: uploaderId,
      });
    } catch (error) {
      try {
        await this.fileStorageService.delete(storedFileDeleteRef);
      } catch (rollbackError) {
        this.logger.error(
          'Failed to roll back uploaded document file after database error',
          rollbackError instanceof Error ? rollbackError.stack : undefined,
        );
      }

      throw error;
    }
  }
}
