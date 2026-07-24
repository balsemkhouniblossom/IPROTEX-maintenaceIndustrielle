import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DocumentEntity, DocumentDocument } from '../schemas/document.schema';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';
import { FileStorageService } from '../storage/file-storage.service';
import type { ProtectedStoredFile } from '../storage/file-storage.types';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @InjectModel(DocumentEntity.name)
    private documentModel: Model<DocumentDocument>,
    private readonly fileStorageService: FileStorageService,
  ) {}

  async create(dto: CreateDocumentDto) {
    const created = new this.documentModel(dto);
    return this.resolveDocumentFileUrl(await created.save());
  }

  async findAll(
    page: number,
    limit: number,
    skip: number,
    machineIds?: Types.ObjectId[] | null,
  ): Promise<PaginatedResponse<Record<string, unknown>>> {
    const query =
      machineIds === null || machineIds === undefined
        ? {}
        : { machine_id: { $in: machineIds } };
    const [items, totalItems] = await Promise.all([
      this.documentModel.find(query).skip(skip).limit(limit).exec(),
      this.documentModel.countDocuments(query).exec(),
    ]);

    return toPaginatedResponse(
      await Promise.all(items.map((item) => this.resolveDocumentFileUrl(item))),
      totalItems,
      page,
      limit,
    );
  }

  async findOne(id: string, resolvedDoc?: DocumentDocument) {
    const doc = resolvedDoc
      ? await resolvedDoc.populate('machine_id')
      : await this.documentModel
          .findById(id)
          .populate('machine_id')
          .exec();
    if (!doc) throw new NotFoundException('Document not found');
    return this.resolveDocumentFileUrl(doc);
  }

  async findByMachine(machineId: string) {
    const docs = await this.documentModel
      .find({ machine_id: machineId })
      .populate('machine_id')
      .exec();
    return Promise.all(docs.map((doc) => this.resolveDocumentFileUrl(doc)));
  }

  async update(id: string, dto: UpdateDocumentDto) {
    const updated = await this.documentModel
      .findByIdAndUpdate(id, dto, {
        new: true,
      })
      .exec();

    if (!updated) throw new NotFoundException('Document not found');
    return this.resolveDocumentFileUrl(updated);
  }

  async remove(id: string) {
    const deleted = await this.documentModel.findByIdAndDelete(id).exec();
    if (!deleted) throw new NotFoundException('Document not found');
    await this.deleteManagedDocumentFile(deleted);
    return deleted;
  }

  async readProtectedFile(
    id: string,
    resolvedDoc?: DocumentDocument,
  ): Promise<ProtectedStoredFile> {
    const doc = resolvedDoc ?? (await this.documentModel.findById(id).exec());
    if (!doc) throw new NotFoundException('Document not found');

    const storageReference = this.getManagedDocumentReference(doc);
    if (!storageReference || !this.fileStorageService.ownsFile(storageReference)) {
      throw new NotFoundException('Managed document file not found');
    }

    return this.fileStorageService.readProtectedFile(storageReference);
  }

  private async deleteManagedDocumentFile(doc: DocumentDocument): Promise<void> {
    const storageReference = this.getManagedDocumentReference(doc);

    if (!storageReference || !this.fileStorageService.ownsFile(storageReference)) {
      return;
    }

    try {
      await this.fileStorageService.delete(storageReference);
    } catch {
      this.logger.warn('Failed to delete managed document file after record removal');
    }
  }

  private async resolveDocumentFileUrl(
    doc: DocumentDocument,
  ): Promise<Record<string, unknown>> {
    const plain = doc.toObject() as Record<string, unknown>;
    const id = String(plain._id ?? '');
    const stablePath =
      (plain.storage_path as string | undefined) ??
      (plain.file_path as string | undefined);
    const storedUrl = plain.file_url as string | undefined;
    const resolvedUrl =
      id && stablePath && this.fileStorageService.ownsFile(stablePath)
        ? `/documents/${encodeURIComponent(id)}/file`
        : await this.fileStorageService.resolveUrl(stablePath, storedUrl);

    if (resolvedUrl) {
      plain.file_url = resolvedUrl;
    }

    return plain;
  }

  private getManagedDocumentReference(doc: DocumentDocument): string | null {
    const plain = doc.toObject() as Record<string, unknown>;
    return (
      (plain.storage_path as string | undefined) ??
      (plain.file_path as string | undefined) ??
      null
    );
  }
}
