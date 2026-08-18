import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as fs from 'node:fs/promises';
import { Model, Types } from 'mongoose';
import PDFDocument from 'pdfkit';
import * as XLSX from 'xlsx';
import { resolve } from 'node:path';
import {
  DocumentEntity,
  DocumentDocument,
  DocumentLifecycleAction,
  DocumentStatus,
} from '../schemas/document.schema';
import { Machine, MachineDocument } from '../schemas/machine.schema';
import {
  MaintenancePlan,
  MaintenancePlanDocument,
} from '../schemas/maintenance-plan.schema';
import { WorkOrder, WorkOrderDocument } from '../schemas/work-order.schema';
import {
  InterventionReport,
  InterventionReportDocument,
} from '../schemas/intervention-report.schema';
import {
  DocumentRejection,
  DocumentRejectionDocument,
} from '../schemas/document-rejection.schema';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { DocumentTransitionDto } from './dto/document-transition.dto';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';
import { FileStorageService } from '../storage/file-storage.service';
import type { ProtectedStoredFile } from '../storage/file-storage.types';

interface LinkedRecordIds {
  machine_id?: string;
  maintenance_plan_id?: string;
  work_order_id?: string;
  intervention_report_id?: string;
}

export interface ReplaceDocumentFileInput {
  document_id?: string;
  file_path: string;
  storage_path?: string;
  file_url?: string;
  file_name: string;
}

export interface ReplaceDocumentInput {
  file: ReplaceDocumentFileInput;
  reason?: string;
  expectedVersion?: number;
  actorId?: string;
}

interface TransitionRule {
  allowedFrom: DocumentStatus[];
  to: DocumentStatus;
  action: DocumentLifecycleAction;
  verb: string;
}

const REPLACEABLE_FROM = [DocumentStatus.DRAFT, DocumentStatus.PUBLISHED];

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @InjectModel(DocumentEntity.name)
    private readonly documentModel: Model<DocumentDocument>,
    @InjectModel(Machine.name)
    private readonly machineModel: Model<MachineDocument>,
    @InjectModel(MaintenancePlan.name)
    private readonly maintenancePlanModel: Model<MaintenancePlanDocument>,
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
    @InjectModel(InterventionReport.name)
    private readonly interventionReportModel: Model<InterventionReportDocument>,
    @InjectModel(DocumentRejection.name)
    private readonly documentRejectionModel: Model<DocumentRejectionDocument>,
    private readonly fileStorageService: FileStorageService,
  ) {}

  async recordRejection(input: {
    machineId?: string;
    originalFileName: string;
    mimeType?: string;
    size: number;
    reason: string;
    rejectedBy?: string;
    quarantineStorageKey?: string;
  }): Promise<void> {
    await this.documentRejectionModel.create({
      machine_id: this.toObjectIdOrUndefined(input.machineId),
      original_file_name: input.originalFileName,
      mime_type: input.mimeType,
      size: input.size,
      reason: input.reason,
      rejected_by: this.toObjectIdOrUndefined(input.rejectedBy),
      quarantine_storage_key: input.quarantineStorageKey,
    });
  }

  async listRejections(
    page: number,
    limit: number,
    skip: number,
  ): Promise<PaginatedResponse<DocumentRejectionDocument>> {
    const [items, totalItems] = await Promise.all([
      this.documentRejectionModel
        .find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.documentRejectionModel.countDocuments().exec(),
    ]);
    return toPaginatedResponse(items, totalItems, page, limit);
  }

  async create(dto: CreateDocumentDto, actorId?: string) {
    await this.assertLinkedRecordsExist(dto);

    const now = new Date();
    const created = new this.documentModel({
      ...dto,
      status: DocumentStatus.DRAFT,
      version: 1,
      revision: 1,
      lifecycle_history: [
        {
          action: 'created',
          to_status: DocumentStatus.DRAFT,
          actor_user_id: this.toObjectIdOrUndefined(actorId),
          at: now,
        },
      ],
    });
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
      : await this.documentModel.findById(id).populate('machine_id').exec();
    if (!doc) throw new NotFoundException('Document not found');
    return this.resolveDocumentFileUrl(doc);
  }

  async findByMachine(machineId: string) {
    if (!Types.ObjectId.isValid(machineId)) {
      throw new BadRequestException('Invalid machine_id');
    }
    const docs = await this.documentModel
      .find({ machine_id: new Types.ObjectId(machineId) })
      .populate('machine_id')
      .exec();
    return Promise.all(docs.map((doc) => this.resolveDocumentFileUrl(doc)));
  }

  async listVersionHistory(id: string): Promise<Record<string, unknown>[]> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid document id');
    }
    const doc = await this.documentModel.findById(id).exec();
    if (!doc) throw new NotFoundException('Document not found');

    const rootId = doc.root_document_id ?? doc._id;
    const chain = await this.documentModel
      .find({ $or: [{ _id: rootId }, { root_document_id: rootId }] })
      .sort({ revision: 1 })
      .exec();

    return Promise.all(
      chain.map((entry) => this.resolveDocumentFileUrl(entry)),
    );
  }

  async update(id: string, dto: UpdateDocumentDto) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid document id');
    }
    const existing = await this.documentModel.findById(id).exec();
    if (!existing) throw new NotFoundException('Document not found');

    this.assertExpectedVersion(existing.version, dto.expected_version);
    await this.assertLinkedRecordsExist(dto);

    const { expected_version: _expectedVersion, ...fields } = dto;
    const updated = await this.documentModel
      .findOneAndUpdate(
        { _id: id, ...this.versionFilter(existing.version) },
        { $set: fields, $inc: { version: 1 } },
        { new: true },
      )
      .exec();

    if (!updated) {
      throw new ConflictException(
        'This document has changed since you last loaded it; reload and retry',
      );
    }
    return this.resolveDocumentFileUrl(updated);
  }

  async publish(id: string, dto: DocumentTransitionDto, actorId?: string) {
    return this.applyTransition(
      id,
      {
        allowedFrom: [DocumentStatus.DRAFT],
        to: DocumentStatus.PUBLISHED,
        action: 'published',
        verb: 'publish',
      },
      dto,
      actorId,
    );
  }

  async archive(id: string, dto: DocumentTransitionDto, actorId?: string) {
    return this.applyTransition(
      id,
      {
        allowedFrom: [DocumentStatus.DRAFT, DocumentStatus.PUBLISHED],
        to: DocumentStatus.ARCHIVED,
        action: 'archived',
        verb: 'archive',
      },
      dto,
      actorId,
    );
  }

  /**
   * Replaces a document's file with a new version: the new upload becomes
   * its own Document row (status Draft, revision+1, linked back via
   * `supersedes_document_id`/`root_document_id`), and the old row is
   * flipped to Superseded and linked forward via
   * `superseded_by_document_id` — it is never deleted, so every existing
   * reference to it (a work order, an intervention report, another
   * document's history) keeps resolving. Both writes happen in one
   * transaction: either the whole replacement lands, or neither row
   * changes at all.
   */
  async replace(id: string, input: ReplaceDocumentInput) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid document id');
    }
    const existing = await this.documentModel.findById(id).exec();
    if (!existing) throw new NotFoundException('Document not found');

    const currentStatus = existing.status ?? DocumentStatus.DRAFT;
    if (!REPLACEABLE_FROM.includes(currentStatus)) {
      throw new ConflictException(
        `Cannot replace a document in "${currentStatus}" status`,
      );
    }
    this.assertExpectedVersion(existing.version, input.expectedVersion);

    const session = await this.documentModel.db.startSession();
    try {
      return await session.withTransaction(async () => {
        const now = new Date();
        const rootId = existing.root_document_id ?? existing._id;
        const nextRevision = (existing.revision ?? 1) + 1;

        const [newDoc] = await this.documentModel.create(
          [
            {
              document_id:
                input.file.document_id?.trim() ||
                `${existing.document_id}-r${nextRevision}`,
              machine_id: existing.machine_id,
              maintenance_plan_id: existing.maintenance_plan_id,
              work_order_id: existing.work_order_id,
              intervention_report_id: existing.intervention_report_id,
              type_document: existing.type_document,
              description: existing.description,
              tags: existing.tags,
              uploaded_by: input.actorId,
              file_path: input.file.file_path,
              storage_path: input.file.storage_path,
              file_url: input.file.file_url,
              file_name: input.file.file_name,
              status: DocumentStatus.DRAFT,
              version: 1,
              revision: nextRevision,
              root_document_id: rootId,
              supersedes_document_id: existing._id,
              lifecycle_history: [
                {
                  action: 'created',
                  to_status: DocumentStatus.DRAFT,
                  actor_user_id: this.toObjectIdOrUndefined(input.actorId),
                  reason: input.reason,
                  at: now,
                },
              ],
            },
          ],
          { session },
        );

        const statusFilter = {
          $or: [
            { status: { $in: REPLACEABLE_FROM } },
            { status: { $exists: false } },
          ],
        };
        const supersededDoc = await this.documentModel
          .findOneAndUpdate(
            {
              _id: existing._id,
              ...statusFilter,
              ...this.versionFilter(existing.version),
            },
            {
              $set: {
                status: DocumentStatus.SUPERSEDED,
                superseded_by_document_id: newDoc._id,
              },
              $inc: { version: 1 },
              $push: {
                lifecycle_history: {
                  action: 'superseded',
                  from_status: existing.status,
                  to_status: DocumentStatus.SUPERSEDED,
                  actor_user_id: this.toObjectIdOrUndefined(input.actorId),
                  reason: input.reason,
                  at: now,
                },
              },
            },
            { new: true, session },
          )
          .exec();

        if (!supersededDoc) {
          throw new ConflictException(
            `Cannot replace a document in "${currentStatus}" status`,
          );
        }

        return {
          document: await this.resolveDocumentFileUrl(newDoc),
          superseded: await this.resolveDocumentFileUrl(supersededDoc),
        };
      });
    } finally {
      await session.endSession();
    }
  }

  /**
   * A document may only be hard-deleted while it is still an untouched
   * Draft (nothing else references it yet). Anything with real lifecycle
   * activity — published, archived, superseded, or part of a version
   * chain — must be archived instead, so historical references to it
   * (from a work order, an intervention report, a later version) never
   * resolve to a missing record.
   */
  async remove(id: string) {
    const doc = await this.documentModel.findById(id).exec();
    if (!doc) throw new NotFoundException('Document not found');

    const hasRealHistory =
      (doc.lifecycle_history?.length ?? 0) > 1 ||
      doc.status === DocumentStatus.PUBLISHED ||
      doc.status === DocumentStatus.ARCHIVED ||
      doc.status === DocumentStatus.SUPERSEDED ||
      Boolean(doc.superseded_by_document_id) ||
      Boolean(doc.supersedes_document_id);

    if (hasRealHistory) {
      throw new ConflictException(
        'This document has lifecycle or version history and cannot be deleted; archive it instead to preserve its historical references',
      );
    }

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
    if (
      !storageReference ||
      !this.fileStorageService.ownsFile(storageReference)
    ) {
      throw new NotFoundException('Managed document file not found');
    }

    try {
      return await this.fileStorageService.readProtectedFile(storageReference);
    } catch (error) {
      if (error instanceof NotFoundException) {
        const fallbackFile = await this.readSeededManualFallback(doc);
        if (fallbackFile) return fallbackFile;
      }

      throw error;
    }
  }

  async createSpreadsheetPreview(
    id: string,
    resolvedDoc?: DocumentDocument,
  ): Promise<ProtectedStoredFile> {
    const source = await this.readProtectedFile(id, resolvedDoc);
    if (!/\.xlsx$/i.test(source.fileName)) {
      throw new BadRequestException(
        'Spreadsheet preview is only available for .xlsx files',
      );
    }

    const workbook = XLSX.read(source.buffer, { type: 'buffer' });
    const buffer = await renderWorkbookPdf(workbook, source.fileName);
    return {
      buffer,
      contentType: 'application/pdf',
      fileName: `${source.fileName.replace(/\.xlsx$/i, '')}.pdf`,
      size: buffer.length,
    };
  }

  private async applyTransition(
    id: string,
    rule: TransitionRule,
    dto: DocumentTransitionDto,
    actorId?: string,
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid document id');
    }
    const existing = await this.documentModel.findById(id).exec();
    if (!existing) throw new NotFoundException('Document not found');

    const currentStatus = existing.status ?? DocumentStatus.DRAFT;
    if (!rule.allowedFrom.includes(currentStatus)) {
      throw new ConflictException(
        `Cannot ${rule.verb} a document in "${currentStatus}" status`,
      );
    }
    this.assertExpectedVersion(existing.version, dto.expected_version);

    const statusFilter = rule.allowedFrom.includes(DocumentStatus.DRAFT)
      ? {
          $or: [
            { status: { $in: rule.allowedFrom } },
            { status: { $exists: false } },
          ],
        }
      : { status: { $in: rule.allowedFrom } };

    const now = new Date();
    const updated = await this.documentModel
      .findOneAndUpdate(
        { _id: id, ...statusFilter, ...this.versionFilter(existing.version) },
        {
          $set: { status: rule.to },
          $inc: { version: 1 },
          $push: {
            lifecycle_history: {
              action: rule.action,
              from_status: existing.status,
              to_status: rule.to,
              actor_user_id: this.toObjectIdOrUndefined(actorId),
              reason: dto.reason,
              at: now,
            },
          },
        },
        { new: true },
      )
      .exec();

    if (!updated) {
      throw new ConflictException(
        `Cannot ${rule.verb} a document in "${currentStatus}" status`,
      );
    }
    return this.resolveDocumentFileUrl(updated);
  }

  private assertExpectedVersion(
    currentVersion: number | undefined,
    expectedVersion: number | undefined,
  ): void {
    if (currentVersion === undefined) return;
    if (expectedVersion === undefined) {
      throw new ConflictException(
        'expected_version is required to modify this document',
      );
    }
    if (expectedVersion !== currentVersion) {
      throw new ConflictException(
        'This document has changed since you last loaded it; reload and retry',
      );
    }
  }

  /**
   * A document created before this feature (or imported outside the API)
   * may have no `version` at all. Matching that with a literal
   * `{ version: undefined }` filter is unreliable across drivers, so an
   * absent version is matched via `$exists: false` instead — `$inc` on a
   * missing path still correctly initializes it to 1.
   */
  private versionFilter(version?: number): Record<string, unknown> {
    return version === undefined
      ? { version: { $exists: false } }
      : { version };
  }

  private async assertLinkedRecordsExist(
    links: LinkedRecordIds,
  ): Promise<void> {
    if (links.machine_id !== undefined) {
      const exists = await this.machineModel
        .exists({ _id: links.machine_id })
        .exec();
      if (!exists)
        throw new BadRequestException('Referenced machine does not exist');
    }
    if (links.maintenance_plan_id !== undefined) {
      const exists = await this.maintenancePlanModel
        .exists({ _id: links.maintenance_plan_id })
        .exec();
      if (!exists) {
        throw new BadRequestException(
          'Referenced maintenance plan does not exist',
        );
      }
    }
    if (links.work_order_id !== undefined) {
      const exists = await this.workOrderModel
        .exists({ _id: links.work_order_id })
        .exec();
      if (!exists)
        throw new BadRequestException('Referenced work order does not exist');
    }
    if (links.intervention_report_id !== undefined) {
      const exists = await this.interventionReportModel
        .exists({ _id: links.intervention_report_id })
        .exec();
      if (!exists) {
        throw new BadRequestException(
          'Referenced intervention report does not exist',
        );
      }
    }
  }

  private toObjectIdOrUndefined(id?: string): Types.ObjectId | undefined {
    return id && Types.ObjectId.isValid(id)
      ? new Types.ObjectId(id)
      : undefined;
  }

  private async deleteManagedDocumentFile(
    doc: DocumentDocument,
  ): Promise<void> {
    const storageReference = this.getManagedDocumentReference(doc);

    if (
      !storageReference ||
      !this.fileStorageService.ownsFile(storageReference)
    ) {
      return;
    }

    try {
      await this.fileStorageService.delete(storageReference);
    } catch {
      this.logger.warn(
        'Failed to delete managed document file after record removal',
      );
    }
  }

  private async resolveDocumentFileUrl(
    doc: DocumentDocument,
  ): Promise<Record<string, unknown>> {
    const plain = doc.toObject() as Record<string, unknown>;
    const id = documentIdString(plain._id);
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

  private async readSeededManualFallback(
    doc: DocumentDocument,
  ): Promise<ProtectedStoredFile | null> {
    const plain = doc.toObject() as Record<string, unknown>;
    const fileName = plain.file_name as string | undefined;
    const typeDocument =
      typeof plain.type_document === 'string'
        ? plain.type_document.toLowerCase()
        : '';
    const tags = Array.isArray(plain.tags)
      ? plain.tags.map((tag) => String(tag).toLowerCase())
      : [];

    if (
      !fileName ||
      !isSafeSeededManualFileName(fileName) ||
      (!typeDocument.includes('manual') && !tags.includes('manual'))
    ) {
      return null;
    }

    const resourcePath = resolve(process.cwd(), '..', 'resources', fileName);

    try {
      const buffer = await fs.readFile(resourcePath);
      return {
        buffer,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileName,
        size: buffer.length,
      };
    } catch {
      return null;
    }
  }
}

function renderWorkbookPdf(
  workbook: XLSX.WorkBook,
  title: string,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const pdf = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 32,
    });
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    workbook.SheetNames.forEach((sheetName, sheetIndex) => {
      if (sheetIndex) pdf.addPage();
      pdf.font('Helvetica-Bold').fontSize(13).text(`${title} - ${sheetName}`);
      pdf.moveDown(0.5);
      const rows = XLSX.utils.sheet_to_json<unknown[]>(
        workbook.Sheets[sheetName],
        {
          header: 1,
          defval: '',
          raw: false,
        },
      );
      const columnCount = Math.min(
        Math.max(...rows.map((row) => row.length), 1),
        12,
      );
      const columnWidth = (pdf.page.width - 64) / columnCount;

      rows.slice(0, 200).forEach((row, rowIndex) => {
        if (pdf.y > pdf.page.height - 52) pdf.addPage();
        const rowY = pdf.y;
        row.slice(0, columnCount).forEach((cell, columnIndex) => {
          pdf
            .font(rowIndex === 0 ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(7)
            .text(cellToPdfText(cell), 32 + columnIndex * columnWidth, rowY, {
              width: columnWidth - 3,
              height: 12,
              ellipsis: true,
            });
        });
        pdf.y = rowY + 12;
      });
    });
    pdf.end();
  });
}

function cellToPdfText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value.toString();
  if (value instanceof Date) return value.toLocaleDateString('en-CA');
  return '';
}

function documentIdString(id: unknown): string {
  if (id instanceof Types.ObjectId) return id.toHexString();
  if (typeof id === 'string') return id;
  return '';
}

function isSafeSeededManualFileName(fileName: string): boolean {
  if (!fileName.toLowerCase().endsWith('.xlsx')) return false;
  return /^[A-Za-z0-9._ -]+$/.test(fileName);
}
